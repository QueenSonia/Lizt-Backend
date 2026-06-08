/**
 * Cloudinary asset migration — copy every asset from a SOURCE account into a
 * DESTINATION account, preserving public_id + resource_type so the delivered
 * URL differs only by cloud name (enabling a pure cloud-name swap in the DB).
 *
 * See scripts/CLOUDINARY_MIGRATION_README.md for the full runbook.
 *
 * Two phases per run:
 *   1. Snapshot  — list ALL resources in SOURCE (image + video + raw),
 *                  paginated, written to a manifest JSON (the insurance copy).
 *   2. Copy      — for each manifest entry, upload its public secure_url into
 *                  DESTINATION with the same public_id/resource_type. Cloudinary
 *                  fetches the source URL directly, so no local disk hop.
 *
 * Resumable: completed public_ids are persisted to migrated.json and skipped on
 * re-run — this is also the delta-sync mechanism for the gap window. Folder-
 * agnostic by design: we list everything, so nothing that was ever uploaded is
 * missed regardless of which folder/feature produced it.
 *
 * Credentials are read from inline env vars (never from .env):
 *   SRC_CLOUDINARY_NAME / SRC_CLOUDINARY_API_KEY / SRC_CLOUDINARY_API_SECRET
 *   DST_CLOUDINARY_NAME / DST_CLOUDINARY_API_KEY / DST_CLOUDINARY_API_SECRET
 *
 * Usage:
 *   SRC_...=... DST_...=... ts-node -r tsconfig-paths/register scripts/cloudinary-migrate.ts --dry-run
 *   SRC_...=... DST_...=... ts-node -r tsconfig-paths/register scripts/cloudinary-migrate.ts
 */
import { v2 as cloudinary } from 'cloudinary';
import * as fs from 'fs';
import * as path from 'path';

type ResourceType = 'image' | 'video' | 'raw';
const RESOURCE_TYPES: ResourceType[] = ['image', 'video', 'raw'];

interface ManifestEntry {
  public_id: string;
  resource_type: ResourceType;
  type: string; // delivery type, e.g. 'upload'
  format?: string;
  secure_url: string;
  bytes?: number;
  created_at?: string;
}

const DRY_RUN = process.argv.includes('--dry-run');
const UPLOAD_CONCURRENCY = 5;
const PAGE_SIZE = 500;

// Working dir lives alongside the script so artifacts survive across runs.
const WORK_DIR = path.join(__dirname, '.cloudinary-migration');
const MANIFEST_PATH = path.join(WORK_DIR, 'manifest.json');
const MIGRATED_PATH = path.join(WORK_DIR, 'migrated.json');
const COLLISIONS_PATH = path.join(WORK_DIR, 'collisions.json');
// Optional scope: a JSON array of "resource_type:public_id" keys. When present,
// ONLY these assets are copied — used to migrate just the assets this app
// references (djrqmnzdw is a shared account; we never copy other projects' files).
// Build it with cloudinary-scope-from-db.ts. Set SCOPE_FILE=none to copy all.
const SCOPE_PATH =
  process.env.SCOPE_FILE && process.env.SCOPE_FILE !== 'none'
    ? process.env.SCOPE_FILE
    : process.env.SCOPE_FILE === 'none'
      ? null
      : path.join(WORK_DIR, 'scope.json');

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const SRC = {
  cloud_name: requireEnv('SRC_CLOUDINARY_NAME'),
  api_key: requireEnv('SRC_CLOUDINARY_API_KEY'),
  api_secret: requireEnv('SRC_CLOUDINARY_API_SECRET'),
};
const DST = DRY_RUN
  ? null
  : {
      cloud_name: requireEnv('DST_CLOUDINARY_NAME'),
      api_key: requireEnv('DST_CLOUDINARY_API_KEY'),
      api_secret: requireEnv('DST_CLOUDINARY_API_SECRET'),
    };

function useAccount(acct: {
  cloud_name: string;
  api_key: string;
  api_secret: string;
}) {
  cloudinary.config({ ...acct, secure: true });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry a Cloudinary call with exponential backoff, honouring 429 rate limits. */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const MAX = 6;
  let delay = 2000;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const code = err?.error?.http_code || err?.http_code;
      const retriable = code === 429 || code === 420 || (code >= 500 && code < 600);
      if (!retriable || attempt >= MAX) throw err;
      console.warn(
        `   ⏳ ${label}: ${code ?? 'error'} (attempt ${attempt}/${MAX}), backing off ${delay}ms`,
      );
      await sleep(delay);
      delay = Math.min(delay * 2, 60000);
    }
  }
}

/** Phase 1 — list every resource of every type in SOURCE. */
async function snapshot(): Promise<ManifestEntry[]> {
  useAccount(SRC);
  const entries: ManifestEntry[] = [];

  for (const resource_type of RESOURCE_TYPES) {
    let next_cursor: string | undefined;
    let page = 0;
    do {
      const res: any = await withRetry(
        () =>
          cloudinary.api.resources({
            resource_type,
            type: 'upload',
            max_results: PAGE_SIZE,
            next_cursor,
          }),
        `list ${resource_type} p${page}`,
      );
      for (const r of res.resources as any[]) {
        entries.push({
          public_id: r.public_id,
          resource_type,
          type: r.type ?? 'upload',
          format: r.format,
          secure_url: r.secure_url,
          bytes: r.bytes,
          created_at: r.created_at,
        });
      }
      next_cursor = res.next_cursor;
      page++;
      console.log(
        `   📄 ${resource_type}: page ${page} (+${res.resources.length}, total ${entries.length})`,
      );
      await sleep(250); // gentle on the Admin API hourly cap
    } while (next_cursor);
  }
  return entries;
}

/** Phase 2 — copy one manifest entry into DESTINATION, preserving identity. */
async function copyOne(
  e: ManifestEntry,
): Promise<{ status: 'uploaded' | 'existed' | 'failed'; collision?: boolean; error?: string }> {
  try {
    const res: any = await withRetry(
      () =>
        cloudinary.uploader.upload(e.secure_url, {
          public_id: e.public_id, // already includes the full folder path
          resource_type: e.resource_type,
          type: 'upload',
          overwrite: false, // never clobber anything already on the destination
          use_filename: false,
          unique_filename: false,
        }),
      `upload ${e.resource_type}:${e.public_id}`,
    );
    // overwrite:false returns the existing asset if the public_id was taken.
    const existed = res?.existing === true;
    return { status: existed ? 'existed' : 'uploaded', collision: existed };
  } catch (err: any) {
    return {
      status: 'failed',
      error: err?.error?.message || err?.message || String(err),
    };
  }
}

function loadJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function main() {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  console.log(
    `\n🚀 Cloudinary migrate — source=${SRC.cloud_name}${
      DST ? ` → dest=${DST.cloud_name}` : ''
    } ${DRY_RUN ? '(DRY RUN — snapshot only)' : ''}\n`,
  );

  // ── Phase 1: snapshot ────────────────────────────────────────────────────
  console.log('① Snapshotting source account…');
  const manifest = await snapshot();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  const byType = RESOURCE_TYPES.map(
    (t) => `${t}=${manifest.filter((m) => m.resource_type === t).length}`,
  ).join(', ');
  console.log(
    `   ✅ manifest written (${manifest.length} assets: ${byType}) → ${MANIFEST_PATH}\n`,
  );

  if (DRY_RUN) {
    console.log('🟡 Dry run complete. No assets were copied.');
    return;
  }

  // ── Phase 2: copy (resumable, optionally scoped) ─────────────────────────
  useAccount(DST!);
  const migrated = new Set<string>(loadJson<string[]>(MIGRATED_PATH, []));
  const collisions = loadJson<ManifestEntry[]>(COLLISIONS_PATH, []);
  const key = (e: ManifestEntry) => `${e.resource_type}:${e.public_id}`;

  let inScope = manifest;
  if (SCOPE_PATH) {
    if (!fs.existsSync(SCOPE_PATH)) {
      console.error(
        `❌ Scope file ${SCOPE_PATH} not found. Run cloudinary-scope-from-db.ts ` +
          `for each branch first, or pass SCOPE_FILE=none to copy the entire account.`,
      );
      process.exit(1);
    }
    const scope = new Set<string>(loadJson<string[]>(SCOPE_PATH, []));
    inScope = manifest.filter((e) => scope.has(key(e)));
    console.log(
      `   🎯 Scoped to ${scope.size} referenced asset(s); ${inScope.length} present in source manifest.`,
    );
  }

  const pending = inScope.filter((e) => !migrated.has(key(e)));
  console.log(
    `② Copying to destination… ${pending.length} pending, ${migrated.size} already done\n`,
  );

  let uploaded = 0;
  let existed = 0;
  const failures: { entry: ManifestEntry; error?: string }[] = [];
  let done = 0;

  // Simple fixed-size worker pool — no external deps.
  let idx = 0;
  async function worker() {
    while (idx < pending.length) {
      const e = pending[idx++];
      const r = await copyOne(e);
      done++;
      if (r.status === 'failed') {
        failures.push({ entry: e, error: r.error });
        console.warn(`   ❌ [${done}/${pending.length}] ${key(e)} — ${r.error}`);
        continue;
      }
      if (r.collision) {
        existed++;
        collisions.push(e);
      } else {
        uploaded++;
      }
      migrated.add(key(e));
      if (done % 50 === 0 || done === pending.length) {
        fs.writeFileSync(MIGRATED_PATH, JSON.stringify([...migrated], null, 2));
        fs.writeFileSync(COLLISIONS_PATH, JSON.stringify(collisions, null, 2));
        console.log(
          `   …[${done}/${pending.length}] uploaded=${uploaded} existed=${existed} failed=${failures.length}`,
        );
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, pending.length || 1) }, worker),
  );

  // Final persist.
  fs.writeFileSync(MIGRATED_PATH, JSON.stringify([...migrated], null, 2));
  fs.writeFileSync(COLLISIONS_PATH, JSON.stringify(collisions, null, 2));

  console.log(`\n✅ Copy complete.`);
  console.log(`   uploaded:  ${uploaded}`);
  console.log(`   pre-existed on dest (collisions logged): ${existed}`);
  console.log(`   failed:    ${failures.length}`);
  if (existed > 0) console.log(`   ⚠️  review ${COLLISIONS_PATH}`);
  if (failures.length > 0) {
    console.log(`   ⚠️  ${failures.length} failures — re-run to retry (resumable).`);
    process.exitCode = 1;
  }
  console.log(
    `\n🔎 Next: spot-check one delivered URL per resource type on ${DST!.cloud_name} ` +
      `(image, video, raw-PDF) before flipping env / rewriting the DB.`,
  );
}

main().catch((e) => {
  console.error('❌ Migration script failed:', e);
  process.exit(1);
});

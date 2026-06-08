/**
 * Cloudinary source decommission — delete assets from the SOURCE account, but
 * ONLY after confirming each one exists on the DESTINATION account. Run this
 * last, after migrate + env-flip + DB-rewrite + full verification.
 *
 * Safety: for every asset we intend to delete we first call api.resource on the
 * DESTINATION; if it isn't present there, we SKIP and log it (never delete an
 * asset that wasn't successfully copied). Defaults to dry-run.
 *
 * Reads the manifest + migrated set produced by cloudinary-migrate.ts so it only
 * targets assets we actually migrated.
 *
 * Env (inline, never committed):
 *   SRC_CLOUDINARY_NAME / SRC_CLOUDINARY_API_KEY / SRC_CLOUDINARY_API_SECRET
 *   DST_CLOUDINARY_NAME / DST_CLOUDINARY_API_KEY / DST_CLOUDINARY_API_SECRET
 *
 * Usage:
 *   SRC_…=… DST_…=… ts-node -r tsconfig-paths/register scripts/cloudinary-delete-source.ts        # dry run
 *   SRC_…=… DST_…=… ts-node -r tsconfig-paths/register scripts/cloudinary-delete-source.ts --apply
 */
import { v2 as cloudinary } from 'cloudinary';
import * as fs from 'fs';
import * as path from 'path';

type ResourceType = 'image' | 'video' | 'raw';
interface ManifestEntry {
  public_id: string;
  resource_type: ResourceType;
  type: string;
  secure_url: string;
}

const APPLY = process.argv.includes('--apply');
const WORK_DIR = path.join(__dirname, '.cloudinary-migration');
const MANIFEST_PATH = path.join(WORK_DIR, 'manifest.json');
const MIGRATED_PATH = path.join(WORK_DIR, 'migrated.json');
const DELETED_PATH = path.join(WORK_DIR, 'deleted.json');

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
const DST = {
  cloud_name: requireEnv('DST_CLOUDINARY_NAME'),
  api_key: requireEnv('DST_CLOUDINARY_API_KEY'),
  api_secret: requireEnv('DST_CLOUDINARY_API_SECRET'),
};

const use = (a: typeof SRC) => cloudinary.config({ ...a, secure: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function existsOnDest(e: ManifestEntry): Promise<boolean> {
  use(DST);
  try {
    await cloudinary.api.resource(e.public_id, {
      resource_type: e.resource_type,
      type: 'upload',
    });
    return true;
  } catch (err: any) {
    const code = err?.error?.http_code || err?.http_code;
    if (code === 404) return false;
    throw err; // surface transient/auth errors rather than silently skipping
  }
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`❌ ${MANIFEST_PATH} not found — run cloudinary-migrate.ts first.`);
    process.exit(1);
  }
  const manifest: ManifestEntry[] = JSON.parse(
    fs.readFileSync(MANIFEST_PATH, 'utf8'),
  );
  const migrated = new Set<string>(
    fs.existsSync(MIGRATED_PATH)
      ? JSON.parse(fs.readFileSync(MIGRATED_PATH, 'utf8'))
      : [],
  );
  const key = (e: ManifestEntry) => `${e.resource_type}:${e.public_id}`;
  const targets = manifest.filter((e) => migrated.has(key(e)));

  console.log(
    `\n🗑️  Cloudinary source decommission — delete from ${SRC.cloud_name} ` +
      `(verified against ${DST.cloud_name})\n   ${targets.length} migrated asset(s) to consider ` +
      `${APPLY ? '' : '(DRY RUN)'}\n`,
  );

  const deleted: string[] = fs.existsSync(DELETED_PATH)
    ? JSON.parse(fs.readFileSync(DELETED_PATH, 'utf8'))
    : [];
  const deletedSet = new Set(deleted);

  let toDelete = 0;
  let skipped = 0;
  let done = 0;

  for (let i = 0; i < targets.length; i++) {
    const e = targets[i];
    if (deletedSet.has(key(e))) continue;

    let present: boolean;
    try {
      present = await existsOnDest(e);
    } catch (err: any) {
      console.warn(`   ⚠️  could not verify ${key(e)} on dest — skipping: ${err?.message}`);
      skipped++;
      continue;
    }
    if (!present) {
      console.warn(`   ⏭️  NOT on dest, skipping delete: ${key(e)}`);
      skipped++;
      continue;
    }

    toDelete++;
    if (!APPLY) {
      if (toDelete <= 20 || toDelete % 200 === 0)
        console.log(`   would delete: ${key(e)}`);
      continue;
    }

    use(SRC);
    try {
      await cloudinary.uploader.destroy(e.public_id, {
        resource_type: e.resource_type,
        type: 'upload',
        invalidate: true,
      });
      deletedSet.add(key(e));
      done++;
      if (done % 50 === 0) {
        fs.writeFileSync(DELETED_PATH, JSON.stringify([...deletedSet], null, 2));
        console.log(`   …deleted ${done}`);
      }
      await sleep(50);
    } catch (err: any) {
      console.warn(`   ❌ failed to delete ${key(e)}: ${err?.error?.message || err?.message}`);
      skipped++;
    }
  }

  if (APPLY) fs.writeFileSync(DELETED_PATH, JSON.stringify([...deletedSet], null, 2));

  console.log(`\n${APPLY ? '✅ Deletion complete.' : '🟡 Dry run complete.'}`);
  console.log(`   verified-present & ${APPLY ? 'deleted' : 'would delete'}: ${APPLY ? done : toDelete}`);
  console.log(`   skipped (not on dest / errors): ${skipped}`);
  if (!APPLY)
    console.log(`\n   Re-run with --apply to actually delete from ${SRC.cloud_name}.`);
}

main().catch((e) => {
  console.error('❌ Delete-source script failed:', e);
  process.exit(1);
});

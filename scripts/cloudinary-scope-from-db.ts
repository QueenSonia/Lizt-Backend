/**
 * Build the precise migration scope from the databases.
 *
 * djrqmnzdw turned out to be a SHARED third-party Cloudinary account — most of
 * its assets belong to other projects. So instead of copying the whole account,
 * we copy ONLY the assets this app actually references. This script extracts
 * every djrqmnzdw delivery URL stored in a database, maps each to a manifest
 * entry (by the path after the version segment — stable across versions and
 * transformations), and accumulates the matched {resource_type:public_id} keys
 * into scope.json, which cloudinary-migrate.ts then honours.
 *
 * Run once PER branch (dev + prod main); results are unioned across runs.
 * Requires manifest.json to exist (run cloudinary-migrate.ts --dry-run first).
 *
 * Env:  DATABASE_URL  connection string for the branch to scan
 *
 * Usage:
 *   DATABASE_URL=… ts-node -r tsconfig-paths/register scripts/cloudinary-scope-from-db.ts
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const SRC_CLOUD = process.env.SRC_CLOUD || 'djrqmnzdw';
const WORK_DIR = path.join(__dirname, '.cloudinary-migration');
const MANIFEST_PATH = path.join(WORK_DIR, 'manifest.json');
const SCOPE_PATH = path.join(WORK_DIR, 'scope.json');
const URLS_PATH = path.join(WORK_DIR, 'referenced-urls.json');
const UNMATCHED_PATH = path.join(WORK_DIR, 'unmatched-urls.json');

interface ManifestEntry {
  public_id: string;
  resource_type: 'image' | 'video' | 'raw';
  secure_url: string;
}

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is required.');
  process.exit(1);
}
if (!fs.existsSync(MANIFEST_PATH)) {
  console.error(`❌ ${MANIFEST_PATH} not found — run cloudinary-migrate.ts --dry-run first.`);
  process.exit(1);
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const ARRAY_UDTS = new Set(['_text', '_varchar', '_bpchar']);

/** Path after the version segment — the stable asset identity (public_id[.ext]). */
function identityTail(url: string): string | null {
  const noQuery = url.split('?')[0];
  const parts = noQuery.split(/\/v\d+\//);
  if (parts.length < 2) return null; // no version segment → can't reliably map
  return parts[parts.length - 1];
}

const URL_RE = new RegExp(
  `https?:\\/\\/res\\.cloudinary\\.com\\/${SRC_CLOUD}\\/[^\\s"'\\\\)<>]+`,
  'g',
);

async function main() {
  const manifest: ManifestEntry[] = JSON.parse(
    fs.readFileSync(MANIFEST_PATH, 'utf8'),
  );
  // tail → entry. (Collisions across resource types are effectively impossible
  // because the path includes folder + unique id.)
  const byTail = new Map<string, ManifestEntry>();
  for (const e of manifest) {
    const t = identityTail(e.secure_url);
    if (t) byTail.set(t, e);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("SET statement_timeout = '300s'");

  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL!).host;
    } catch {
      return '(unknown)';
    }
  })();
  console.log(`\n🔎 Scoping from DB ${host} (source cloud: ${SRC_CLOUD})\n`);

  const { rows: candidates } = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
  }>(
    `SELECT table_name, column_name, data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema='public'
        AND (data_type IN ('text','character varying','json','jsonb')
             OR (data_type='ARRAY' AND udt_name IN ('_text','_varchar','_bpchar')))`,
  );

  const foundUrls = new Set<string>();
  for (const c of candidates) {
    const col = ident(c.column_name);
    const isArray =
      c.data_type === 'ARRAY' && ARRAY_UDTS.has(c.udt_name);
    const asText = isArray ? `array_to_string(${col}, ' ')` : `${col}::text`;
    try {
      const { rows } = await client.query<{ t: string }>(
        `SELECT ${asText} AS t FROM ${ident(c.table_name)} WHERE ${asText} LIKE $1`,
        [`%${SRC_CLOUD}%`],
      );
      for (const r of rows) {
        const matches = r.t.match(URL_RE);
        if (matches) for (const u of matches) foundUrls.add(u);
      }
    } catch (e: any) {
      console.warn(`   ⚠️  skipped ${c.table_name}.${c.column_name}: ${e.message}`);
    }
  }
  await client.end();

  console.log(`   extracted ${foundUrls.size} distinct ${SRC_CLOUD} URL(s) from this branch.`);

  // Merge with prior runs.
  const priorUrls: string[] = fs.existsSync(URLS_PATH)
    ? JSON.parse(fs.readFileSync(URLS_PATH, 'utf8'))
    : [];
  const allUrls = new Set<string>([...priorUrls, ...foundUrls]);

  // Map URLs → manifest entries.
  const scopeKeys = new Set<string>();
  const unmatched = new Set<string>();
  for (const u of allUrls) {
    const tail = identityTail(u);
    const entry = tail ? byTail.get(tail) : undefined;
    if (entry) scopeKeys.add(`${entry.resource_type}:${entry.public_id}`);
    else unmatched.add(u);
  }

  fs.writeFileSync(URLS_PATH, JSON.stringify([...allUrls], null, 2));
  fs.writeFileSync(SCOPE_PATH, JSON.stringify([...scopeKeys].sort(), null, 2));
  fs.writeFileSync(UNMATCHED_PATH, JSON.stringify([...unmatched], null, 2));

  console.log(`\n✅ Scope updated (union across branches):`);
  console.log(`   referenced URLs:   ${allUrls.size}  → ${URLS_PATH}`);
  console.log(`   matched assets:    ${scopeKeys.size}  → ${SCOPE_PATH}`);
  console.log(`   UNMATCHED URLs:    ${unmatched.size}  → ${UNMATCHED_PATH}`);
  if (unmatched.size > 0) {
    console.log(
      `   ⚠️  ${unmatched.size} referenced URL(s) didn't map to a current source asset ` +
        `(deleted/renamed, no version segment, or already migrated). Review ${UNMATCHED_PATH}.`,
    );
  }
}

main().catch((e) => {
  console.error('❌ Scope script failed:', e);
  process.exit(1);
});

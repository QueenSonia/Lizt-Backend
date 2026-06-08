/**
 * Cloudinary DB URL rewrite — swap the cloud name in every stored delivery URL
 * from the SOURCE account to the DESTINATION account, after the assets have
 * been migrated (see cloudinary-migrate.ts) and the backend env flipped.
 *
 * Strategy: cloud-name swap only — `res.cloudinary.com/<src>/` → `.../<dst>/`.
 * Version segments (`v123…`) are left as-is; Cloudinary serves stale-version
 * URLs, so the swap is sufficient.
 *
 * Robust by construction: instead of hardcoding columns (which would break on
 * TypeORM's camelCase columns like `chat_messages."fileUrl"` and could miss a
 * column), it discovers every text / varchar / json / jsonb / text[]-style
 * column in the `public` schema from information_schema, counts how many rows
 * contain the source cloud name, and rewrites only those. This doubles as the
 * pre-flight discovery scan AND catches any column we didn't anticipate.
 *
 * Run once PER Neon branch (dev + prod main) — each server persisted its own
 * URLs into its own DB. Pass the connection string explicitly so you never
 * rewrite the wrong branch by accident.
 *
 * Env (inline, never committed):
 *   DATABASE_URL   full postgres connection string for the branch to rewrite
 *   SRC_CLOUD      source cloud name      (default: djrqmnzdw)
 *   DST_CLOUD      destination cloud name (default: dtmguwoam)
 *
 * Usage:
 *   DATABASE_URL=postgres://… ts-node -r tsconfig-paths/register scripts/cloudinary-db-rewrite.ts --dry-run
 *   DATABASE_URL=postgres://… ts-node -r tsconfig-paths/register scripts/cloudinary-db-rewrite.ts --apply
 */
import { Client } from 'pg';

const DRY_RUN = !process.argv.includes('--apply');
const SRC_CLOUD = process.env.SRC_CLOUD || 'djrqmnzdw';
const DST_CLOUD = process.env.DST_CLOUD || 'dtmguwoam';
// Anchor on the delivery host so we never touch a bare token that isn't a URL.
const SRC_FRAG = `res.cloudinary.com/${SRC_CLOUD}/`;
const DST_FRAG = `res.cloudinary.com/${DST_CLOUD}/`;

if (!process.env.DATABASE_URL) {
  console.error(
    '❌ DATABASE_URL is required (the connection string for the branch to rewrite).',
  );
  process.exit(1);
}

const ARRAY_UDTS = new Set(['_text', '_varchar', '_bpchar']);

interface Col {
  table: string;
  column: string;
  data_type: string;
  udt_name: string;
  isArray: boolean;
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Build the per-row "does this column contain the source cloud?" predicate. */
function matchPredicate(c: Col): string {
  const col = ident(c.column);
  if (c.isArray) return `array_to_string(${col}, ',') LIKE $1`;
  return `${col}::text LIKE $1`;
}

/** Build the UPDATE SET expression that performs the swap for this column. */
function rewriteExpr(c: Col): string {
  const col = ident(c.column);
  if (c.isArray) {
    // Replace inside each element, preserving order; only matching rows touched.
    return `(SELECT array_agg(replace(x, $2, $3)) FROM unnest(${col}) AS x)`;
  }
  const replaced = `replace(${col}::text, $2, $3)`;
  if (c.udt_name === 'jsonb') return `${replaced}::jsonb`;
  if (c.udt_name === 'json') return `${replaced}::json`;
  return replaced; // text / varchar — implicit cast back is fine
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  // Dedicated one-off connection — safe to raise the timeout for big scans.
  // (Never SET default_transaction_read_only on the Neon pooler.)
  await client.query("SET statement_timeout = '300s'");

  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL!).host;
    } catch {
      return '(unknown host)';
    }
  })();
  console.log(
    `\n🔧 Cloudinary DB rewrite  ${SRC_CLOUD} → ${DST_CLOUD}\n   DB: ${host}\n   mode: ${
      DRY_RUN ? 'DRY RUN (scan only)' : 'APPLY'
    }\n`,
  );

  // ── Discover candidate columns ───────────────────────────────────────────
  const { rows: candidates } = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
  }>(
    `SELECT table_name, column_name, data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          data_type IN ('text','character varying','json','jsonb')
          OR (data_type = 'ARRAY' AND udt_name IN ('_text','_varchar','_bpchar'))
        )
      ORDER BY table_name, column_name`,
  );

  const cols: Col[] = candidates.map((r) => ({
    table: r.table_name,
    column: r.column_name,
    data_type: r.data_type,
    udt_name: r.udt_name,
    isArray: r.data_type === 'ARRAY' && ARRAY_UDTS.has(r.udt_name),
  }));

  // ── Scan: which columns actually contain the source cloud name? ──────────
  console.log(`① Scanning ${cols.length} text/json/array columns for "${SRC_CLOUD}"…\n`);
  const hits: { col: Col; rows: number }[] = [];
  for (const c of cols) {
    try {
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::int AS count FROM ${ident(c.table)} WHERE ${matchPredicate(c)}`,
        [`%${SRC_CLOUD}%`],
      );
      const n = Number(rows[0].count);
      if (n > 0) {
        hits.push({ col: c, rows: n });
        console.log(
          `   • ${c.table}.${c.column} (${c.isArray ? c.udt_name + '[]' : c.udt_name}) — ${n} row(s)`,
        );
      }
    } catch (e: any) {
      console.warn(`   ⚠️  skipped ${c.table}.${c.column}: ${e.message}`);
    }
  }

  if (hits.length === 0) {
    console.log(`\n✅ No rows reference "${SRC_CLOUD}". Nothing to do.`);
    await client.end();
    return;
  }
  const totalRows = hits.reduce((s, h) => s + h.rows, 0);
  console.log(
    `\n   → ${hits.length} column(s), ${totalRows} matching row(s) total.`,
  );

  if (DRY_RUN) {
    console.log(
      `\n🟡 Dry run — no changes made. Re-run with --apply to rewrite (run per branch).`,
    );
    await client.end();
    return;
  }

  // ── Apply rewrite in a single transaction ────────────────────────────────
  console.log(`\n② Applying rewrite in one transaction…\n`);
  await client.query('BEGIN');
  try {
    let totalAffected = 0;
    for (const { col: c } of hits) {
      const sql = `UPDATE ${ident(c.table)} SET ${ident(c.column)} = ${rewriteExpr(
        c,
      )} WHERE ${matchPredicate(c)}`;
      const res = await client.query(sql, [`%${SRC_CLOUD}%`, SRC_FRAG, DST_FRAG]);
      totalAffected += res.rowCount ?? 0;
      console.log(`   ✅ ${c.table}.${c.column} — ${res.rowCount} row(s) updated`);
    }
    await client.query('COMMIT');
    console.log(`\n✅ Committed. ${totalAffected} row(s) updated.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\n❌ Rewrite failed — transaction rolled back:', e);
    await client.end();
    process.exit(1);
  }

  // ── Post-rewrite verification scan ───────────────────────────────────────
  console.log(`\n③ Verifying no "${SRC_CLOUD}" references remain…`);
  let remaining = 0;
  for (const { col: c } of hits) {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::int AS count FROM ${ident(c.table)} WHERE ${matchPredicate(c)}`,
      [`%${SRC_CLOUD}%`],
    );
    const n = Number(rows[0].count);
    if (n > 0) {
      remaining += n;
      console.warn(
        `   ⚠️  ${c.table}.${c.column} still has ${n} row(s) containing "${SRC_CLOUD}" — ` +
          `likely a non-standard URL shape (not res.cloudinary.com/${SRC_CLOUD}/…). Review manually.`,
      );
    }
  }
  console.log(
    remaining === 0
      ? `   ✅ Clean — 0 references to "${SRC_CLOUD}" remain on this branch.`
      : `   ⚠️  ${remaining} row(s) need manual review (see warnings above).`,
  );

  await client.end();
}

main().catch((e) => {
  console.error('❌ DB rewrite script failed:', e);
  process.exit(1);
});

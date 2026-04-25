/**
 * Backfill per-landlord tenant_kyc rows from each property's latest
 * kyc_applications snapshot.
 *
 * WHY:
 * Before the KYC/phone-bug fix, createPropertyWithExistingTenant would
 * mutate the shared `users` row (overwriting first_name/last_name and,
 * via the email-fallback branch, phone_number). The read path falls back
 * to `tenant_kyc` first and `users` second, so older properties end up
 * showing whatever stale `users` row is now linked to the matched phone.
 *
 * The fix routes the landlord's typed name+phone into a per-landlord
 * tenant_kyc row instead. This script applies the same logic to existing
 * (property_tenant, kyc_application) pairs so legacy properties stop
 * displaying the wrong tenant identity.
 *
 * SAFETY:
 *  - INSERT/UPDATE only. No soft-delete, no row removal.
 *  - Skips rows where an existing tenant_kyc was updated AFTER the latest
 *    kyc_application (those are tenant-completed KYCs — don't clobber).
 *  - Pass --dry-run to print the diff without writing.
 *
 * USAGE:
 *   ts-node scripts/backfill-tenant-kyc-from-input.ts --dry-run
 *   ts-node scripts/backfill-tenant-kyc-from-input.ts
 */

import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env') });

interface CandidateRow {
  property_tenant_id: string;
  property_id: string;
  property_name: string;
  owner_id: string;
  tenant_account_id: string;
  tenant_user_id: string;
  user_first_name: string;
  user_last_name: string;
  user_phone: string;
  user_email: string;
  kyc_app_id: string | null;
  kyc_first_name: string | null;
  kyc_last_name: string | null;
  kyc_phone: string | null;
  kyc_email: string | null;
  kyc_app_updated_at: Date | null;
  existing_tk_id: string | null;
  existing_tk_first_name: string | null;
  existing_tk_last_name: string | null;
  existing_tk_phone: string | null;
  existing_tk_updated_at: Date | null;
}

async function backfill(dryRun: boolean) {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await ds.initialize();

  try {
    console.log(
      `\n📦 tenant_kyc backfill — mode: ${dryRun ? 'DRY-RUN' : 'WRITE'}\n`,
    );

    // Pull every active property_tenant joined with the latest
    // kyc_application for that (property, tenant) pair, plus the existing
    // tenant_kyc row (if any) keyed by (admin_id, phone_number).
    const candidates: CandidateRow[] = await ds.query(`
      WITH latest_kyc AS (
        SELECT DISTINCT ON (ka.property_id, ka.tenant_id)
          ka.id, ka.property_id, ka.tenant_id,
          ka.first_name, ka.last_name, ka.phone_number, ka.email,
          ka.updated_at
        FROM kyc_applications ka
        WHERE ka.deleted_at IS NULL
        ORDER BY ka.property_id, ka.tenant_id, ka.created_at DESC
      )
      SELECT
        pt.id              AS property_tenant_id,
        pt.property_id     AS property_id,
        p.name             AS property_name,
        p.owner_id         AS owner_id,
        pt.tenant_id       AS tenant_account_id,
        a."userId"         AS tenant_user_id,
        u.first_name       AS user_first_name,
        u.last_name        AS user_last_name,
        u.phone_number     AS user_phone,
        u.email            AS user_email,
        lk.id              AS kyc_app_id,
        lk.first_name      AS kyc_first_name,
        lk.last_name       AS kyc_last_name,
        lk.phone_number    AS kyc_phone,
        lk.email           AS kyc_email,
        lk.updated_at      AS kyc_app_updated_at,
        tk.id              AS existing_tk_id,
        tk.first_name      AS existing_tk_first_name,
        tk.last_name       AS existing_tk_last_name,
        tk.phone_number    AS existing_tk_phone,
        tk.updated_at      AS existing_tk_updated_at
      FROM property_tenants pt
      JOIN properties p ON p.id = pt.property_id
      JOIN accounts a   ON a.id = pt.tenant_id
      JOIN users u      ON u.id = a."userId"
      LEFT JOIN latest_kyc lk
        ON lk.property_id = pt.property_id AND lk.tenant_id = pt.tenant_id
      LEFT JOIN tenant_kyc tk
        ON tk.admin_id = p.owner_id
       AND tk.phone_number = COALESCE(lk.phone_number, u.phone_number)
       AND tk.deleted_at IS NULL
      WHERE pt.status = 'active' AND pt.deleted_at IS NULL
    `);

    console.log(`Found ${candidates.length} active property_tenant rows.\n`);

    let updated = 0;
    let inserted = 0;
    let skippedNoKyc = 0;
    let skippedNewer = 0;
    let skippedSame = 0;

    for (const c of candidates) {
      const sourceFirstName = c.kyc_first_name ?? c.user_first_name;
      const sourceLastName = c.kyc_last_name ?? c.user_last_name;
      const sourcePhone = c.kyc_phone ?? c.user_phone;
      const sourceEmail = c.kyc_email ?? c.user_email;

      if (!sourcePhone) {
        skippedNoKyc++;
        continue;
      }

      // Don't clobber a tenant-completed KYC. If the existing tenant_kyc
      // was updated after the latest kyc_application, treat it as
      // tenant-authoritative.
      if (
        c.existing_tk_id &&
        c.kyc_app_updated_at &&
        c.existing_tk_updated_at &&
        new Date(c.existing_tk_updated_at) >= new Date(c.kyc_app_updated_at)
      ) {
        skippedNewer++;
        continue;
      }

      const sameAsExisting =
        c.existing_tk_id &&
        c.existing_tk_first_name === sourceFirstName &&
        c.existing_tk_last_name === sourceLastName &&
        c.existing_tk_phone === sourcePhone;
      if (sameAsExisting) {
        skippedSame++;
        continue;
      }

      const action = c.existing_tk_id ? 'UPDATE' : 'INSERT';
      console.log(
        `${action} property=${c.property_name} owner=${c.owner_id} ` +
          `tenant_user=${c.tenant_user_id} ` +
          `from="${c.existing_tk_first_name ?? c.user_first_name} ${
            c.existing_tk_last_name ?? c.user_last_name
          } / ${c.existing_tk_phone ?? c.user_phone}" ` +
          `to="${sourceFirstName} ${sourceLastName} / ${sourcePhone}"`,
      );

      if (dryRun) {
        if (action === 'INSERT') inserted++;
        else updated++;
        continue;
      }

      await ds.query(
        `
        INSERT INTO tenant_kyc (
          user_id, admin_id,
          first_name, last_name, phone_number, email,
          date_of_birth, gender, nationality, current_residence,
          state_of_origin, marital_status, religion, employment_status,
          occupation, monthly_net_income, contact_address,
          next_of_kin_full_name, next_of_kin_address,
          next_of_kin_relationship, next_of_kin_phone_number,
          next_of_kin_email
        )
        VALUES (
          $1, $2,
          $3, $4, $5, $6,
          '1900-01-01', 'male', '-', '-',
          '-', 'single', '-', 'employed',
          '-', '0', '-',
          '-', '-',
          '-', '-',
          '-'
        )
        ON CONFLICT (admin_id, phone_number) DO UPDATE SET
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          email = EXCLUDED.email,
          user_id = EXCLUDED.user_id,
          updated_at = NOW()
        `,
        [
          c.tenant_user_id,
          c.owner_id,
          sourceFirstName,
          sourceLastName,
          sourcePhone,
          sourceEmail,
        ],
      );

      if (action === 'INSERT') inserted++;
      else updated++;
    }

    console.log('\n— summary —');
    console.log(`  inserted        : ${inserted}`);
    console.log(`  updated         : ${updated}`);
    console.log(`  skipped (no kyc): ${skippedNoKyc}`);
    console.log(`  skipped (newer) : ${skippedNewer}`);
    console.log(`  skipped (same)  : ${skippedSame}`);
    console.log(`  total examined  : ${candidates.length}`);
    if (dryRun) console.log('\n(dry run — no changes written)');
  } finally {
    await ds.destroy();
  }
}

const dryRun = process.argv.includes('--dry-run');
backfill(dryRun).catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

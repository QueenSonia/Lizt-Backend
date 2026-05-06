import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill `tenant_kyc` rows for tenants attached via Path A
 * (POST /users/attach-tenant-from-kyc) before that path was updated to
 * write a `tenant_kyc` snapshot at attach time. Path B
 * (`attachTenantFromOffer`) and Path C (`createPropertyWithExistingTenant`)
 * already wrote one, so they're skipped naturally by the NOT EXISTS guard.
 *
 * The read path in `getCombinedTenantData` falls back to `kyc_applications`
 * when no `tenant_kyc` exists for a tenant, so this is non-critical
 * cosmetic state — but mirroring the new runtime behaviour keeps the
 * read path's preference order consistent across all tenants.
 *
 * Safety properties:
 *   - Idempotent: re-runs insert 0 rows because of the
 *     NOT EXISTS check on (admin_id, normalized_phone).
 *   - No-op against current prod (verified): every existing approved
 *     application already has a matching tenant_kyc row.
 *   - Single INSERT, single transaction (driven by typeorm's migration
 *     runner) — partial failure rolls back automatically.
 *   - Touches no existing rows. Path-C placeholder rows ('-' stubs),
 *     prior Path-B snapshots, and manually-created rows are left
 *     untouched; only fills the gap.
 *   - Phone normalization replicates the runtime
 *     `normalizePhoneNumber` (utils/phone-number.transformer.ts) bit
 *     for bit so the constraint key matches what the application code
 *     would produce.
 *   - Casts kyc_applications enums to tenant_kyc enums via text — the
 *     two enums have identical labels but distinct types in Postgres.
 *   - Provides the same defaults the runtime upsert provides ('-' for
 *     required string fields, 'male'/'single'/'employed' for enums,
 *     '0' for monthly_net_income, 1900-01-01 for date_of_birth).
 *
 * down() is a no-op: tenant_kyc has no backfill-marker column, so
 * detecting "rows we inserted" reliably is impossible without one.
 * Documenting this explicitly is honest — silently deleting could
 * remove real KYC submissions a tenant later filled in.
 */
export class BackfillTenantKycFromApprovedApplications1784000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH source AS (
        SELECT
          app.id                          AS application_id,
          acc."userId"                    AS user_id,
          p.owner_id                      AS admin_id,
          CASE
            WHEN regexp_replace(app.phone_number, '\\D', '', 'g') LIKE '234%'
              THEN regexp_replace(app.phone_number, '\\D', '', 'g')
            WHEN regexp_replace(app.phone_number, '\\D', '', 'g') LIKE '0%'
              THEN '234' || substring(regexp_replace(app.phone_number, '\\D', '', 'g') FROM 2)
            ELSE '234' || regexp_replace(app.phone_number, '\\D', '', 'g')
          END                             AS norm_phone,
          app.first_name,
          app.last_name,
          app.email,
          app.date_of_birth,
          app.gender,
          app.marital_status,
          app.employment_status,
          app.nationality,
          app.state_of_origin,
          app.religion,
          app.contact_address,
          app.occupation,
          app.job_title,
          app.employer_name,
          app.work_address,
          app.work_phone_number,
          app.length_of_employment,
          app.monthly_net_income,
          app.nature_of_business,
          app.business_name,
          app.business_address,
          app.business_duration,
          app.next_of_kin_full_name,
          app.next_of_kin_address,
          app.next_of_kin_relationship,
          app.next_of_kin_phone_number,
          app.next_of_kin_email,
          app.referral_agent_full_name,
          app.referral_agent_phone_number
        FROM kyc_applications app
        JOIN properties p   ON p.id   = app.property_id
        JOIN accounts   acc ON acc.id = app.tenant_id
        WHERE app.status     = 'approved'
          AND app.tenant_id  IS NOT NULL
          AND app.deleted_at IS NULL
      )
      INSERT INTO tenant_kyc (
        user_id, admin_id, phone_number,
        first_name, last_name, email,
        date_of_birth, gender, nationality, state_of_origin, marital_status,
        religion, current_residence, contact_address,
        employment_status, occupation, job_title, employer_name, work_address,
        work_phone_number, length_of_employment, monthly_net_income,
        nature_of_business, business_name, business_address, business_duration,
        next_of_kin_full_name, next_of_kin_address, next_of_kin_relationship,
        next_of_kin_phone_number, next_of_kin_email,
        referral_agent_full_name, referral_agent_phone_number,
        created_at, updated_at
      )
      SELECT
        s.user_id,
        s.admin_id,
        s.norm_phone,
        s.first_name,
        s.last_name,
        CASE
          WHEN s.email IS NOT NULL
           AND trim(s.email)  <> ''
           AND s.email LIKE '%@%'
            THEN s.email
          ELSE 'tenant_' || s.norm_phone || '@placeholder.lizt.app'
        END,
        COALESCE(s.date_of_birth, DATE '1900-01-01'),
        COALESCE(s.gender::text, 'male')::tenant_kyc_gender_enum,
        COALESCE(s.nationality, '-'),
        COALESCE(s.state_of_origin, '-'),
        COALESCE(s.marital_status::text, 'single')::tenant_kyc_marital_status_enum,
        COALESCE(s.religion, '-'),
        COALESCE(s.contact_address, '-'),
        COALESCE(s.contact_address, '-'),
        COALESCE(s.employment_status::text, 'employed')::tenant_kyc_employment_status_enum,
        COALESCE(s.occupation, s.nature_of_business, '-'),
        s.job_title,
        COALESCE(s.employer_name, s.business_name),
        COALESCE(s.work_address, s.business_address),
        s.work_phone_number,
        s.length_of_employment,
        COALESCE(s.monthly_net_income, '0'),
        s.nature_of_business,
        s.business_name,
        s.business_address,
        s.business_duration,
        COALESCE(s.next_of_kin_full_name,    '-'),
        COALESCE(s.next_of_kin_address,      '-'),
        COALESCE(s.next_of_kin_relationship, '-'),
        COALESCE(s.next_of_kin_phone_number, '-'),
        COALESCE(s.next_of_kin_email,        '-'),
        s.referral_agent_full_name,
        s.referral_agent_phone_number,
        NOW(),
        NOW()
      FROM source s
      WHERE NOT EXISTS (
        SELECT 1 FROM tenant_kyc tk
        WHERE tk.admin_id     = s.admin_id
          AND tk.phone_number = s.norm_phone
      )
    `);
  }

  public async down(): Promise<void> {
    // Intentional no-op. tenant_kyc has no marker column to identify rows
    // inserted by this migration, and a tenant may have updated their KYC
    // through other paths after the backfill ran. A blanket delete is
    // unsafe; reverse-engineering "what we inserted" from timestamps is
    // unreliable. If you need to roll back, restore from snapshot.
  }
}

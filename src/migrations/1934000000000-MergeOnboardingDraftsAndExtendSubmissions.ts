import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Landlord onboarding v2 — merge drafts into submissions + extend the record.
 *
 * The former `landlord_onboarding_drafts` table is retired: a landlord's draft
 * and their submitted application are now ONE row in
 * `landlord_onboarding_submissions`, unique per `(admin_id, landlord_phone)`.
 *   - `status` gains `draft` (an in-progress, not-yet-submitted application).
 *   - `data` (jsonb) holds the full wizard state — the prefill source of truth.
 *   - name columns + `submitted_at` become nullable (null on draft-only rows).
 *   - new landlord columns capture the redesigned Step 2/3 fields.
 *   - properties gain `ownership_documents` (proof of ownership).
 *
 * Existing submitted rows are backfilled with a reconstructed `data` blob so the
 * single prefill path works uniformly (new fields come back empty). At time of
 * writing prod holds exactly one such row.
 */
export class MergeOnboardingDraftsAndExtendSubmissions1934000000000
  implements MigrationInterface
{
  private static readonly COUNTRY_CODES = ['+234', '+1', '+44', '+971', '+27'];

  /** Split a stored phone into { cc, local } using the known country codes. */
  private splitPhone(raw: string | null): { cc: string; local: string } {
    const digits = (raw || '').replace(/[^\d]/g, '');
    if (!digits) return { cc: '+234', local: '' };
    // Longest matching code first so +1 doesn't shadow +234 etc.
    const codes = [
      ...MergeOnboardingDraftsAndExtendSubmissions1934000000000.COUNTRY_CODES,
    ].sort((a, b) => b.length - a.length);
    for (const cc of codes) {
      const bare = cc.replace('+', '');
      if (digits.startsWith(bare)) {
        return { cc, local: digits.slice(bare.length) };
      }
    }
    return { cc: '+234', local: digits };
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- 1. status enum: add 'draft' (recreate the type, transaction-safe) ----
    await queryRunner.query(
      `ALTER TABLE "landlord_onboarding_submissions" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TYPE "landlord_onboarding_submissions_status_enum" RENAME TO "landlord_onboarding_submissions_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "landlord_onboarding_submissions_status_enum" AS ENUM('draft', 'pending', 'approved', 'rejected')`,
    );
    await queryRunner.query(
      `ALTER TABLE "landlord_onboarding_submissions" ALTER COLUMN "status" TYPE "landlord_onboarding_submissions_status_enum" USING "status"::text::"landlord_onboarding_submissions_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "landlord_onboarding_submissions" ALTER COLUMN "status" SET DEFAULT 'draft'`,
    );
    await queryRunner.query(
      `DROP TYPE "landlord_onboarding_submissions_status_enum_old"`,
    );

    // ---- 2. relax columns that only apply once submitted ----
    await queryRunner.query(
      `ALTER TABLE "landlord_onboarding_submissions" ALTER COLUMN "landlord_first_name" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "landlord_onboarding_submissions" ALTER COLUMN "landlord_last_name" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "landlord_onboarding_submissions" ALTER COLUMN "submitted_at" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "landlord_onboarding_submissions" ALTER COLUMN "submitted_at" DROP DEFAULT`,
    );

    // ---- 3. new landlord columns ----
    await queryRunner.query(
      `CREATE TYPE "landlord_onboarding_submissions_landlord_type_enum" AS ENUM('corporate', 'individual')`,
    );
    await queryRunner.query(`
      ALTER TABLE "landlord_onboarding_submissions"
        ADD COLUMN "data" jsonb,
        ADD COLUMN "landlord_type" "landlord_onboarding_submissions_landlord_type_enum",
        ADD COLUMN "email" character varying,
        ADD COLUMN "date_of_birth" date,
        ADD COLUMN "employment_status" character varying,
        ADD COLUMN "address" text,
        ADD COLUMN "company_name" character varying,
        ADD COLUMN "id_type" character varying,
        ADD COLUMN "id_documents" jsonb NOT NULL DEFAULT '[]',
        ADD COLUMN "corporate_documents" jsonb NOT NULL DEFAULT '[]',
        ADD COLUMN "scope_services" jsonb NOT NULL DEFAULT '[]',
        ADD COLUMN "scope_other" character varying
    `);

    // ---- 4. property proof-of-ownership ----
    await queryRunner.query(
      `ALTER TABLE "landlord_onboarding_properties" ADD COLUMN "ownership_documents" jsonb NOT NULL DEFAULT '[]'`,
    );

    // ---- 5. backfill `data` for existing submissions (reconstruct wizard state) ----
    const submissions: Array<{
      id: string;
      landlord_first_name: string | null;
      landlord_last_name: string | null;
      landlord_phone: string | null;
      country_code: string | null;
    }> = await queryRunner.query(
      `SELECT "id", "landlord_first_name", "landlord_last_name", "landlord_phone", "country_code"
       FROM "landlord_onboarding_submissions" WHERE "data" IS NULL`,
    );

    for (const s of submissions) {
      const props: Array<{
        id: string;
        description: string;
        address: string;
        occupancy_status: string;
        rent: string | null;
        service_charge: string | null;
        tenant_first_name: string | null;
        tenant_last_name: string | null;
        tenant_phone: string | null;
        tenant_email: string | null;
        tenancy_type: string | null;
        custom_duration: string | null;
        tenancy_start_date: string | null;
        tenancy_end_date: string | null;
        documents: unknown;
      }> = await queryRunner.query(
        // Cast the date columns to text so they serialize as 'YYYY-MM-DD' (the
        // wizard's date shape) rather than node-postgres Date → full ISO string.
        `SELECT "id", "description", "address", "occupancy_status", "rent",
                "service_charge", "tenant_first_name", "tenant_last_name",
                "tenant_phone", "tenant_email", "tenancy_type", "custom_duration",
                "tenancy_start_date"::text AS "tenancy_start_date",
                "tenancy_end_date"::text AS "tenancy_end_date", "documents"
           FROM "landlord_onboarding_properties"
          WHERE "submission_id" = $1 ORDER BY "created_at" ASC`,
        [s.id],
      );

      const landlordCc = s.country_code || this.splitPhone(s.landlord_phone).cc;
      const landlordLocal = this.splitPhone(s.landlord_phone).local;

      const properties = props.map((p, i) => {
        const t = this.splitPhone(p.tenant_phone);
        const toDigits = (v: string | null) =>
          v == null ? '' : String(v).replace(/[^\d]/g, '');
        return {
          id: Date.now() + i,
          description: p.description || '',
          address: p.address || '',
          occupied: p.occupancy_status,
          rent: toDigits(p.rent),
          service: toDigits(p.service_charge),
          tFirst: p.tenant_first_name || '',
          tLast: p.tenant_last_name || '',
          tCc: t.cc,
          tPhone: t.local,
          tEmail: p.tenant_email || '',
          type: p.tenancy_type || 'Annual',
          customDur: p.custom_duration || '',
          start: p.tenancy_start_date || '',
          end: p.tenancy_end_date || '',
          endAuto: false,
          docs: Array.isArray(p.documents) ? p.documents : [],
          proofDocs: [],
        };
      });

      const data = {
        step: 1,
        landlordType: null,
        firstName: s.landlord_first_name || '',
        lastName: s.landlord_last_name || '',
        email: '',
        cc: landlordCc,
        phone: landlordLocal,
        dob: '',
        employment: null,
        address: '',
        corpName: '',
        idType: '',
        idDocs: [],
        corpDocs: [],
        scopeServices: [],
        scopeOther: '',
        properties,
      };

      await queryRunner.query(
        `UPDATE "landlord_onboarding_submissions" SET "data" = $1 WHERE "id" = $2`,
        [JSON.stringify(data), s.id],
      );
    }

    // ---- 6. unique (admin_id, landlord_phone); drop the retired drafts table ----
    await queryRunner.query(
      `ALTER TABLE "landlord_onboarding_submissions" ADD CONSTRAINT "UQ_landlord_onboarding_submissions_admin_phone" UNIQUE ("admin_id", "landlord_phone")`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "landlord_onboarding_drafts"`,
    );

    // ---- 7. Live Feed: new notification type for onboarding submissions ----
    // Added (not used) in this transaction, so ADD VALUE is safe on PG 12+.
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS 'Onboarding Submitted'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate the retired drafts table.
    await queryRunner.query(`
      CREATE TABLE "landlord_onboarding_drafts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "admin_id" uuid NOT NULL,
        "phone_number" character varying NOT NULL,
        "data" jsonb NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "PK_landlord_onboarding_drafts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_landlord_onboarding_drafts_admin_phone" UNIQUE ("admin_id", "phone_number")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_landlord_onboarding_drafts_admin_id" ON "landlord_onboarding_drafts" ("admin_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "landlord_onboarding_submissions" DROP CONSTRAINT "UQ_landlord_onboarding_submissions_admin_phone"`,
    );
    await queryRunner.query(
      `ALTER TABLE "landlord_onboarding_properties" DROP COLUMN "ownership_documents"`,
    );
    await queryRunner.query(`
      ALTER TABLE "landlord_onboarding_submissions"
        DROP COLUMN "data",
        DROP COLUMN "landlord_type",
        DROP COLUMN "email",
        DROP COLUMN "date_of_birth",
        DROP COLUMN "employment_status",
        DROP COLUMN "address",
        DROP COLUMN "company_name",
        DROP COLUMN "id_type",
        DROP COLUMN "id_documents",
        DROP COLUMN "corporate_documents",
        DROP COLUMN "scope_services",
        DROP COLUMN "scope_other"
    `);
    await queryRunner.query(
      `DROP TYPE "landlord_onboarding_submissions_landlord_type_enum"`,
    );

    // Restore submitted-only columns to NOT NULL (best-effort; assumes no drafts).
    await queryRunner.query(
      `ALTER TABLE "landlord_onboarding_submissions" ALTER COLUMN "submitted_at" SET DEFAULT now()`,
    );
    await queryRunner.query(
      `UPDATE "landlord_onboarding_submissions" SET "submitted_at" = now() WHERE "submitted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "landlord_onboarding_submissions" ALTER COLUMN "submitted_at" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "landlord_onboarding_submissions" ALTER COLUMN "landlord_last_name" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "landlord_onboarding_submissions" ALTER COLUMN "landlord_first_name" SET NOT NULL`,
    );

    // Revert the status enum to its original 3 values.
    await queryRunner.query(
      `ALTER TABLE "landlord_onboarding_submissions" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `UPDATE "landlord_onboarding_submissions" SET "status" = 'pending' WHERE "status" = 'draft'`,
    );
    await queryRunner.query(
      `ALTER TYPE "landlord_onboarding_submissions_status_enum" RENAME TO "landlord_onboarding_submissions_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "landlord_onboarding_submissions_status_enum" AS ENUM('pending', 'approved', 'rejected')`,
    );
    await queryRunner.query(
      `ALTER TABLE "landlord_onboarding_submissions" ALTER COLUMN "status" TYPE "landlord_onboarding_submissions_status_enum" USING "status"::text::"landlord_onboarding_submissions_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "landlord_onboarding_submissions" ALTER COLUMN "status" SET DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `DROP TYPE "landlord_onboarding_submissions_status_enum_old"`,
    );
  }
}

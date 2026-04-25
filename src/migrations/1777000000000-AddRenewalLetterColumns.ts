import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renewal letter flow — extend renewal_invoices so each row carries the
 * tenant-facing "renewal letter" lifecycle (draft / sent / accepted /
 * declined) alongside the existing payment lifecycle.
 *
 * Also adds supersession columns so editing a letter that was already
 * sent or accepted creates a NEW row that points back to the previous
 * version via supersedes_id, and the old row gets superseded_by_id set —
 * keeping in-the-wild WhatsApp tokens auditable and append-only while
 * redirecting live traffic to the current version.
 *
 * Backfills letter_status='accepted' on existing landlord-type rows so
 * tenants whose WhatsApp invoice link predates this feature can still
 * pay directly (the new payment gate requires letter_status='accepted').
 * Those rows never went through the OTP flow, so accepted_by_phone /
 * acceptance_otp stay NULL — the tenant page suppresses the rubber
 * stamp when those fields are absent.
 */
export class AddRenewalLetterColumns1777000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "renewal_letter_status_enum"
          AS ENUM ('draft', 'sent', 'accepted', 'declined');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
        ADD COLUMN IF NOT EXISTS "letter_status" "renewal_letter_status_enum" NOT NULL DEFAULT 'draft',
        ADD COLUMN IF NOT EXISTS "letter_body_html" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "letter_body_fields" JSONB NULL,
        ADD COLUMN IF NOT EXISTS "letter_sent_at" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "accepted_at" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "accepted_by_phone" VARCHAR(16) NULL,
        ADD COLUMN IF NOT EXISTS "acceptance_otp" VARCHAR(8) NULL,
        ADD COLUMN IF NOT EXISTS "decision_made_at" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "decision_made_ip" VARCHAR(64) NULL,
        ADD COLUMN IF NOT EXISTS "declined_at" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "decline_reason" VARCHAR(500) NULL,
        ADD COLUMN IF NOT EXISTS "supersedes_id" UUID NULL,
        ADD COLUMN IF NOT EXISTS "superseded_by_id" UUID NULL,
        ADD COLUMN IF NOT EXISTS "superseded_at" TIMESTAMPTZ NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
        ADD CONSTRAINT "fk_renewal_invoices_supersedes"
          FOREIGN KEY ("supersedes_id")
          REFERENCES "renewal_invoices"("id")
          ON DELETE SET NULL,
        ADD CONSTRAINT "fk_renewal_invoices_superseded_by"
          FOREIGN KEY ("superseded_by_id")
          REFERENCES "renewal_invoices"("id")
          ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_renewal_invoices_letter_status"
        ON "renewal_invoices"("letter_status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_renewal_invoices_pt_status"
        ON "renewal_invoices"("property_tenant_id", "letter_status", "payment_status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_renewal_invoices_superseded_by"
        ON "renewal_invoices"("superseded_by_id")
        WHERE "superseded_by_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_renewal_invoices_current_per_pt"
        ON "renewal_invoices"("property_tenant_id", "created_at" DESC)
        WHERE "superseded_by_id" IS NULL
    `);

    // Backfill existing landlord-type rows. Mark them as already-accepted
    // so tenants whose WhatsApp invoice link predates the new flow can
    // still reach the payment page (which now requires letter_status =
    // 'accepted'). They never went through OTP, so accepted_by_phone /
    // acceptance_otp stay NULL and the tenant page hides the stamp.
    await queryRunner.query(`
      UPDATE "renewal_invoices"
      SET "letter_status" = 'accepted',
          "accepted_at"   = COALESCE("updated_at", "created_at")
      WHERE "token_type" = 'landlord'
        AND "letter_body_html" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_renewal_invoices_current_per_pt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_renewal_invoices_superseded_by"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_renewal_invoices_pt_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_renewal_invoices_letter_status"`,
    );

    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
        DROP CONSTRAINT IF EXISTS "fk_renewal_invoices_superseded_by",
        DROP CONSTRAINT IF EXISTS "fk_renewal_invoices_supersedes"
    `);

    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
        DROP COLUMN IF EXISTS "superseded_at",
        DROP COLUMN IF EXISTS "superseded_by_id",
        DROP COLUMN IF EXISTS "supersedes_id",
        DROP COLUMN IF EXISTS "decline_reason",
        DROP COLUMN IF EXISTS "declined_at",
        DROP COLUMN IF EXISTS "decision_made_ip",
        DROP COLUMN IF EXISTS "decision_made_at",
        DROP COLUMN IF EXISTS "acceptance_otp",
        DROP COLUMN IF EXISTS "accepted_by_phone",
        DROP COLUMN IF EXISTS "accepted_at",
        DROP COLUMN IF EXISTS "letter_sent_at",
        DROP COLUMN IF EXISTS "letter_body_fields",
        DROP COLUMN IF EXISTS "letter_body_html",
        DROP COLUMN IF EXISTS "letter_status"
    `);

    await queryRunner.query(
      `DROP TYPE IF EXISTS "renewal_letter_status_enum"`,
    );
  }
}

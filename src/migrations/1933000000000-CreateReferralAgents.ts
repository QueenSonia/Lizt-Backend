import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Referral agents — the identity behind `kyc_applications.referral_agent_*`.
 *
 * An agent is identified by their PHONE NUMBER. `kyc_applications` stays the sole
 * source of truth for referral *facts* (who referred whom, every name ever typed,
 * counts) — this table deliberately duplicates almost nothing. It holds only:
 *
 *   • `first_seen_name` — the first name ever recorded for that number. WRITE-ONCE:
 *     later submissions can never be earlier, so the value is immutable and the
 *     write is a plain `ON CONFLICT DO NOTHING`. There is no update path, hence no
 *     sync to drift. It is materialised (rather than derived per read) purely so the
 *     tenant-facing KYC autocomplete is an indexed lookup on a small table instead of
 *     a contains-scan over every application on each keystroke.
 *   • `official_name` — an admin's override. Exists nowhere else, so nothing to drift.
 *
 * Display name is always `COALESCE(official_name, first_seen_name)`.
 *
 * `phone` matches `kyc_applications.referral_agent_phone_number` byte-for-byte: that
 * column is already normalised to E.164 digits at write time by @NormalizePhoneNumber(),
 * so no separate normalised column is needed.
 *
 * The backfill is idempotent and is also the repair query — re-running it re-seeds any
 * agent whose insert was ever missed, which is safe precisely because the column is
 * write-once.
 */
export class CreateReferralAgents1933000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "referral_agents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "phone" character varying NOT NULL,
        "first_seen_name" character varying NOT NULL,
        "official_name" character varying,
        "set_by" uuid,
        "set_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "PK_referral_agents" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_referral_agents_phone" UNIQUE ("phone")
      )
    `);

    // Serves the agents-page rollup and the exact-phone lookup.
    await queryRunner.query(
      `CREATE INDEX "IDX_kyc_applications_referral_agent_phone" ON "kyc_applications" ("referral_agent_phone_number")`,
    );

    // Backfill: one row per referral phone, carrying the EARLIEST name seen for it.
    // DISTINCT ON + ORDER BY created_at ASC picks that first-ever name.
    await queryRunner.query(`
      INSERT INTO "referral_agents" ("phone", "first_seen_name")
      SELECT DISTINCT ON (btrim("referral_agent_phone_number"))
             btrim("referral_agent_phone_number"),
             btrim("referral_agent_full_name")
      FROM "kyc_applications"
      WHERE "deleted_at" IS NULL
        AND "referral_agent_phone_number" IS NOT NULL
        AND btrim("referral_agent_phone_number") <> ''
        AND "referral_agent_full_name" IS NOT NULL
        AND btrim("referral_agent_full_name") <> ''
      ORDER BY btrim("referral_agent_phone_number"), "created_at" ASC
      ON CONFLICT ("phone") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_kyc_applications_referral_agent_phone"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "referral_agents"`);
  }
}

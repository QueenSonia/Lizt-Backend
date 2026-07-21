import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Landlord self-service onboarding — capture side (Milestone 1).
 *
 * Creates the tables behind the public onboarding wizard: a per-admin reusable
 * link, the submitted landlord + their property portfolio, plus the OTP and
 * draft tables that back "save & continue later". No landlord/property/tenant
 * records are provisioned from these yet — approval is a later milestone, so
 * `landlord_onboarding_submissions.status` already carries the full lifecycle.
 *
 * `synchronize` is off in every environment, so this migration is the sole
 * source of truth for the schema. Enum type names follow TypeORM's
 * `<table>_<column>_enum` convention and `id` defaults to `uuid_generate_v4()`
 * so a future `migration:generate` diffs cleanly against the entities.
 */
export class CreateLandlordOnboarding1932000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "landlord_onboarding_links" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "token" uuid NOT NULL,
        "admin_id" uuid NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "PK_landlord_onboarding_links" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_landlord_onboarding_links_token" UNIQUE ("token")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_landlord_onboarding_links_admin_id" ON "landlord_onboarding_links" ("admin_id")`,
    );

    await queryRunner.query(
      `CREATE TYPE "landlord_onboarding_submissions_status_enum" AS ENUM('pending', 'approved', 'rejected')`,
    );
    await queryRunner.query(`
      CREATE TABLE "landlord_onboarding_submissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "admin_id" uuid NOT NULL,
        "landlord_first_name" character varying NOT NULL,
        "landlord_last_name" character varying NOT NULL,
        "landlord_phone" character varying NOT NULL,
        "country_code" character varying,
        "status" "landlord_onboarding_submissions_status_enum" NOT NULL DEFAULT 'pending',
        "submitted_at" TIMESTAMP NOT NULL DEFAULT now(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "PK_landlord_onboarding_submissions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_landlord_onboarding_submissions_admin_id" ON "landlord_onboarding_submissions" ("admin_id")`,
    );

    await queryRunner.query(
      `CREATE TYPE "landlord_onboarding_properties_occupancy_status_enum" AS ENUM('occupied', 'vacant')`,
    );
    await queryRunner.query(`
      CREATE TABLE "landlord_onboarding_properties" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "submission_id" uuid NOT NULL,
        "description" text NOT NULL,
        "address" text NOT NULL,
        "occupancy_status" "landlord_onboarding_properties_occupancy_status_enum" NOT NULL,
        "rent" numeric(12,2),
        "service_charge" numeric(12,2),
        "tenant_first_name" character varying,
        "tenant_last_name" character varying,
        "tenant_phone" character varying,
        "tenant_email" character varying,
        "tenancy_type" character varying,
        "custom_duration" character varying,
        "tenancy_start_date" date,
        "tenancy_end_date" date,
        "documents" jsonb NOT NULL DEFAULT '[]',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "PK_landlord_onboarding_properties" PRIMARY KEY ("id"),
        CONSTRAINT "FK_landlord_onboarding_properties_submission" FOREIGN KEY ("submission_id")
          REFERENCES "landlord_onboarding_submissions" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_landlord_onboarding_properties_submission_id" ON "landlord_onboarding_properties" ("submission_id")`,
    );

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

    await queryRunner.query(`
      CREATE TABLE "landlord_onboarding_otp" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "phone_number" character varying NOT NULL,
        "otp_code" character varying NOT NULL,
        "token" character varying NOT NULL,
        "is_verified" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT true,
        "expires_at" TIMESTAMP NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "PK_landlord_onboarding_otp" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_landlord_onboarding_otp_phone_number" ON "landlord_onboarding_otp" ("phone_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_landlord_onboarding_otp_token" ON "landlord_onboarding_otp" ("token")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "landlord_onboarding_otp"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "landlord_onboarding_drafts"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "landlord_onboarding_properties"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "landlord_onboarding_properties_occupancy_status_enum"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "landlord_onboarding_submissions"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "landlord_onboarding_submissions_status_enum"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "landlord_onboarding_links"`);
  }
}

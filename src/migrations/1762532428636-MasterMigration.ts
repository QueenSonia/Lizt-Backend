import { MigrationInterface, QueryRunner } from 'typeorm';

export class MasterMigration1762532428636 implements MigrationInterface {
  name = 'MasterMigration1762532428636';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add payment_frequency to rents table first (before dropping from properties)
    await queryRunner.query(
      `ALTER TABLE "rents" ADD "payment_frequency" character varying`,
    );

    // Migrate payment_frequency data from properties to rents
    // This updates all rent records with the payment_frequency from their associated property
    await queryRunner.query(
      `UPDATE "rents" r SET "payment_frequency" = p."payment_frequency" FROM "properties" p WHERE r."property_id" = p."id" AND p."payment_frequency" IS NOT NULL`,
    );

    // Remove payment_frequency from properties (it belongs in rents table)
    await queryRunner.query(
      `ALTER TABLE "properties" DROP COLUMN "payment_frequency"`,
    );

    // Add no_of_bathrooms to properties as integer
    await queryRunner.query(
      `ALTER TABLE "properties" ADD "no_of_bathrooms" integer NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."kyc_applications_status_enum" AS ENUM('pending', 'approved', 'rejected')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."kyc_applications_gender_enum" AS ENUM('male', 'female', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."kyc_applications_marital_status_enum" AS ENUM('single', 'married', 'divorced', 'widowed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."kyc_applications_employment_status_enum" AS ENUM('employed', 'self-employed', 'unemployed', 'student')`,
    );
    await queryRunner.query(
      `CREATE TABLE "kyc_applications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, "kyc_link_id" uuid NOT NULL, "property_id" uuid NOT NULL, "status" "public"."kyc_applications_status_enum" NOT NULL DEFAULT 'pending', "tenant_id" uuid, "first_name" character varying NOT NULL, "last_name" character varying NOT NULL, "email" character varying, "phone_number" character varying NOT NULL, "date_of_birth" date, "gender" "public"."kyc_applications_gender_enum", "nationality" character varying, "state_of_origin" character varying, "local_government_area" character varying, "marital_status" "public"."kyc_applications_marital_status_enum", "employment_status" "public"."kyc_applications_employment_status_enum", "occupation" character varying, "job_title" character varying, "employer_name" character varying, "employer_address" character varying, "monthly_net_income" character varying, "reference1_name" character varying, "reference1_address" character varying, "reference1_relationship" character varying, "reference1_phone_number" character varying, "reference2_name" character varying, "reference2_address" character varying, "reference2_relationship" character varying, "reference2_phone_number" character varying, CONSTRAINT "PK_71df628b27c9834924e0afaa26e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "kyc_links" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, "token" uuid NOT NULL, "property_id" uuid NOT NULL, "landlord_id" uuid NOT NULL, "expires_at" TIMESTAMP NOT NULL, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "UQ_809f622953947e1890c31ae61d2" UNIQUE ("token"), CONSTRAINT "PK_f8865bd8d5943a86972178a9476" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."scheduled_move_outs_move_out_reason_enum" AS ENUM('lease_ended', 'eviction', 'early_termination', 'mutual_agreement', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "scheduled_move_outs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, "property_id" uuid NOT NULL, "tenant_id" uuid NOT NULL, "effective_date" date NOT NULL, "move_out_reason" "public"."scheduled_move_outs_move_out_reason_enum", "owner_comment" text, "tenant_comment" text, "processed" boolean NOT NULL DEFAULT false, "processed_at" TIMESTAMP, CONSTRAINT "PK_3b2ac36d8aa6b2c932f0157d1a7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "kyc_otp" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "phone_number" character varying NOT NULL, "otp_code" character varying NOT NULL, "kyc_token" character varying NOT NULL, "is_verified" boolean NOT NULL DEFAULT false, "is_active" boolean NOT NULL DEFAULT true, "expires_at" TIMESTAMP NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e21705d72ccfd98d4ee4201324a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ALTER COLUMN "state_of_origin" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ALTER COLUMN "local_government_area" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ALTER COLUMN "occupation" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ALTER COLUMN "job_title" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ALTER COLUMN "monthly_net_income" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ALTER COLUMN "reference1_name" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ALTER COLUMN "reference1_address" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ALTER COLUMN "reference1_relationship" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ALTER COLUMN "reference1_phone_number" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."properties_property_status_enum" RENAME TO "properties_property_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."properties_property_status_enum" AS ENUM('occupied', 'vacant', 'inactive')`,
    );
    await queryRunner.query(
      `ALTER TABLE "properties" ALTER COLUMN "property_status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "properties" ALTER COLUMN "property_status" TYPE "public"."properties_property_status_enum" USING "property_status"::"text"::"public"."properties_property_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "properties" ALTER COLUMN "property_status" SET DEFAULT 'vacant'`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."properties_property_status_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_applications" ADD CONSTRAINT "FK_e003d696fe7c362226fe5a25093" FOREIGN KEY ("kyc_link_id") REFERENCES "kyc_links"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_applications" ADD CONSTRAINT "FK_6c2a11bd643879aaa681eaedb0a" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_applications" ADD CONSTRAINT "FK_1e9cda2c8f2f7bb61fed1167c12" FOREIGN KEY ("tenant_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_links" ADD CONSTRAINT "FK_13ba2c7ee888e9f0630cd7d189b" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_links" ADD CONSTRAINT "FK_33574574819109b0ba1a7469e61" FOREIGN KEY ("landlord_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "kyc_links" DROP CONSTRAINT "FK_33574574819109b0ba1a7469e61"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_links" DROP CONSTRAINT "FK_13ba2c7ee888e9f0630cd7d189b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_applications" DROP CONSTRAINT "FK_1e9cda2c8f2f7bb61fed1167c12"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_applications" DROP CONSTRAINT "FK_6c2a11bd643879aaa681eaedb0a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_applications" DROP CONSTRAINT "FK_e003d696fe7c362226fe5a25093"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."properties_property_status_enum_old" AS ENUM('occupied', 'vacant')`,
    );
    await queryRunner.query(
      `ALTER TABLE "properties" ALTER COLUMN "property_status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "properties" ALTER COLUMN "property_status" TYPE "public"."properties_property_status_enum_old" USING "property_status"::"text"::"public"."properties_property_status_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "properties" ALTER COLUMN "property_status" SET DEFAULT 'vacant'`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."properties_property_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."properties_property_status_enum_old" RENAME TO "properties_property_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ALTER COLUMN "reference1_phone_number" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ALTER COLUMN "reference1_relationship" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ALTER COLUMN "reference1_address" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ALTER COLUMN "reference1_name" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ALTER COLUMN "monthly_net_income" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ALTER COLUMN "job_title" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ALTER COLUMN "occupation" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ALTER COLUMN "local_government_area" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ALTER COLUMN "state_of_origin" SET NOT NULL`,
    );
    // Migrate payment_frequency data back from rents to properties (rollback)
    await queryRunner.query(
      `UPDATE "properties" p SET "payment_frequency" = (SELECT r."payment_frequency" FROM "rents" r WHERE r."property_id" = p."id" AND r."payment_frequency" IS NOT NULL ORDER BY r."created_at" DESC LIMIT 1)`,
    );

    await queryRunner.query(
      `ALTER TABLE "rents" DROP COLUMN "payment_frequency"`,
    );
    await queryRunner.query(`DROP TABLE "kyc_otp"`);
    await queryRunner.query(`DROP TABLE "scheduled_move_outs"`);
    await queryRunner.query(
      `DROP TYPE "public"."scheduled_move_outs_move_out_reason_enum"`,
    );
    await queryRunner.query(`DROP TABLE "kyc_links"`);
    await queryRunner.query(`DROP TABLE "kyc_applications"`);
    await queryRunner.query(
      `DROP TYPE "public"."kyc_applications_employment_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."kyc_applications_marital_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."kyc_applications_gender_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."kyc_applications_status_enum"`,
    );
    // Rollback: remove no_of_bathrooms and restore payment_frequency to properties
    await queryRunner.query(
      `ALTER TABLE "properties" DROP COLUMN "no_of_bathrooms"`,
    );
    await queryRunner.query(
      `ALTER TABLE "properties" ADD "payment_frequency" character varying`,
    );
  }
}

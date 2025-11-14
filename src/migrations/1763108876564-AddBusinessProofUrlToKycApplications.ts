import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessProofUrlToKycApplications1763108876564
  implements MigrationInterface
{
  name = 'AddBusinessProofUrlToKycApplications1763108876564';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_property_histories_event_type"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_property_histories_related_entity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_applications" ADD COLUMN IF NOT EXISTS "business_proof_url" character varying`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" RENAME TO "notification_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notification_type_enum" AS ENUM('Service Request', 'Notice Agreement', 'Rent Created', 'User Added to Property', 'User Signed Up', 'Lease Signed', 'Property Created', 'KYC Submitted')`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" ALTER COLUMN "type" TYPE "public"."notification_type_enum" USING "type"::"text"::"public"."notification_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."notification_type_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."notification_type_enum_old" AS ENUM('Service Request', 'Notice Agreement', 'Rent Created', 'User Added to Property', 'User Signed Up', 'Lease Signed', 'Property Created')`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" ALTER COLUMN "type" TYPE "public"."notification_type_enum_old" USING "type"::"text"::"public"."notification_type_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."notification_type_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum_old" RENAME TO "notification_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_applications" DROP COLUMN "business_proof_url"`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_histories_related_entity" ON "property_histories" ("related_entity_id", "related_entity_type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_property_histories_event_type" ON "property_histories" ("event_type") `,
    );
  }
}

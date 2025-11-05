import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeTenantKYCFieldsNullable1762400000000
  implements MigrationInterface
{
  name = 'MakeTenantKYCFieldsNullable1762400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Make state_of_origin nullable
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "state_of_origin" DROP NOT NULL`,
    );

    // Make local_government_area nullable
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "local_government_area" DROP NOT NULL`,
    );

    // Make occupation nullable
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "occupation" DROP NOT NULL`,
    );

    // Make job_title nullable
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "job_title" DROP NOT NULL`,
    );

    // Make monthly_net_income nullable
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "monthly_net_income" DROP NOT NULL`,
    );

    // Make reference1_name nullable
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "reference1_name" DROP NOT NULL`,
    );

    // Make reference1_address nullable
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "reference1_address" DROP NOT NULL`,
    );

    // Make reference1_relationship nullable
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "reference1_relationship" DROP NOT NULL`,
    );

    // Make reference1_phone_number nullable
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "reference1_phone_number" DROP NOT NULL`,
    );

    // Make admin_id nullable
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "admin_id" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert reference1_phone_number to NOT NULL
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "reference1_phone_number" SET NOT NULL`,
    );

    // Revert reference1_relationship to NOT NULL
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "reference1_relationship" SET NOT NULL`,
    );

    // Revert reference1_address to NOT NULL
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "reference1_address" SET NOT NULL`,
    );

    // Revert reference1_name to NOT NULL
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "reference1_name" SET NOT NULL`,
    );

    // Revert monthly_net_income to NOT NULL
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "monthly_net_income" SET NOT NULL`,
    );

    // Revert job_title to NOT NULL
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "job_title" SET NOT NULL`,
    );

    // Revert occupation to NOT NULL
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "occupation" SET NOT NULL`,
    );

    // Revert local_government_area to NOT NULL
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "local_government_area" SET NOT NULL`,
    );

    // Revert state_of_origin to NOT NULL
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "state_of_origin" SET NOT NULL`,
    );

    // Revert admin_id to NOT NULL
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_kyc" ALTER COLUMN "admin_id" SET NOT NULL`,
    );
  }
}

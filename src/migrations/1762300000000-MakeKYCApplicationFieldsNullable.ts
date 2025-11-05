import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeKYCApplicationFieldsNullable1762300000000
  implements MigrationInterface
{
  name = 'MakeKYCApplicationFieldsNullable1762300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Make email field nullable
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "email" DROP NOT NULL`,
    );

    // Make date_of_birth field nullable
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "date_of_birth" DROP NOT NULL`,
    );

    // Make gender field nullable
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "gender" DROP NOT NULL`,
    );

    // Make nationality field nullable
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "nationality" DROP NOT NULL`,
    );

    // Make state_of_origin field nullable
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "state_of_origin" DROP NOT NULL`,
    );

    // Make local_government_area field nullable
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "local_government_area" DROP NOT NULL`,
    );

    // Make marital_status field nullable
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "marital_status" DROP NOT NULL`,
    );

    // Make employment_status field nullable
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "employment_status" DROP NOT NULL`,
    );

    // Make occupation field nullable
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "occupation" DROP NOT NULL`,
    );

    // Make job_title field nullable
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "job_title" DROP NOT NULL`,
    );

    // Make monthly_net_income field nullable
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "monthly_net_income" DROP NOT NULL`,
    );

    // Make reference1_name field nullable
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "reference1_name" DROP NOT NULL`,
    );

    // Make reference1_address field nullable
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "reference1_address" DROP NOT NULL`,
    );

    // Make reference1_relationship field nullable
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "reference1_relationship" DROP NOT NULL`,
    );

    // Make reference1_phone_number field nullable
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "reference1_phone_number" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse the changes - make fields NOT NULL again
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "reference1_phone_number" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "reference1_relationship" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "reference1_address" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "reference1_name" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "monthly_net_income" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "job_title" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "occupation" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "employment_status" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "marital_status" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "local_government_area" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "state_of_origin" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "nationality" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "gender" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "date_of_birth" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."kyc_applications" ALTER COLUMN "email" SET NOT NULL`,
    );
  }
}

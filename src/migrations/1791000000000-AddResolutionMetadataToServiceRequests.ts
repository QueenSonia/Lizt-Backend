import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddResolutionMetadataToServiceRequests1791000000000
  implements MigrationInterface
{
  name = 'AddResolutionMetadataToServiceRequests1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "service_requests" ADD COLUMN IF NOT EXISTS "resolution_cost_minor" INTEGER NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_requests" ADD COLUMN IF NOT EXISTS "resolution_category" VARCHAR(64) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_requests" ADD COLUMN IF NOT EXISTS "resolution_summary" TEXT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "service_requests" DROP COLUMN IF EXISTS "resolution_summary"`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_requests" DROP COLUMN IF EXISTS "resolution_category"`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_requests" DROP COLUMN IF EXISTS "resolution_cost_minor"`,
    );
  }
}

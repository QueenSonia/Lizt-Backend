import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateServiceRequestSchema1763981310757
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update Enum
    await queryRunner.query(
      `ALTER TYPE "public"."service_requests_status_enum" ADD VALUE IF NOT EXISTS 'OPEN'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."service_requests_status_enum" ADD VALUE IF NOT EXISTS 'CLOSED'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."service_requests_status_enum" ADD VALUE IF NOT EXISTS 'REOPENED'`,
    );

    // Add Column
    await queryRunner.query(
      `ALTER TABLE "service_requests" ADD COLUMN IF NOT EXISTS "reopened_at" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "service_requests" DROP COLUMN IF EXISTS "reopened_at"`,
    );
  }
}

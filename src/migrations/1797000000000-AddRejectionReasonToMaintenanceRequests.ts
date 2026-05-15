import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRejectionReasonToMaintenanceRequests1797000000000
  implements MigrationInterface
{
  name = 'AddRejectionReasonToMaintenanceRequests1797000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "maintenance_requests"
       ADD COLUMN IF NOT EXISTS "rejection_reason" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "maintenance_requests"
       DROP COLUMN IF EXISTS "rejection_reason"`,
    );
  }
}

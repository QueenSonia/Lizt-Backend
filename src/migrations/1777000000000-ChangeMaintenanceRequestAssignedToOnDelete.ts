import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangeMaintenanceRequestAssignedToOnDelete1777000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "maintenance_requests"
         DROP CONSTRAINT "FK_b9163ff5841a27e8a34874ec935",
         ADD CONSTRAINT "FK_b9163ff5841a27e8a34874ec935"
           FOREIGN KEY ("assigned_to") REFERENCES "team_member"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "maintenance_requests"
         DROP CONSTRAINT "FK_b9163ff5841a27e8a34874ec935",
         ADD CONSTRAINT "FK_b9163ff5841a27e8a34874ec935"
           FOREIGN KEY ("assigned_to") REFERENCES "team_member"("id") ON DELETE CASCADE`,
    );
  }
}

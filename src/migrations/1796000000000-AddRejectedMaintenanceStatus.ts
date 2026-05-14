import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRejectedMaintenanceStatus1796000000000
  implements MigrationInterface
{
  name = 'AddRejectedMaintenanceStatus1796000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'rejected'
          AND enumtypid = (
            SELECT oid FROM pg_type WHERE typname = 'maintenance_requests_status_enum'
          )
        ) THEN
          ALTER TYPE "public"."maintenance_requests_status_enum" ADD VALUE 'rejected';
        END IF;
      END $$;`,
    );
  }

  public async down(): Promise<void> {
    // Postgres can't drop enum values without rebuilding the type. Leaving
    // as a no-op — manual intervention required for rollback.
    console.log(
      'Warning: Cannot automatically remove enum value "rejected". Manual intervention required if rollback is necessary.',
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the tenant-confirmation flow for FM-filed maintenance requests:
 *   - Two new statuses (`pending_tenant_confirmation`, `denied_by_tenant`) on
 *     `maintenance_requests_status_enum`.
 *   - The same two values, plus the previously-missed `rejected`, on the
 *     status-history previous/new enums. Without `rejected` here,
 *     `rejectMaintenanceRequest` would 22P02 when writing its history row.
 *   - Drops NOT NULL on `maintenance_requests.tenant_name` so FM-filed rows
 *     can store NULL instead of the placeholder string `'—'` that today leaks
 *     into landlord notifications.
 */
export class AddTenantConfirmationFlow1799000000000
  implements MigrationInterface
{
  name = 'AddTenantConfirmationFlow1799000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const addEnumValue = async (enumName: string, value: string) => {
      await queryRunner.query(
        `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_enum
            WHERE enumlabel = '${value}'
            AND enumtypid = (
              SELECT oid FROM pg_type WHERE typname = '${enumName}'
            )
          ) THEN
            ALTER TYPE "public"."${enumName}" ADD VALUE '${value}';
          END IF;
        END $$;`,
      );
    };

    await addEnumValue(
      'maintenance_requests_status_enum',
      'pending_tenant_confirmation',
    );
    await addEnumValue(
      'maintenance_requests_status_enum',
      'denied_by_tenant',
    );

    await addEnumValue(
      'maintenance_request_status_history_previous_status_enum',
      'rejected',
    );
    await addEnumValue(
      'maintenance_request_status_history_previous_status_enum',
      'pending_tenant_confirmation',
    );
    await addEnumValue(
      'maintenance_request_status_history_previous_status_enum',
      'denied_by_tenant',
    );

    await addEnumValue(
      'maintenance_request_status_history_new_status_enum',
      'rejected',
    );
    await addEnumValue(
      'maintenance_request_status_history_new_status_enum',
      'pending_tenant_confirmation',
    );
    await addEnumValue(
      'maintenance_request_status_history_new_status_enum',
      'denied_by_tenant',
    );

    await queryRunner.query(
      `ALTER TABLE "maintenance_requests" ALTER COLUMN "tenant_name" DROP NOT NULL;`,
    );

    // Allow common-area maintenance-request notifications (which carry no
    // direct property reference) to write without a property_id. Before this,
    // `notificationService.create` calls from the maintenance.created listener
    // for FM-filed common-area MRs were silently failing the INSERT.
    await queryRunner.query(
      `ALTER TABLE "notification" ALTER COLUMN "property_id" DROP NOT NULL;`,
    );
  }

  public async down(): Promise<void> {
    // Postgres can't drop enum values without rebuilding the type. The
    // tenant_name NOT NULL can be restored but only if no rows have NULLs —
    // we leave it relaxed. Manual intervention required for a true rollback.
    console.log(
      'Warning: AddTenantConfirmationFlow cannot be automatically rolled back. Manual intervention required.',
    );
  }
}

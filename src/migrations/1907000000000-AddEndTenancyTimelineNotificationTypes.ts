import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the notification-enum values for the End-Tenancy lifecycle timeline +
 * live-feed entries:
 *   - 'Renewal Deactivated'      (landlord deactivates a renewal / lapse)
 *   - 'Removal Scheduled'        (landlord schedules a forced removal on a date)
 *   - 'Scheduled End Cancelled'  (landlord reactivates a lapse / cancels a removal)
 *
 * Without these, the in-app NotificationService.create call for those actions
 * fails the enum check and is swallowed by its caller's catch (the timeline
 * property_histories row still saves — event_type is a varchar, no enum).
 */
export class AddEndTenancyTimelineNotificationTypes1907000000000
  implements MigrationInterface
{
  name = 'AddEndTenancyTimelineNotificationTypes1907000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS 'Renewal Deactivated'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS 'Removal Scheduled'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS 'Scheduled End Cancelled'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres does not support removing values from an enum type without
    // recreating it. Leave the added values in place on rollback.
  }
}

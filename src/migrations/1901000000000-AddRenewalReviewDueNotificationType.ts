import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `Renewal Review Due` value to the notifications enum so the
 * landlord "review next period" heads-up (RentReminderService.sendLandlordReviewNotice)
 * can persist its in-app NotificationService entry. Without this the WhatsApp
 * still sends (queued first) but the in-app/livefeed write fails the enum
 * check and is swallowed by the caller's catch.
 */
export class AddRenewalReviewDueNotificationType1901000000000
  implements MigrationInterface
{
  name = 'AddRenewalReviewDueNotificationType1901000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS 'Renewal Review Due'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres does not support removing values from an enum type without
    // recreating it. Leave the added value in place on rollback.
  }
}

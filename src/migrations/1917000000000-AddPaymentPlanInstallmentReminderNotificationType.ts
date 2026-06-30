import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `Payment Plan Installment Reminder` value to the notifications enum
 * so RentReminderService.sendInstallmentReminder can persist an in-app
 * NotificationService entry — which is what surfaces a sent installment
 * reminder on the landlord Live Feed (the feed reads `notifications`, not
 * `property_history`). Without this the WhatsApp still sends (queued first)
 * and the property_history timeline row still saves, but the live-feed
 * notification fails the enum check and is swallowed by the caller's catch.
 *
 * Numbered 1917 (not 1909) to sit clear of in-flight migrations on sibling
 * branches (1909/1913/1916) that are pending deploy.
 */
export class AddPaymentPlanInstallmentReminderNotificationType1917000000000
  implements MigrationInterface
{
  name = 'AddPaymentPlanInstallmentReminderNotificationType1917000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS 'Payment Plan Installment Reminder'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres does not support removing values from an enum type without
    // recreating it. Leave the added value in place on rollback.
  }
}

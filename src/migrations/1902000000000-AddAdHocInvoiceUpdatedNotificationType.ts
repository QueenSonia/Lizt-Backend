import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `Ad-Hoc Invoice Updated` value to the notifications enum so the
 * landlord-facing edit of an ad-hoc invoice (AdHocInvoicesService.updateInvoice)
 * can persist its in-app NotificationService entry + livefeed/timeline write.
 * Without this the property_history row still saves but the in-app notification
 * fails the enum check and is swallowed by logInvoiceEvent's catch.
 */
export class AddAdHocInvoiceUpdatedNotificationType1902000000000
  implements MigrationInterface
{
  name = 'AddAdHocInvoiceUpdatedNotificationType1902000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS 'Ad-Hoc Invoice Updated'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres does not support removing values from an enum type without
    // recreating it. Leave the added value in place on rollback.
  }
}

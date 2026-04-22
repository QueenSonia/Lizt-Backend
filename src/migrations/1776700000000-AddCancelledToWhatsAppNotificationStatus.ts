import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCancelledToWhatsAppNotificationStatus1776700000000
  implements MigrationInterface
{
  name = 'AddCancelledToWhatsAppNotificationStatus1776700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."whatsapp_notification_log_status_enum" ADD VALUE IF NOT EXISTS 'cancelled'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres doesn't support removing an enum value cleanly; leave as a no-op.
  }
}

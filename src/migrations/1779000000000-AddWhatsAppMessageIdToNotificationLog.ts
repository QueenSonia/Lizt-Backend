import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWhatsAppMessageIdToNotificationLog1779000000000
  implements MigrationInterface
{
  name = 'AddWhatsAppMessageIdToNotificationLog1779000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_notification_log" ADD COLUMN IF NOT EXISTS "whatsapp_message_id" varchar`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_whatsapp_notification_log_wamid" ON "whatsapp_notification_log" ("whatsapp_message_id") WHERE "whatsapp_message_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_whatsapp_notification_log_wamid"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_notification_log" DROP COLUMN IF EXISTS "whatsapp_message_id"`,
    );
  }
}

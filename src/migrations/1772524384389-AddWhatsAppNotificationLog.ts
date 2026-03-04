import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWhatsAppNotificationLog1772524384389
  implements MigrationInterface
{
  name = 'AddWhatsAppNotificationLog1772524384389';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."whatsapp_notification_log_status_enum" AS ENUM('pending', 'sent', 'failed')`,
    );

    await queryRunner.query(`
      CREATE TABLE "whatsapp_notification_log" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "type" character varying NOT NULL,
        "payload" jsonb NOT NULL,
        "status" "public"."whatsapp_notification_log_status_enum" NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "last_attempted_at" TIMESTAMP,
        "last_error" text,
        "reference_id" uuid,
        CONSTRAINT "PK_whatsapp_notification_log" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_whatsapp_notification_log_status" ON "whatsapp_notification_log" ("status") WHERE "status" = 'pending'`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_whatsapp_notification_log_reference" ON "whatsapp_notification_log" ("reference_id") WHERE "reference_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_whatsapp_notification_log_reference"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_whatsapp_notification_log_status"`,
    );
    await queryRunner.query(`DROP TABLE "whatsapp_notification_log"`);
    await queryRunner.query(
      `DROP TYPE "public"."whatsapp_notification_log_status_enum"`,
    );
  }
}

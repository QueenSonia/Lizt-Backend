import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotificationAndHistoryIndexes1771000000000
  implements MigrationInterface
{
  name = 'AddNotificationAndHistoryIndexes1771000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Notifications table indexes
    await queryRunner.query(`
      CREATE INDEX "IDX_notification_user_id" ON "notification" ("user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_notification_user_date" ON "notification" ("user_id", "date" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_notification_property_id" ON "notification" ("property_id")
    `);

    // Property histories table indexes
    await queryRunner.query(`
      CREATE INDEX "IDX_property_histories_property_id" ON "property_histories" ("property_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_property_histories_tenant_id" ON "property_histories" ("tenant_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_property_histories_created_at" ON "property_histories" ("created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_property_histories_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_property_histories_tenant_id"`);
    await queryRunner.query(`DROP INDEX "IDX_property_histories_property_id"`);
    await queryRunner.query(`DROP INDEX "IDX_notification_property_id"`);
    await queryRunner.query(`DROP INDEX "IDX_notification_user_date"`);
    await queryRunner.query(`DROP INDEX "IDX_notification_user_id"`);
  }
}

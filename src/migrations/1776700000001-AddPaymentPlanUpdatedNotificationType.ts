import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentPlanUpdatedNotificationType1776700000001
  implements MigrationInterface
{
  name = 'AddPaymentPlanUpdatedNotificationType1776700000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS 'Payment Plan Updated'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres does not support removing enum values cleanly.
  }
}

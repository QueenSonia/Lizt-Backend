import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenancyAmendedNotificationType1788000000000
  implements MigrationInterface
{
  name = 'AddTenancyAmendedNotificationType1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS 'Tenancy Amended'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres does not support removing values from an enum type without
    // recreating it. Leave the added value in place on rollback.
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRenewalLetterNotificationTypes1777100000000
  implements MigrationInterface
{
  name = 'AddRenewalLetterNotificationTypes1777100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const values = [
      'Renewal Letter Sent',
      'Renewal Letter Accepted',
      'Renewal Letter Declined',
    ];

    for (const value of values) {
      await queryRunner.query(
        `ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  }

  public async down(): Promise<void> {
    // Postgres does not support removing values from an enum type without
    // recreating it. Leave the added values in place on rollback.
  }
}

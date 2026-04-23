import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentPlanAndMissingNotificationTypes1776500000000
  implements MigrationInterface
{
  name = 'AddPaymentPlanAndMissingNotificationTypes1776500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const values = [
      'Outstanding Balance Recorded',
      'User Added History',
      'Payment Transfer Rejected',
      'Rent Reminder Failed',
      'Payment Plan Created',
      'Payment Plan Cancelled',
      'Payment Plan Installment Paid',
      'Payment Plan Completed',
      'Payment Plan Request Submitted',
      'Payment Plan Request Approved',
      'Payment Plan Request Declined',
      'Ad-Hoc Invoice Created',
      'Ad-Hoc Invoice Paid',
      'Ad-Hoc Invoice Cancelled',
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

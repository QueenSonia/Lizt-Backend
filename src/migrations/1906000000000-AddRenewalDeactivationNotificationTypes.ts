import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `Renewal Deactivation Accepted` and `Renewal Deactivation Declined`
 * values to `notification_type_enum` so the landlord-facing in-app notification
 * raised when a tenant accepts/declines a "deactivate renewal" request can
 * persist. Without these, NotificationService.create() fails the enum check
 * inside RenewalDeactivationListener.handleConfirmed/handleDenied — which (until
 * the listener was made resilient) also blocked the landlord WhatsApp send.
 */
export class AddRenewalDeactivationNotificationTypes1906000000000
  implements MigrationInterface
{
  name = 'AddRenewalDeactivationNotificationTypes1906000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS 'Renewal Deactivation Accepted'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS 'Renewal Deactivation Declined'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres does not support removing values from an enum type without
    // recreating it. Leave the added values in place on rollback.
  }
}

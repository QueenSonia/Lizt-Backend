import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `Renewal Deactivation Accepted` / `Renewal Deactivation Declined`
 * values to the notifications enum.
 *
 * HISTORY: these backed the v1 "deactivate renewal" flow, where the tenant
 * confirmed the landlord's decision over WhatsApp. v2 removed that
 * tenant-confirmation layer entirely, so NO code references these enum values
 * anymore — they are inert labels.
 *
 * WHY THIS MIGRATION IS KEPT (not deleted): it was already applied on the dev
 * branch, and Postgres cannot drop an enum value without recreating the type.
 * Deleting the file would leave dev (value present + migration recorded) and
 * main (neither) permanently diverged. Keeping it — `ADD VALUE IF NOT EXISTS`
 * is idempotent — lets `migration:run` on main reproduce dev's exact state, so
 * both environments stay consistent. The two unused labels are harmless.
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

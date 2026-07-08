import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the 'Landlord Added' notification-enum value.
 *
 * NotificationService.create is called with this type (via the 'landlord.added'
 * event → LandlordAddedListener) when an admin adds a landlord — either from the
 * standalone Add Landlord modal or inline while creating a property; both funnel
 * through UsersService.createManagedLandlord. The row is attributed to the new
 * landlord's account so it surfaces on the managing admin's scoped live feed.
 * Without this value the in-app insert fails the enum check.
 */
export class AddLandlordAddedNotificationType1924000000000
  implements MigrationInterface
{
  name = 'AddLandlordAddedNotificationType1924000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS 'Landlord Added'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres does not support removing values from an enum type without
    // recreating it. Leave the added value in place on rollback.
  }
}

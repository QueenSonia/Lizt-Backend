import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the 'Tenant Handoff' notification-enum value.
 *
 * The tenant AI (TenantAiService) calls NotificationService.create with this
 * type when a tenant is handed off to a human on WhatsApp, so the handoff shows
 * on the owning landlord's live feed (mirrors 'Applicant Handoff'). Without this
 * value the in-app insert fails the enum check and is swallowed by the handoff's
 * try/catch.
 */
export class AddTenantHandoffNotificationType1911000000000
  implements MigrationInterface
{
  name = 'AddTenantHandoffNotificationType1911000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS 'Tenant Handoff'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres does not support removing values from an enum type without
    // recreating it. Leave the added value in place on rollback.
  }
}

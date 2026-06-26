import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the 'Applicant Handoff' notification-enum value.
 *
 * The applicant AI (ApplicantAiService) calls NotificationService.create with
 * this type when an applicant is handed off to a human, so the handoff shows on
 * the owning landlord's live feed. Without this value the in-app insert fails
 * the enum check and is swallowed by the handoff's try/catch.
 */
export class AddApplicantHandoffNotificationType1910000000000
  implements MigrationInterface
{
  name = 'AddApplicantHandoffNotificationType1910000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS 'Applicant Handoff'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres does not support removing values from an enum type without
    // recreating it. Leave the added value in place on rollback.
  }
}

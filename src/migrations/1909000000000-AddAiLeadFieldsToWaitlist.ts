import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds AI-lead capture fields to the waitlist table:
 *  - reason       : why the person messaged (free text, AI-collected)
 *  - source       : 'ai' | 'buttons' — which path captured the lead
 *  - needs_human  : flag for cap-exceeded / "I want a human" hand-offs
 */
export class AddAiLeadFieldsToWaitlist1909000000000
  implements MigrationInterface
{
  name = 'AddAiLeadFieldsToWaitlist1909000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "waitlist" ADD COLUMN IF NOT EXISTS "reason" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "waitlist" ADD COLUMN IF NOT EXISTS "source" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "waitlist" ADD COLUMN IF NOT EXISTS "needs_human" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "waitlist" DROP COLUMN IF EXISTS "needs_human"`,
    );
    await queryRunner.query(
      `ALTER TABLE "waitlist" DROP COLUMN IF EXISTS "source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "waitlist" DROP COLUMN IF EXISTS "reason"`,
    );
  }
}

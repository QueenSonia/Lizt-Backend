import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a lifecycle `status` to `scheduled_move_outs` so the landlord's
 * "deactivate renewal" action can park a row as `pending_tenant_confirmation`
 * until the tenant accepts over WhatsApp. Only `confirmed` rows are acted on by
 * the daily auto-end processor and counted by the renewal/reminder cron gate.
 *
 * Existing rows (and the legacy "schedule a future move-out" path) default to
 * `confirmed`, preserving today's behaviour.
 */
export class AddStatusToScheduledMoveOuts1904000000000
  implements MigrationInterface
{
  name = 'AddStatusToScheduledMoveOuts1904000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scheduled_move_outs"
        ADD COLUMN IF NOT EXISTS "status" varchar(32) NOT NULL DEFAULT 'confirmed';`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scheduled_move_outs" DROP COLUMN IF EXISTS "status";`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a lifecycle `status` to `scheduled_move_outs`. Rows are `confirmed`
 * (acted on by the daily auto-end processor and counted by the renewal/reminder
 * cron gate) or `cancelled` (a reactivated / cancelled scheduled end). The
 * landlord's "deactivate renewal" and "end on a date" actions both write
 * `confirmed` rows directly — there is no tenant-confirmation step.
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

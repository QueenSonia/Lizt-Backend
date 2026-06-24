import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add a `media jsonb` column to `chat_messages` so a maintenance-thread message
 * can carry one or more attachments — an array of `{ type: 'image' | 'video';
 * url }` objects. Mirrors the `issue_media` shape used by the initial report,
 * minus `attempt` (a report-cycle concept that doesn't apply to chat).
 *
 * Nullable, no default: text-only messages leave it null. `content` stays
 * `text NOT NULL` — media-only messages store an empty string there.
 */
export class AddMediaToChatMessages1908000000000 implements MigrationInterface {
  name = 'AddMediaToChatMessages1908000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "chat_messages"
        ADD COLUMN IF NOT EXISTS "media" JSONB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "chat_messages"
        DROP COLUMN IF EXISTS "media"
    `);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the AI tenant-bot data layer introduced in 9de9a46
 * ("Lizt ai bot for tenants"). The intent-router module and its OpenAI
 * client have been ripped out of the code; this drops the two tables it
 * created (tenant_notices, ai_intent_log) so the schema matches.
 *
 * Uses CASCADE + IF EXISTS so it is safe whether or not the original
 * Create migrations (1900000000000/1900000000001) ever ran on a given DB.
 * down() is intentionally a no-op — we are not bringing this approach back.
 */
export class DropAiBotTables1909000000000 implements MigrationInterface {
  name = 'DropAiBotTables1909000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "ai_intent_log" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "tenant_notices" CASCADE');
  }

  public async down(): Promise<void> {
    // No-op: the AI bot tables are deliberately not recreated.
  }
}

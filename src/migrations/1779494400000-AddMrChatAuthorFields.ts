import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMrChatAuthorFields1779494400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."chat_messages_sender_enum" ADD VALUE IF NOT EXISTS 'landlord'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."chat_messages_sender_enum" ADD VALUE IF NOT EXISTS 'facility_manager'`,
    );

    await queryRunner.query(
      `ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "sender_account_id" uuid NULL`,
    );

    // Backfill: any existing chat_messages rows pre-date this column, so they
    // stay NULL. The frontend treats NULL sender_account_id as "legacy" and
    // falls back to the senderName / sender enum for display.

    await queryRunner.query(
      `ALTER TABLE "chat_messages" ADD CONSTRAINT "fk_chat_messages_sender_account"
       FOREIGN KEY ("sender_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_chat_messages_mr_created"
       ON "chat_messages" ("maintenance_request_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_chat_messages_mr_created"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_messages" DROP CONSTRAINT IF EXISTS "fk_chat_messages_sender_account"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_messages" DROP COLUMN IF EXISTS "sender_account_id"`,
    );
    // Postgres can't drop enum values without recreating the type; leaving
    // 'landlord' / 'facility_manager' on the enum is harmless if the column
    // and code paths are gone.
  }
}

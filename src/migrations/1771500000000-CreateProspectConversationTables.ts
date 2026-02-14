import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProspectConversationTables1771500000000
    implements MigrationInterface {
    name = 'CreateProspectConversationTables1771500000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create prospect_conversation_status enum
        await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "prospect_conversation_status_enum" AS ENUM ('ai_handled', 'agent_handled', 'closed');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

        // Create prospect_channel enum
        await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "prospect_channel_enum" AS ENUM ('whatsapp', 'web');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

        // Create prospect_message_direction enum
        await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "prospect_message_direction_enum" AS ENUM ('inbound', 'outbound');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

        // Create prospect_message_sender_type enum
        await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "prospect_message_sender_type_enum" AS ENUM ('prospect', 'ai', 'agent');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

        // Create prospect_conversations table
        await queryRunner.query(`
      CREATE TABLE "prospect_conversations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "phone_number" varchar,
        "prospect_name" varchar,
        "channel" "prospect_channel_enum" NOT NULL DEFAULT 'whatsapp',
        "status" "prospect_conversation_status_enum" NOT NULL DEFAULT 'ai_handled',
        "summary" text,
        "intent" varchar,
        "preferences" jsonb,
        "interested_property_ids" uuid[],
        "schedule" jsonb,
        "assigned_agent_id" uuid,
        "last_message_at" TIMESTAMP,
        "web_session_id" varchar,
        CONSTRAINT "PK_prospect_conversations" PRIMARY KEY ("id")
      )
    `);

        // Create prospect_messages table
        await queryRunner.query(`
      CREATE TABLE "prospect_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "conversation_id" uuid NOT NULL,
        "direction" "prospect_message_direction_enum" NOT NULL,
        "sender_type" "prospect_message_sender_type_enum" NOT NULL,
        "content" text NOT NULL,
        "metadata" jsonb,
        CONSTRAINT "PK_prospect_messages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_prospect_messages_conversation"
          FOREIGN KEY ("conversation_id")
          REFERENCES "prospect_conversations"("id")
          ON DELETE CASCADE
      )
    `);

        // Create indexes
        await queryRunner.query(
            `CREATE INDEX "IDX_prospect_conv_phone" ON "prospect_conversations" ("phone_number")`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_prospect_conv_status" ON "prospect_conversations" ("status")`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_prospect_conv_channel" ON "prospect_conversations" ("channel")`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_prospect_conv_web_session" ON "prospect_conversations" ("web_session_id")`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_prospect_msg_conv" ON "prospect_messages" ("conversation_id")`,
        );

        // Add prospect_agent to RolesEnum if not already there
        await queryRunner.query(`
      ALTER TYPE "public"."accounts_role_enum" ADD VALUE IF NOT EXISTS 'prospect_agent';
    `);
        await queryRunner.query(`
      ALTER TYPE "public"."users_role_enum" ADD VALUE IF NOT EXISTS 'prospect_agent';
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_prospect_msg_conv"`);
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_prospect_conv_web_session"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_prospect_conv_channel"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_prospect_conv_status"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_prospect_conv_phone"`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS "prospect_messages"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "prospect_conversations"`);
        await queryRunner.query(
            `DROP TYPE IF EXISTS "prospect_message_sender_type_enum"`,
        );
        await queryRunner.query(
            `DROP TYPE IF EXISTS "prospect_message_direction_enum"`,
        );
        await queryRunner.query(`DROP TYPE IF EXISTS "prospect_channel_enum"`);
        await queryRunner.query(
            `DROP TYPE IF EXISTS "prospect_conversation_status_enum"`,
        );
    }
}

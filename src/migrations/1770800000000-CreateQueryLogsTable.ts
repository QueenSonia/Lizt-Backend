import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateQueryLogsTable1770800000000 implements MigrationInterface {
  name = 'CreateQueryLogsTable1770800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum type
    await queryRunner.query(`
      CREATE TYPE "query_type_enum" AS ENUM ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'OTHER')
    `);

    await queryRunner.query(`
      CREATE TABLE "query_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "query_type" "query_type_enum" NOT NULL,
        "query" text NOT NULL,
        "table_name" varchar,
        "duration_ms" int NOT NULL,
        "parameters" text,
        "is_slow" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_query_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_query_logs_type_created" ON "query_logs" ("query_type", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_query_logs_duration_created" ON "query_logs" ("duration_ms", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_query_logs_table_created" ON "query_logs" ("table_name", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_query_logs_table_created"`);
    await queryRunner.query(`DROP INDEX "IDX_query_logs_duration_created"`);
    await queryRunner.query(`DROP INDEX "IDX_query_logs_type_created"`);
    await queryRunner.query(`DROP TABLE "query_logs"`);
    await queryRunner.query(`DROP TYPE "query_type_enum"`);
  }
}

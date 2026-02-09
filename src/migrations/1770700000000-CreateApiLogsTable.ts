import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateApiLogsTable1770700000000 implements MigrationInterface {
  name = 'CreateApiLogsTable1770700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "api_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "method" varchar NOT NULL,
        "endpoint" varchar NOT NULL,
        "status_code" int NOT NULL,
        "duration_ms" int NOT NULL,
        "ip" varchar,
        "user_agent" varchar,
        "user_id" varchar,
        "error_message" varchar,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_api_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_api_logs_endpoint_created_at" ON "api_logs" ("endpoint", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_api_logs_duration_created_at" ON "api_logs" ("duration_ms", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_api_logs_duration_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_api_logs_endpoint_created_at"`);
    await queryRunner.query(`DROP TABLE "api_logs"`);
  }
}

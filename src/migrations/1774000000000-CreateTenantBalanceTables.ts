import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Create tenant_balances and tenant_balance_ledger tables.
 *
 * Outstanding balance and credit balance are now tracked at the
 * (tenant, landlord) level rather than per-rent-record, so they
 * follow the tenant across all properties within a landlord's account.
 *
 * The ledger table records every change and powers the balance
 * breakdown modal on the frontend.
 */
export class CreateTenantBalanceTables1774000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tenant_balances" (
        "id"                   UUID        NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id"            UUID        NOT NULL,
        "landlord_id"          UUID        NOT NULL,
        "outstanding_balance"  DECIMAL(12,2) NOT NULL DEFAULT 0,
        "credit_balance"       DECIMAL(12,2) NOT NULL DEFAULT 0,
        "notes"                TEXT,
        "created_at"           TIMESTAMP   NOT NULL DEFAULT now(),
        "updated_at"           TIMESTAMP   NOT NULL DEFAULT now(),
        "deleted_at"           TIMESTAMP,
        CONSTRAINT "pk_tenant_balances" PRIMARY KEY ("id"),
        CONSTRAINT "uq_tenant_balances_tenant_landlord" UNIQUE ("tenant_id", "landlord_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "tenant_balance_ledger" (
        "id"                          UUID         NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id"                   UUID         NOT NULL,
        "landlord_id"                 UUID         NOT NULL,
        "property_id"                 UUID,
        "type"                        VARCHAR(50)  NOT NULL,
        "description"                 TEXT         NOT NULL,
        "outstanding_balance_change"  DECIMAL(12,2) NOT NULL DEFAULT 0,
        "credit_balance_change"       DECIMAL(12,2) NOT NULL DEFAULT 0,
        "outstanding_balance_after"   DECIMAL(12,2) NOT NULL,
        "credit_balance_after"        DECIMAL(12,2) NOT NULL,
        "related_entity_type"         VARCHAR(50),
        "related_entity_id"           UUID,
        "created_at"                  TIMESTAMP    NOT NULL DEFAULT now(),
        "updated_at"                  TIMESTAMP    NOT NULL DEFAULT now(),
        "deleted_at"                  TIMESTAMP,
        CONSTRAINT "pk_tenant_balance_ledger" PRIMARY KEY ("id")
      )
    `);

    // Indexes for common queries
    await queryRunner.query(`
      CREATE INDEX "idx_tenant_balances_tenant_landlord"
        ON "tenant_balances" ("tenant_id", "landlord_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_tenant_balance_ledger_tenant_landlord"
        ON "tenant_balance_ledger" ("tenant_id", "landlord_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_tenant_balance_ledger_created_at"
        ON "tenant_balance_ledger" ("created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_balance_ledger"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_balances"`);
  }
}

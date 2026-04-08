import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Unify the dual outstanding_balance / credit_balance columns into a single
 * signed `balance` on tenant_balances and a single `balance_change` /
 * `balance_after` on tenant_balance_ledger.
 *
 * Sign convention (positive = credit, negative = outstanding):
 *   balance = credit_balance - outstanding_balance
 *   balance_change = credit_balance_change - outstanding_balance_change
 *   balance_after  = credit_balance_after  - outstanding_balance_after
 *
 * Also adds wallet_balance to renewal_invoices so the invoice can display
 * the wallet offset that was applied when the invoice was created.
 */
export class UnifyTenantBalance1774500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── tenant_balances ────────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "tenant_balances"
        ADD COLUMN "balance" DECIMAL(12,2) NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      UPDATE "tenant_balances"
        SET "balance" = COALESCE("credit_balance", 0) - COALESCE("outstanding_balance", 0)
    `);
    await queryRunner.query(`ALTER TABLE "tenant_balances" DROP COLUMN "outstanding_balance"`);
    await queryRunner.query(`ALTER TABLE "tenant_balances" DROP COLUMN "credit_balance"`);

    // ── tenant_balance_ledger ──────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "tenant_balance_ledger"
        ADD COLUMN "balance_change" DECIMAL(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN "balance_after"  DECIMAL(12,2) NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      UPDATE "tenant_balance_ledger"
        SET "balance_change" = COALESCE("credit_balance_change", 0) - COALESCE("outstanding_balance_change", 0),
            "balance_after"  = COALESCE("credit_balance_after",  0) - COALESCE("outstanding_balance_after",  0)
    `);
    await queryRunner.query(`ALTER TABLE "tenant_balance_ledger" DROP COLUMN "outstanding_balance_change"`);
    await queryRunner.query(`ALTER TABLE "tenant_balance_ledger" DROP COLUMN "credit_balance_change"`);
    await queryRunner.query(`ALTER TABLE "tenant_balance_ledger" DROP COLUMN "outstanding_balance_after"`);
    await queryRunner.query(`ALTER TABLE "tenant_balance_ledger" DROP COLUMN "credit_balance_after"`);

    // ── renewal_invoices ───────────────────────────────────────────────────────
    // wallet_balance: signed snapshot of the tenant's wallet at invoice creation
    // (positive = credit was available, negative = prior outstanding was owed)
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
        ADD COLUMN "wallet_balance" DECIMAL(10,2) NOT NULL DEFAULT 0
    `);
    // Existing rows: old outstanding_balance was a positive debt amount,
    // so wallet_balance = -outstanding_balance.
    await queryRunner.query(`
      UPDATE "renewal_invoices"
        SET "wallet_balance" = -COALESCE("outstanding_balance", 0)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── renewal_invoices ───────────────────────────────────────────────────────
    await queryRunner.query(`ALTER TABLE "renewal_invoices" DROP COLUMN "wallet_balance"`);

    // ── tenant_balance_ledger ──────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "tenant_balance_ledger"
        ADD COLUMN "outstanding_balance_change" DECIMAL(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN "credit_balance_change"      DECIMAL(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN "outstanding_balance_after"  DECIMAL(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN "credit_balance_after"       DECIMAL(12,2) NOT NULL DEFAULT 0
    `);
    // Approximate reverse — exact split is unrecoverable without original data.
    await queryRunner.query(`
      UPDATE "tenant_balance_ledger"
        SET "outstanding_balance_change" = CASE WHEN "balance_change" < 0 THEN -"balance_change" ELSE 0 END,
            "credit_balance_change"      = CASE WHEN "balance_change" > 0 THEN  "balance_change" ELSE 0 END,
            "outstanding_balance_after"  = CASE WHEN "balance_after"  < 0 THEN -"balance_after"  ELSE 0 END,
            "credit_balance_after"       = CASE WHEN "balance_after"  > 0 THEN  "balance_after"  ELSE 0 END
    `);
    await queryRunner.query(`ALTER TABLE "tenant_balance_ledger" DROP COLUMN "balance_change"`);
    await queryRunner.query(`ALTER TABLE "tenant_balance_ledger" DROP COLUMN "balance_after"`);

    // ── tenant_balances ────────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "tenant_balances"
        ADD COLUMN "outstanding_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN "credit_balance"      DECIMAL(12,2) NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      UPDATE "tenant_balances"
        SET "outstanding_balance" = CASE WHEN "balance" < 0 THEN -"balance" ELSE 0 END,
            "credit_balance"      = CASE WHEN "balance" > 0 THEN  "balance" ELSE 0 END
    `);
    await queryRunner.query(`ALTER TABLE "tenant_balances" DROP COLUMN "balance"`);
  }
}

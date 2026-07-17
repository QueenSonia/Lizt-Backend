import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames the Paystack-branded payment columns to gateway-neutral names ahead
 * of the Monnify cutover, and adds a `gateway` discriminator so historical
 * Paystack rows and future Monnify rows verify against the right provider.
 *
 *   payments.paystack_reference          → gateway_reference
 *   payments.paystack_access_code        → gateway_transaction_id
 *   payments.paystack_authorization_url  → gateway_checkout_url
 *   payments.gateway                     (new, NOT NULL, backfilled 'paystack')
 *   payment_plan_installments.paystack_reference → gateway_reference
 *   payment_plan_installments.gateway    (new, nullable, backfilled where ref set)
 *   ad_hoc_invoices.payment_gateway      (new, nullable, backfilled where ref set)
 *
 * Index/constraint names are normalized to explicit gateway-neutral names so
 * the dev-boot `dataSource.synchronize()` sees a no-op diff. Auto-hash names
 * change when a column renames, and environments disagree on which name the
 * old index carries (1769755778123 dropped "IDX_payments_paystack_reference"
 * and recreated it as the auto-hash "IDX_7b0616ce61771ddb8eb884f505"; dev
 * synchronize may have minted others) — so we rename whatever single-column
 * index/constraint actually exists rather than assuming a name.
 *
 * IMPORTANT (dev): run this migration BEFORE booting the renamed entities —
 * synchronize() diffs a rename as DROP+ADD and can silently destroy the
 * column data on the shared dev database.
 *
 * `payments.gateway` deliberately loses its DEFAULT right after the backfill:
 * a future insert path that forgets to stamp the gateway must fail loudly,
 * not silently claim 'paystack'.
 *
 * down() refuses once non-Paystack rows exist: rolling back after the Monnify
 * flip would strip the gateway discriminator from live money data.
 */
export class RenamePaystackColumnsToGatewayNeutral1930000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- payments ---------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "payments" RENAME COLUMN "paystack_reference" TO "gateway_reference"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" RENAME COLUMN "paystack_access_code" TO "gateway_transaction_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" RENAME COLUMN "paystack_authorization_url" TO "gateway_checkout_url"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN "gateway" varchar(20) NOT NULL DEFAULT 'paystack'`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "gateway" DROP DEFAULT`,
    );
    await this.normalizeUniqueConstraint(
      queryRunner,
      'payments',
      'gateway_reference',
      'UQ_payments_gateway_reference',
    );
    await this.normalizeSingleColumnIndexes(
      queryRunner,
      'payments',
      'gateway_reference',
      'IDX_payments_gateway_reference',
    );

    // ---- payment_plan_installments ----------------------------------------
    await queryRunner.query(
      `ALTER TABLE "payment_plan_installments" RENAME COLUMN "paystack_reference" TO "gateway_reference"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_plan_installments" ADD COLUMN "gateway" varchar(20)`,
    );
    await queryRunner.query(
      `UPDATE "payment_plan_installments" SET "gateway" = 'paystack' WHERE "gateway_reference" IS NOT NULL`,
    );
    await this.normalizeSingleColumnIndexes(
      queryRunner,
      'payment_plan_installments',
      'gateway_reference',
      'IDX_installments_gateway_reference',
    );

    // ---- ad_hoc_invoices (column names already neutral; add discriminator) -
    await queryRunner.query(
      `ALTER TABLE "ad_hoc_invoices" ADD COLUMN "payment_gateway" varchar(20)`,
    );
    await queryRunner.query(
      `UPDATE "ad_hoc_invoices" SET "payment_gateway" = 'paystack' WHERE "payment_reference" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Refuse once mixed-gateway data exists — see class docblock.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM payments WHERE gateway <> 'paystack')
          OR EXISTS (SELECT 1 FROM payment_plan_installments WHERE gateway IS NOT NULL AND gateway <> 'paystack')
          OR EXISTS (SELECT 1 FROM ad_hoc_invoices WHERE payment_gateway IS NOT NULL AND payment_gateway <> 'paystack')
        THEN
          RAISE EXCEPTION 'Refusing to roll back 1930: non-paystack gateway rows exist';
        END IF;
      END $$;
    `);

    await queryRunner.query(
      `ALTER TABLE "ad_hoc_invoices" DROP COLUMN "payment_gateway"`,
    );

    await queryRunner.query(
      `ALTER TABLE "payment_plan_installments" DROP COLUMN "gateway"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_plan_installments" RENAME COLUMN "gateway_reference" TO "paystack_reference"`,
    );
    await this.normalizeSingleColumnIndexes(
      queryRunner,
      'payment_plan_installments',
      'paystack_reference',
      'idx_installments_paystack_reference',
    );

    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "gateway"`);
    await queryRunner.query(
      `ALTER TABLE "payments" RENAME COLUMN "gateway_reference" TO "paystack_reference"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" RENAME COLUMN "gateway_transaction_id" TO "paystack_access_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" RENAME COLUMN "gateway_checkout_url" TO "paystack_authorization_url"`,
    );
    await this.normalizeSingleColumnIndexes(
      queryRunner,
      'payments',
      'paystack_reference',
      'IDX_7b0616ce61771ddb8eb884f505',
    );
    // The unique constraint keeps its gateway-neutral name on rollback —
    // constraint names are behavior-free and the pre-1930 name was an
    // environment-dependent auto-hash anyway.
  }

  /**
   * Ensure exactly one plain (non-constraint) single-column index named
   * `targetName` exists on table(column): rename the first existing one,
   * drop duplicates, create if none. Identifiers are compile-time constants
   * from this file — never user input.
   */
  private async normalizeSingleColumnIndexes(
    queryRunner: QueryRunner,
    table: string,
    column: string,
    targetName: string,
  ): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        idx record;
        settled boolean := false;
      BEGIN
        FOR idx IN
          SELECT i.relname AS index_name
            FROM pg_index x
            JOIN pg_class i ON i.oid = x.indexrelid
            JOIN pg_class t ON t.oid = x.indrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
           WHERE n.nspname = 'public'
             AND t.relname = '${table}'
             AND x.indnatts = 1
             AND NOT x.indisprimary
             AND NOT EXISTS (
               SELECT 1 FROM pg_constraint c WHERE c.conindid = x.indexrelid
             )
             AND (
               SELECT a.attname FROM pg_attribute a
                WHERE a.attrelid = t.oid AND a.attnum = x.indkey[0]
             ) = '${column}'
           ORDER BY (i.relname = '${targetName}') DESC, i.relname
        LOOP
          IF NOT settled THEN
            IF idx.index_name <> '${targetName}' THEN
              EXECUTE format('ALTER INDEX public.%I RENAME TO %I',
                             idx.index_name, '${targetName}');
            END IF;
            settled := true;
          ELSE
            EXECUTE format('DROP INDEX public.%I', idx.index_name);
          END IF;
        END LOOP;
        IF NOT settled THEN
          EXECUTE format('CREATE INDEX %I ON public.${table} ("${column}")',
                         '${targetName}');
        END IF;
      END $$;
    `);
  }

  /**
   * Ensure the single-column UNIQUE constraint on table(column) is named
   * `targetName`: rename the first existing one, drop duplicates, create if
   * none.
   */
  private async normalizeUniqueConstraint(
    queryRunner: QueryRunner,
    table: string,
    column: string,
    targetName: string,
  ): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        con record;
        settled boolean := false;
      BEGIN
        FOR con IN
          SELECT c.conname
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
           WHERE n.nspname = 'public'
             AND t.relname = '${table}'
             AND c.contype = 'u'
             AND array_length(c.conkey, 1) = 1
             AND (
               SELECT a.attname FROM pg_attribute a
                WHERE a.attrelid = t.oid AND a.attnum = c.conkey[1]
             ) = '${column}'
           ORDER BY (c.conname = '${targetName}') DESC, c.conname
        LOOP
          IF NOT settled THEN
            IF con.conname <> '${targetName}' THEN
              EXECUTE format('ALTER TABLE public.${table} RENAME CONSTRAINT %I TO %I',
                             con.conname, '${targetName}');
            END IF;
            settled := true;
          ELSE
            EXECUTE format('ALTER TABLE public.${table} DROP CONSTRAINT %I',
                           con.conname);
          END IF;
        END LOOP;
        IF NOT settled THEN
          EXECUTE format('ALTER TABLE public.${table} ADD CONSTRAINT %I UNIQUE ("${column}")',
                         '${targetName}');
        END IF;
      END $$;
    `);
  }
}

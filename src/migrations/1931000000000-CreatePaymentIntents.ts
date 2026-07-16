import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `payment_intents` — a durable record of every checkout we hand a
 * tenant, written BEFORE the gateway is called.
 *
 * WHY: only the offer-letter lane persists anything at init (a `payments` row,
 * swept by `checkExpiredPayments`). The renewal, ad-hoc and payment-plan lanes
 * call `gateway.initializePayment()` and persist NOTHING, so the only things
 * that can ever credit them are the tenant's browser returning (a ~15s poll)
 * and the gateway webhook. When both fail — closed tab, slow bank transfer,
 * misconfigured webhook — the gateway holds the money, our DB says UNPAID, and
 * nothing reconciles it, forever. This table is the missing third chance:
 * `PaymentReconciliationService` re-verifies unresolved rows and replays them
 * through the same processors the webhook calls.
 *
 * Deliberately a NEW table rather than an extension of `payments`:
 *   - `payments.offer_letter_id` is NOT NULL with a CASCADE FK, so the other
 *     lanes cannot reuse it without weakening the working lane's integrity;
 *   - supporting every lane there would mean a nullable FK column per lane;
 *   - two sweeps over one table would race. Separate tables cannot interact.
 *
 * `related_entity_id` is deliberately polymorphic (renewal invoice / ad-hoc
 * invoice / installment / plan) and therefore carries NO foreign key — the
 * lane is in `lane`, and routing metadata is in `metadata`. This mirrors the
 * webhook router, which is already polymorphic via reference prefix + metadata.
 *
 * `gateway` has NO default, matching the deliberate choice in 1930: an insert
 * path that forgets to stamp the issuing adapter must fail loudly rather than
 * silently claim the wrong provider and verify against it later.
 *
 * Index names are explicit so the dev-boot `dataSource.synchronize()` sees a
 * no-op diff (auto-hash names differ from anything we write here). For the same
 * reason `id` defaults to `uuid_generate_v4()` and NOT `gen_random_uuid()`:
 * that is what TypeORM emits for `@PrimaryGeneratedColumn('uuid')` on Postgres,
 * and it is what the sibling `payments` table (1769200000000) already uses.
 */
export class CreatePaymentIntents1931000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "payment_intents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "reference" character varying(255) NOT NULL,
        "gateway" character varying(20) NOT NULL,
        "lane" character varying(32) NOT NULL,
        "amount_naira" numeric(12,2) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "related_entity_id" uuid,
        "checkout_url" text,
        "gateway_transaction_id" character varying(255),
        "metadata" jsonb,
        "verify_attempts" integer NOT NULL DEFAULT 0,
        "last_verified_at" TIMESTAMP,
        "resolved_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_intents" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_payment_intents_reference" UNIQUE ("reference")
      )
    `);

    // The sweep's only hot query: pending rows, oldest first.
    await queryRunner.query(
      `CREATE INDEX "IDX_payment_intents_status_created_at" ON "payment_intents" ("status", "created_at")`,
    );
    // Ops: "show me every checkout for this invoice".
    await queryRunner.query(
      `CREATE INDEX "IDX_payment_intents_related_entity_id" ON "payment_intents" ("related_entity_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Safe to drop unconditionally: the table is a reconciliation ledger, not
    // a source of truth for money. Every credit it makes is written by the
    // lane's own processor into that lane's own tables (renewal_invoices,
    // ad_hoc_invoices, payment_plan_installments) — dropping this loses the
    // safety net, not the payments.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_payment_intents_related_entity_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_payment_intents_status_created_at"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_intents"`);
  }
}

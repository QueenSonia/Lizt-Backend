import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Payment plans — lets a landlord split a renewal invoice (or a single
 * charge from it) into scheduled installments. Each installment is paid
 * independently via Paystack or marked manually by the landlord.
 */
export class CreatePaymentPlans1775100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "payment_plans" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "property_tenant_id" uuid NOT NULL,
        "property_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "renewal_invoice_id" uuid,
        "scope" VARCHAR(20) NOT NULL DEFAULT 'charge',
        "charge_name" VARCHAR(255) NOT NULL,
        "charge_fee_kind" VARCHAR(20),
        "charge_external_id" VARCHAR(255),
        "total_amount" NUMERIC(12,2) NOT NULL,
        "plan_type" VARCHAR(10) NOT NULL DEFAULT 'equal',
        "status" VARCHAR(20) NOT NULL DEFAULT 'active',
        "created_by_user_id" uuid,
        CONSTRAINT "fk_payment_plans_property_tenant"
          FOREIGN KEY ("property_tenant_id")
          REFERENCES "property_tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_payment_plans_property"
          FOREIGN KEY ("property_id")
          REFERENCES "properties"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_payment_plans_tenant"
          FOREIGN KEY ("tenant_id")
          REFERENCES "accounts"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_payment_plans_renewal_invoice"
          FOREIGN KEY ("renewal_invoice_id")
          REFERENCES "renewal_invoices"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_payment_plans_property_tenant_id"
        ON "payment_plans"("property_tenant_id");
      CREATE INDEX "idx_payment_plans_property_id"
        ON "payment_plans"("property_id");
      CREATE INDEX "idx_payment_plans_tenant_id"
        ON "payment_plans"("tenant_id");
      CREATE INDEX "idx_payment_plans_renewal_invoice_id"
        ON "payment_plans"("renewal_invoice_id");
      CREATE INDEX "idx_payment_plans_status"
        ON "payment_plans"("status");
    `);

    await queryRunner.query(`
      CREATE TABLE "payment_plan_installments" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "plan_id" uuid NOT NULL,
        "sequence" INTEGER NOT NULL,
        "amount" NUMERIC(12,2) NOT NULL,
        "due_date" DATE NOT NULL,
        "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
        "paid_at" TIMESTAMP,
        "amount_paid" NUMERIC(12,2),
        "payment_method" VARCHAR(20),
        "paystack_reference" VARCHAR(255),
        "manual_payment_note" TEXT,
        "marked_paid_by_user_id" uuid,
        "receipt_token" VARCHAR(64),
        "receipt_number" VARCHAR(50),
        "last_reminder_sent_on" DATE,
        CONSTRAINT "fk_installments_plan"
          FOREIGN KEY ("plan_id")
          REFERENCES "payment_plans"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_installments_plan_id"
        ON "payment_plan_installments"("plan_id");
      CREATE INDEX "idx_installments_status"
        ON "payment_plan_installments"("status");
      CREATE INDEX "idx_installments_due_date"
        ON "payment_plan_installments"("due_date");
      CREATE INDEX "idx_installments_paystack_reference"
        ON "payment_plan_installments"("paystack_reference");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_plan_installments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_plans"`);
  }
}

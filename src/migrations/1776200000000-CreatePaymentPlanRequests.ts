import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tenant-initiated payment plan requests. Tenants submit these from the
 * WhatsApp flow; landlords review on the Payment Plans page and either
 * approve (which atomically creates a PaymentPlan and links it back via
 * created_payment_plan_id) or decline.
 */
export class CreatePaymentPlanRequests1776200000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "payment_plan_requests" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "property_tenant_id" uuid NOT NULL,
        "property_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "renewal_invoice_id" uuid,
        "total_amount" NUMERIC(12,2) NOT NULL,
        "fee_breakdown" JSONB NOT NULL DEFAULT '[]'::jsonb,
        "installment_amount" NUMERIC(12,2) NOT NULL,
        "preferred_schedule" TEXT NOT NULL,
        "tenant_note" TEXT,
        "source" VARCHAR(10) NOT NULL DEFAULT 'rent',
        "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
        "created_payment_plan_id" uuid,
        "decided_at" TIMESTAMP,
        "decided_by_user_id" uuid,
        "decline_reason" TEXT,
        CONSTRAINT "fk_pp_requests_property_tenant"
          FOREIGN KEY ("property_tenant_id")
          REFERENCES "property_tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_pp_requests_property"
          FOREIGN KEY ("property_id")
          REFERENCES "properties"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_pp_requests_tenant"
          FOREIGN KEY ("tenant_id")
          REFERENCES "accounts"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_pp_requests_renewal_invoice"
          FOREIGN KEY ("renewal_invoice_id")
          REFERENCES "renewal_invoices"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_pp_requests_payment_plan"
          FOREIGN KEY ("created_payment_plan_id")
          REFERENCES "payment_plans"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_pp_requests_property_tenant_id"
        ON "payment_plan_requests"("property_tenant_id");
      CREATE INDEX "idx_pp_requests_property_id"
        ON "payment_plan_requests"("property_id");
      CREATE INDEX "idx_pp_requests_tenant_id"
        ON "payment_plan_requests"("tenant_id");
      CREATE INDEX "idx_pp_requests_renewal_invoice_id"
        ON "payment_plan_requests"("renewal_invoice_id");
      CREATE INDEX "idx_pp_requests_status"
        ON "payment_plan_requests"("status");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_plan_requests"`);
  }
}

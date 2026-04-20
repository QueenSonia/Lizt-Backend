import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ad-hoc invoices — landlord-issued one-off invoices for mid-tenancy charges
 * (diesel fee, generator repair, etc). Separate from renewal invoices and
 * offer-letter invoices. Paid publicly via Paystack against a public token.
 */
export class CreateAdHocInvoices1775200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ad_hoc_invoices" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "invoice_number" VARCHAR(50) NOT NULL,
        "landlord_id" uuid NOT NULL,
        "property_id" uuid NOT NULL,
        "property_tenant_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "public_token" VARCHAR(64) NOT NULL,
        "total_amount" NUMERIC(12,2) NOT NULL,
        "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
        "due_date" DATE NOT NULL,
        "notes" TEXT,
        "paid_at" TIMESTAMP,
        "payment_reference" VARCHAR(100),
        "receipt_token" VARCHAR(64),
        "receipt_number" VARCHAR(50),
        "created_by_user_id" uuid,
        CONSTRAINT "fk_ad_hoc_invoices_landlord"
          FOREIGN KEY ("landlord_id")
          REFERENCES "accounts"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_ad_hoc_invoices_property"
          FOREIGN KEY ("property_id")
          REFERENCES "properties"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_ad_hoc_invoices_property_tenant"
          FOREIGN KEY ("property_tenant_id")
          REFERENCES "property_tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_ad_hoc_invoices_tenant"
          FOREIGN KEY ("tenant_id")
          REFERENCES "accounts"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_ad_hoc_invoices_invoice_number"
        ON "ad_hoc_invoices"("invoice_number");
      CREATE UNIQUE INDEX "idx_ad_hoc_invoices_public_token"
        ON "ad_hoc_invoices"("public_token");
      CREATE UNIQUE INDEX "idx_ad_hoc_invoices_receipt_token"
        ON "ad_hoc_invoices"("receipt_token")
        WHERE "receipt_token" IS NOT NULL;
      CREATE INDEX "idx_ad_hoc_invoices_property_tenant_id"
        ON "ad_hoc_invoices"("property_tenant_id");
      CREATE INDEX "idx_ad_hoc_invoices_property_id"
        ON "ad_hoc_invoices"("property_id");
      CREATE INDEX "idx_ad_hoc_invoices_tenant_id"
        ON "ad_hoc_invoices"("tenant_id");
      CREATE INDEX "idx_ad_hoc_invoices_landlord_id"
        ON "ad_hoc_invoices"("landlord_id");
      CREATE INDEX "idx_ad_hoc_invoices_status"
        ON "ad_hoc_invoices"("status");
    `);

    await queryRunner.query(`
      CREATE TABLE "ad_hoc_invoice_line_items" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "invoice_id" uuid NOT NULL,
        "description" VARCHAR(255) NOT NULL,
        "amount" NUMERIC(12,2) NOT NULL,
        "sequence" INTEGER NOT NULL,
        CONSTRAINT "fk_ad_hoc_invoice_line_items_invoice"
          FOREIGN KEY ("invoice_id")
          REFERENCES "ad_hoc_invoices"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_ad_hoc_invoice_line_items_invoice_id"
        ON "ad_hoc_invoice_line_items"("invoice_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ad_hoc_invoice_line_items"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ad_hoc_invoices"`);
  }
}

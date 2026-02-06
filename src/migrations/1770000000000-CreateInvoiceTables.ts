import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInvoiceTables1770000000000 implements MigrationInterface {
  name = 'CreateInvoiceTables1770000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create invoices table
    await queryRunner.query(`
      CREATE TABLE "invoices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "invoice_number" varchar(50) NOT NULL,
        "landlord_id" uuid NOT NULL,
        "tenant_id" uuid,
        "kyc_application_id" uuid,
        "property_id" uuid NOT NULL,
        "offer_letter_id" uuid,
        "invoice_date" date NOT NULL DEFAULT CURRENT_DATE,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "total_amount" decimal(15,2) NOT NULL,
        "amount_paid" decimal(15,2) NOT NULL DEFAULT 0,
        "outstanding_balance" decimal(15,2) NOT NULL DEFAULT 0,
        "notes" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_invoices_invoice_number" UNIQUE ("invoice_number"),
        CONSTRAINT "CHK_invoices_status" CHECK ("status" IN ('pending', 'partially_paid', 'paid', 'overdue', 'cancelled')),
        CONSTRAINT "PK_invoices" PRIMARY KEY ("id")
      )
    `);

    // Add foreign keys for invoices
    await queryRunner.query(`
      ALTER TABLE "invoices" 
      ADD CONSTRAINT "FK_invoices_landlord" 
      FOREIGN KEY ("landlord_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "invoices" 
      ADD CONSTRAINT "FK_invoices_tenant" 
      FOREIGN KEY ("tenant_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "invoices" 
      ADD CONSTRAINT "FK_invoices_kyc_application" 
      FOREIGN KEY ("kyc_application_id") REFERENCES "kyc_applications"("id") ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "invoices" 
      ADD CONSTRAINT "FK_invoices_property" 
      FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "invoices" 
      ADD CONSTRAINT "FK_invoices_offer_letter" 
      FOREIGN KEY ("offer_letter_id") REFERENCES "offer_letters"("id") ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // Create indexes for invoices
    await queryRunner.query(`
      CREATE INDEX "IDX_invoices_landlord" ON "invoices" ("landlord_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_invoices_status" ON "invoices" ("status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_invoices_property" ON "invoices" ("property_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_invoices_offer_letter" ON "invoices" ("offer_letter_id")
    `);

    // Create invoice_line_items table
    await queryRunner.query(`
      CREATE TABLE "invoice_line_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "invoice_id" uuid NOT NULL,
        "description" varchar(255) NOT NULL,
        "amount" decimal(15,2) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_invoice_line_items" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "invoice_line_items" 
      ADD CONSTRAINT "FK_invoice_line_items_invoice" 
      FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_invoice_line_items_invoice" ON "invoice_line_items" ("invoice_id")
    `);

    // Create invoice_payments table
    await queryRunner.query(`
      CREATE TABLE "invoice_payments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "invoice_id" uuid NOT NULL,
        "payment_id" uuid,
        "amount" decimal(15,2) NOT NULL,
        "payment_date" date NOT NULL DEFAULT CURRENT_DATE,
        "payment_method" varchar(50),
        "reference" varchar(100),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_invoice_payments" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "invoice_payments" 
      ADD CONSTRAINT "FK_invoice_payments_invoice" 
      FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "invoice_payments" 
      ADD CONSTRAINT "FK_invoice_payments_payment" 
      FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_invoice_payments_invoice" ON "invoice_payments" ("invoice_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop invoice_payments
    await queryRunner.query(`DROP INDEX "IDX_invoice_payments_invoice"`);
    await queryRunner.query(
      `ALTER TABLE "invoice_payments" DROP CONSTRAINT "FK_invoice_payments_payment"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_payments" DROP CONSTRAINT "FK_invoice_payments_invoice"`,
    );
    await queryRunner.query(`DROP TABLE "invoice_payments"`);

    // Drop invoice_line_items
    await queryRunner.query(`DROP INDEX "IDX_invoice_line_items_invoice"`);
    await queryRunner.query(
      `ALTER TABLE "invoice_line_items" DROP CONSTRAINT "FK_invoice_line_items_invoice"`,
    );
    await queryRunner.query(`DROP TABLE "invoice_line_items"`);

    // Drop invoices
    await queryRunner.query(`DROP INDEX "IDX_invoices_offer_letter"`);
    await queryRunner.query(`DROP INDEX "IDX_invoices_property"`);
    await queryRunner.query(`DROP INDEX "IDX_invoices_status"`);
    await queryRunner.query(`DROP INDEX "IDX_invoices_landlord"`);
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "FK_invoices_offer_letter"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "FK_invoices_property"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "FK_invoices_kyc_application"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "FK_invoices_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "FK_invoices_landlord"`,
    );
    await queryRunner.query(`DROP TABLE "invoices"`);
  }
}

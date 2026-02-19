import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReceiptsTable1771600000000 implements MigrationInterface {
  name = 'CreateReceiptsTable1771600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "receipts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "receipt_number" varchar(50) NOT NULL,
        "payment_id" uuid NOT NULL,
        "offer_letter_id" uuid NOT NULL,
        "property_id" uuid NOT NULL,
        "kyc_application_id" uuid NOT NULL,
        "token" varchar(64) NOT NULL,
        "pdf_url" text,
        "receipt_date" date NOT NULL,
        "amount_paid" decimal(12,2) NOT NULL,
        "payment_method" varchar(50),
        "payment_reference" varchar(255) NOT NULL,
        "tenant_name" varchar(255) NOT NULL,
        "tenant_email" varchar(255),
        "tenant_phone" varchar(50),
        "property_name" varchar(255) NOT NULL,
        "property_address" varchar(500),
        "invoice_number" varchar(50),
        "notes" text,
        "branding" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "UQ_receipts_receipt_number" UNIQUE ("receipt_number"),
        CONSTRAINT "UQ_receipts_token" UNIQUE ("token"),
        CONSTRAINT "PK_receipts" PRIMARY KEY ("id")
      )
    `);

    // Foreign keys
    await queryRunner.query(`
      ALTER TABLE "receipts"
      ADD CONSTRAINT "FK_receipts_payment"
      FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "receipts"
      ADD CONSTRAINT "FK_receipts_offer_letter"
      FOREIGN KEY ("offer_letter_id") REFERENCES "offer_letters"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "receipts"
      ADD CONSTRAINT "FK_receipts_property"
      FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "receipts"
      ADD CONSTRAINT "FK_receipts_kyc_application"
      FOREIGN KEY ("kyc_application_id") REFERENCES "kyc_applications"("id") ON DELETE CASCADE
    `);

    // Indexes
    await queryRunner.query(
      `CREATE INDEX "IDX_receipts_payment_id" ON "receipts" ("payment_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_receipts_offer_letter_id" ON "receipts" ("offer_letter_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_receipts_property_id" ON "receipts" ("property_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_receipts_kyc_application_id" ON "receipts" ("kyc_application_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_receipts_token" ON "receipts" ("token")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_receipts_token"`);
    await queryRunner.query(`DROP INDEX "IDX_receipts_kyc_application_id"`);
    await queryRunner.query(`DROP INDEX "IDX_receipts_property_id"`);
    await queryRunner.query(`DROP INDEX "IDX_receipts_offer_letter_id"`);
    await queryRunner.query(`DROP INDEX "IDX_receipts_payment_id"`);
    await queryRunner.query(
      `ALTER TABLE "receipts" DROP CONSTRAINT "FK_receipts_kyc_application"`,
    );
    await queryRunner.query(
      `ALTER TABLE "receipts" DROP CONSTRAINT "FK_receipts_property"`,
    );
    await queryRunner.query(
      `ALTER TABLE "receipts" DROP CONSTRAINT "FK_receipts_offer_letter"`,
    );
    await queryRunner.query(
      `ALTER TABLE "receipts" DROP CONSTRAINT "FK_receipts_payment"`,
    );
    await queryRunner.query(`DROP TABLE "receipts"`);
  }
}

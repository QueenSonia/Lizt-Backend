import { MigrationInterface, QueryRunner } from "typeorm";

export class AddContentSnapshotToOfferLetters1769755778123 implements MigrationInterface {
    name = 'AddContentSnapshotToOfferLetters1769755778123'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "offer_letters" DROP CONSTRAINT "FK_f6a9e951f8bceb7af23c0291249"`);
        await queryRunner.query(`ALTER TABLE "offer_letters" DROP CONSTRAINT "FK_9a1829231bac52caf857b2c9069"`);
        await queryRunner.query(`ALTER TABLE "offer_letters" DROP CONSTRAINT "FK_eeb529af9a334dbb59a276db0d1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_offer_letters_payment_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_offer_letters_property_payment"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_offer_letters_kyc_application_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_offer_letters_property_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_offer_letters_landlord_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_offer_letters_token"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_offer_letters_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_payments_offer_letter_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_payments_paystack_reference"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_payments_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_payments_created_at"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_payment_logs_payment_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_payment_logs_event_type"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_payment_logs_created_at"`);
        await queryRunner.query(`ALTER TABLE "offer_letters" ADD "content_snapshot" jsonb`);
        await queryRunner.query(`ALTER TABLE "offer_letters" ALTER COLUMN "created_at" SET DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "offer_letters" ALTER COLUMN "updated_at" SET DEFAULT now()`);
        await queryRunner.query(`COMMENT ON COLUMN "offer_letters"."branding" IS NULL`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "payment_type"`);
        await queryRunner.query(`DROP TYPE "public"."payments_payment_type_enum"`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "payment_type" character varying(20) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "status"`);
        await queryRunner.query(`DROP TYPE "public"."payments_status_enum"`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "status" character varying(20) NOT NULL DEFAULT 'pending'`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "payment_method"`);
        await queryRunner.query(`DROP TYPE "public"."payments_payment_method_enum"`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "payment_method" character varying(20)`);
        await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "created_at" SET DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "updated_at" SET DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "payment_logs" DROP CONSTRAINT "FK_6508afaa58d3f3e97c347631c0c"`);
        await queryRunner.query(`ALTER TABLE "payment_logs" ALTER COLUMN "payment_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "payment_logs" DROP COLUMN "event_type"`);
        await queryRunner.query(`DROP TYPE "public"."payment_logs_event_type_enum"`);
        await queryRunner.query(`ALTER TABLE "payment_logs" ADD "event_type" character varying(50) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "payment_logs" ALTER COLUMN "created_at" SET DEFAULT now()`);
        await queryRunner.query(`CREATE INDEX "IDX_1237daf748b7653a6ebb9492fe" ON "payments" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_32b41cdb985a296213e9a928b5" ON "payments" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_7b0616ce61771ddb8eb884f505" ON "payments" ("paystack_reference") `);
        await queryRunner.query(`CREATE INDEX "IDX_5834dd5fe118b046742a975aa7" ON "payments" ("offer_letter_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_cbd244eff013ca1bf54eb64c6d" ON "payment_logs" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_bed8eba341bfcc3802f23a8ef8" ON "payment_logs" ("event_type") `);
        await queryRunner.query(`CREATE INDEX "IDX_6508afaa58d3f3e97c347631c0" ON "payment_logs" ("payment_id") `);
        await queryRunner.query(`ALTER TABLE "offer_letters" ADD CONSTRAINT "FK_eeb529af9a334dbb59a276db0d1" FOREIGN KEY ("kyc_application_id") REFERENCES "kyc_applications"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "offer_letters" ADD CONSTRAINT "FK_9a1829231bac52caf857b2c9069" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "offer_letters" ADD CONSTRAINT "FK_f6a9e951f8bceb7af23c0291249" FOREIGN KEY ("landlord_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payment_logs" ADD CONSTRAINT "FK_6508afaa58d3f3e97c347631c0c" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payment_logs" DROP CONSTRAINT "FK_6508afaa58d3f3e97c347631c0c"`);
        await queryRunner.query(`ALTER TABLE "offer_letters" DROP CONSTRAINT "FK_f6a9e951f8bceb7af23c0291249"`);
        await queryRunner.query(`ALTER TABLE "offer_letters" DROP CONSTRAINT "FK_9a1829231bac52caf857b2c9069"`);
        await queryRunner.query(`ALTER TABLE "offer_letters" DROP CONSTRAINT "FK_eeb529af9a334dbb59a276db0d1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6508afaa58d3f3e97c347631c0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bed8eba341bfcc3802f23a8ef8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cbd244eff013ca1bf54eb64c6d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5834dd5fe118b046742a975aa7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7b0616ce61771ddb8eb884f505"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_32b41cdb985a296213e9a928b5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1237daf748b7653a6ebb9492fe"`);
        await queryRunner.query(`ALTER TABLE "payment_logs" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "payment_logs" DROP COLUMN "event_type"`);
        await queryRunner.query(`CREATE TYPE "public"."payment_logs_event_type_enum" AS ENUM('webhook', 'polling', 'initiation', 'verification', 'error')`);
        await queryRunner.query(`ALTER TABLE "payment_logs" ADD "event_type" "public"."payment_logs_event_type_enum" NOT NULL`);
        await queryRunner.query(`ALTER TABLE "payment_logs" ALTER COLUMN "payment_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "payment_logs" ADD CONSTRAINT "FK_6508afaa58d3f3e97c347631c0c" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "payment_method"`);
        await queryRunner.query(`CREATE TYPE "public"."payments_payment_method_enum" AS ENUM('card', 'bank_transfer')`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "payment_method" "public"."payments_payment_method_enum"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "status"`);
        await queryRunner.query(`CREATE TYPE "public"."payments_status_enum" AS ENUM('pending', 'completed', 'failed', 'refunded')`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "status" "public"."payments_status_enum" NOT NULL DEFAULT 'pending'`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "payment_type"`);
        await queryRunner.query(`CREATE TYPE "public"."payments_payment_type_enum" AS ENUM('partial', 'full')`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "payment_type" "public"."payments_payment_type_enum" NOT NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "offer_letters"."branding" IS 'Snapshot of landlord branding at time of offer letter creation'`);
        await queryRunner.query(`ALTER TABLE "offer_letters" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "offer_letters" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "offer_letters" DROP COLUMN "content_snapshot"`);
        await queryRunner.query(`CREATE INDEX "IDX_payment_logs_created_at" ON "payment_logs" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_payment_logs_event_type" ON "payment_logs" ("event_type") `);
        await queryRunner.query(`CREATE INDEX "IDX_payment_logs_payment_id" ON "payment_logs" ("payment_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_payments_created_at" ON "payments" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_payments_status" ON "payments" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_payments_paystack_reference" ON "payments" ("paystack_reference") `);
        await queryRunner.query(`CREATE INDEX "IDX_payments_offer_letter_id" ON "payments" ("offer_letter_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_offer_letters_status" ON "offer_letters" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_offer_letters_token" ON "offer_letters" ("token") `);
        await queryRunner.query(`CREATE INDEX "IDX_offer_letters_landlord_id" ON "offer_letters" ("landlord_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_offer_letters_property_id" ON "offer_letters" ("property_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_offer_letters_kyc_application_id" ON "offer_letters" ("kyc_application_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_offer_letters_property_payment" ON "offer_letters" ("payment_status", "property_id", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_offer_letters_payment_status" ON "offer_letters" ("payment_status") `);
        await queryRunner.query(`ALTER TABLE "offer_letters" ADD CONSTRAINT "FK_eeb529af9a334dbb59a276db0d1" FOREIGN KEY ("kyc_application_id") REFERENCES "kyc_applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "offer_letters" ADD CONSTRAINT "FK_9a1829231bac52caf857b2c9069" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "offer_letters" ADD CONSTRAINT "FK_f6a9e951f8bceb7af23c0291249" FOREIGN KEY ("landlord_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}

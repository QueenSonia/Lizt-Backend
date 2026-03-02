import { MigrationInterface, QueryRunner } from "typeorm";

export class MakeKycFieldsRequired1772200000000 implements MigrationInterface {
    name = 'MakeKycFieldsRequired1772200000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // --- kyc_applications: Backfill NULLs and add NOT NULL constraints ---

        // 1. Backfill string columns with '-'
        await queryRunner.query(`
            DO $$ BEGIN
                UPDATE "kyc_applications" SET "email" = '-' WHERE "email" IS NULL;
                UPDATE "kyc_applications" SET "contact_address" = '-' WHERE "contact_address" IS NULL;
                UPDATE "kyc_applications" SET "nationality" = '-' WHERE "nationality" IS NULL;
                UPDATE "kyc_applications" SET "state_of_origin" = '-' WHERE "state_of_origin" IS NULL;
                UPDATE "kyc_applications" SET "religion" = '-' WHERE "religion" IS NULL;
                UPDATE "kyc_applications" SET "next_of_kin_full_name" = '-' WHERE "next_of_kin_full_name" IS NULL;
                UPDATE "kyc_applications" SET "next_of_kin_address" = '-' WHERE "next_of_kin_address" IS NULL;
                UPDATE "kyc_applications" SET "next_of_kin_relationship" = '-' WHERE "next_of_kin_relationship" IS NULL;
                UPDATE "kyc_applications" SET "next_of_kin_phone_number" = '-' WHERE "next_of_kin_phone_number" IS NULL;
                UPDATE "kyc_applications" SET "next_of_kin_email" = '-' WHERE "next_of_kin_email" IS NULL;
                UPDATE "kyc_applications" SET "intended_use_of_property" = '-' WHERE "intended_use_of_property" IS NULL;
                UPDATE "kyc_applications" SET "number_of_occupants" = '-' WHERE "number_of_occupants" IS NULL;
                UPDATE "kyc_applications" SET "proposed_rent_amount" = '-' WHERE "proposed_rent_amount" IS NULL;
                UPDATE "kyc_applications" SET "rent_payment_frequency" = '-' WHERE "rent_payment_frequency" IS NULL;
                UPDATE "kyc_applications" SET "passport_photo_url" = '-' WHERE "passport_photo_url" IS NULL;
                UPDATE "kyc_applications" SET "id_document_url" = '-' WHERE "id_document_url" IS NULL;
            END $$;
        `);

        // 2. Backfill date and enum columns
        await queryRunner.query(`
            DO $$ BEGIN
                UPDATE "kyc_applications" SET "date_of_birth" = '1900-01-01' WHERE "date_of_birth" IS NULL;
                UPDATE "kyc_applications" SET "gender" = 'other' WHERE "gender" IS NULL;
                UPDATE "kyc_applications" SET "marital_status" = 'single' WHERE "marital_status" IS NULL;
                UPDATE "kyc_applications" SET "employment_status" = 'unemployed' WHERE "employment_status" IS NULL;
            END $$;
        `);

        // 3. Add NOT NULL constraints to kyc_applications
        await queryRunner.query(`
            DO $$ BEGIN
                ALTER TABLE "kyc_applications" ALTER COLUMN "email" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "contact_address" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "date_of_birth" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "gender" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "nationality" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "state_of_origin" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "marital_status" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "employment_status" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "religion" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "next_of_kin_full_name" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "next_of_kin_address" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "next_of_kin_relationship" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "next_of_kin_phone_number" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "next_of_kin_email" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "intended_use_of_property" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "number_of_occupants" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "proposed_rent_amount" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "rent_payment_frequency" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "passport_photo_url" SET NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "id_document_url" SET NOT NULL;
            END $$;
        `);

        // --- tenant_kyc: Backfill NULLs and add NOT NULL constraints ---

        // 4. Backfill string columns with '-'
        await queryRunner.query(`
            DO $$ BEGIN
                UPDATE "tenant_kyc" SET "current_residence" = '-' WHERE "current_residence" IS NULL;
                UPDATE "tenant_kyc" SET "state_of_origin" = '-' WHERE "state_of_origin" IS NULL;
                UPDATE "tenant_kyc" SET "religion" = '-' WHERE "religion" IS NULL;
                UPDATE "tenant_kyc" SET "occupation" = '-' WHERE "occupation" IS NULL;
                UPDATE "tenant_kyc" SET "contact_address" = '-' WHERE "contact_address" IS NULL;
                UPDATE "tenant_kyc" SET "monthly_net_income" = '0' WHERE "monthly_net_income" IS NULL;
                UPDATE "tenant_kyc" SET "next_of_kin_full_name" = '-' WHERE "next_of_kin_full_name" IS NULL;
                UPDATE "tenant_kyc" SET "next_of_kin_address" = '-' WHERE "next_of_kin_address" IS NULL;
                UPDATE "tenant_kyc" SET "next_of_kin_relationship" = '-' WHERE "next_of_kin_relationship" IS NULL;
                UPDATE "tenant_kyc" SET "next_of_kin_phone_number" = '-' WHERE "next_of_kin_phone_number" IS NULL;
                UPDATE "tenant_kyc" SET "next_of_kin_email" = '-' WHERE "next_of_kin_email" IS NULL;
            END $$;
        `);

        // 5. Add NOT NULL constraints to tenant_kyc
        await queryRunner.query(`
            DO $$ BEGIN
                ALTER TABLE "tenant_kyc" ALTER COLUMN "current_residence" SET NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "state_of_origin" SET NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "religion" SET NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "occupation" SET NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "contact_address" SET NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "monthly_net_income" SET NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "next_of_kin_full_name" SET NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "next_of_kin_address" SET NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "next_of_kin_relationship" SET NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "next_of_kin_phone_number" SET NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "next_of_kin_email" SET NOT NULL;
            END $$;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Revert kyc_applications columns back to nullable
        await queryRunner.query(`
            DO $$ BEGIN
                ALTER TABLE "kyc_applications" ALTER COLUMN "email" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "contact_address" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "date_of_birth" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "gender" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "nationality" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "state_of_origin" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "marital_status" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "employment_status" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "religion" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "next_of_kin_full_name" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "next_of_kin_address" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "next_of_kin_relationship" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "next_of_kin_phone_number" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "next_of_kin_email" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "intended_use_of_property" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "number_of_occupants" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "proposed_rent_amount" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "rent_payment_frequency" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "passport_photo_url" DROP NOT NULL;
                ALTER TABLE "kyc_applications" ALTER COLUMN "id_document_url" DROP NOT NULL;
            END $$;
        `);

        // Revert tenant_kyc columns back to nullable
        await queryRunner.query(`
            DO $$ BEGIN
                ALTER TABLE "tenant_kyc" ALTER COLUMN "current_residence" DROP NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "state_of_origin" DROP NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "religion" DROP NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "occupation" DROP NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "contact_address" DROP NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "monthly_net_income" DROP NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "next_of_kin_full_name" DROP NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "next_of_kin_address" DROP NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "next_of_kin_relationship" DROP NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "next_of_kin_phone_number" DROP NOT NULL;
                ALTER TABLE "tenant_kyc" ALTER COLUMN "next_of_kin_email" DROP NOT NULL;
            END $$;
        `);
    }
}

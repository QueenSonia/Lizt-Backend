import { MigrationInterface, QueryRunner } from "typeorm";

export class FinalKycAlignmentDefensive1768483572900 implements MigrationInterface {
    name = 'FinalKycAlignmentDefensive1768483572900'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // --- kyc_applications: High-Defensive Alignment ---

        // 1. Work Columns
        await queryRunner.query(`
            DO $$ BEGIN
                -- Ensure work_address exists
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'work_address') THEN
                    ALTER TABLE "kyc_applications" ADD COLUMN "work_address" character varying;
                END IF;
                -- Copy data if legacy exists
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'employer_address') THEN
                    UPDATE "kyc_applications" SET "work_address" = "employer_address" WHERE "work_address" IS NULL;
                    ALTER TABLE "kyc_applications" DROP COLUMN "employer_address";
                END IF;
                -- Rename phone number if legacy exists
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'employer_phone_number') THEN
                    ALTER TABLE "kyc_applications" RENAME COLUMN "employer_phone_number" TO "work_phone_number";
                END IF;
            END $$;
        `);

        // 2. Next of Kin (Reference 1)
        await queryRunner.query(`
            DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'reference1_name') THEN
                    ALTER TABLE "kyc_applications" RENAME COLUMN "reference1_name" TO "next_of_kin_full_name";
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'reference1_address') THEN
                    ALTER TABLE "kyc_applications" RENAME COLUMN "reference1_address" TO "next_of_kin_address";
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'reference1_relationship') THEN
                    ALTER TABLE "kyc_applications" RENAME COLUMN "reference1_relationship" TO "next_of_kin_relationship";
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'reference1_phone_number') THEN
                    ALTER TABLE "kyc_applications" RENAME COLUMN "reference1_phone_number" TO "next_of_kin_phone_number";
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'reference1_email') THEN
                    ALTER TABLE "kyc_applications" RENAME COLUMN "reference1_email" TO "next_of_kin_email";
                END IF;
            END $$;
        `);

        // 3. Referral Agent (Reference 2)
        await queryRunner.query(`
            DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'reference2_name') THEN
                    ALTER TABLE "kyc_applications" RENAME COLUMN "reference2_name" TO "referral_agent_full_name";
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'reference2_phone_number') THEN
                    ALTER TABLE "kyc_applications" RENAME COLUMN "reference2_phone_number" TO "referral_agent_phone_number";
                END IF;
                -- Drop unused
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'reference2_address') THEN
                    ALTER TABLE "kyc_applications" DROP COLUMN "reference2_address";
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'reference2_relationship') THEN
                    ALTER TABLE "kyc_applications" DROP COLUMN "reference2_relationship";
                END IF;
            END $$;
        `);

        // 4. Parking Needs & ID Fields
        await queryRunner.query(`
            DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'number_of_cars_owned') THEN
                    ALTER TABLE "kyc_applications" RENAME COLUMN "number_of_cars_owned" TO "parking_needs";
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'pending_kyc_id') THEN
                    ALTER TABLE "kyc_applications" ADD COLUMN "pending_kyc_id" character varying;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'available_property_ids') THEN
                    ALTER TABLE "kyc_applications" ADD COLUMN "available_property_ids" character varying;
                END IF;
            END $$;
        `);

        // --- tenant_kyc: High-Defensive Alignment ---
        await queryRunner.query(`
            DO $$ BEGIN
                -- Work Columns
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenant_kyc' AND column_name = 'employer_address') THEN
                    ALTER TABLE "tenant_kyc" RENAME COLUMN "employer_address" TO "work_address";
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenant_kyc' AND column_name = 'employer_phone_number') THEN
                    ALTER TABLE "tenant_kyc" RENAME COLUMN "employer_phone_number" TO "work_phone_number";
                END IF;

                -- Next of Kin
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenant_kyc' AND column_name = 'reference1_name') THEN
                    ALTER TABLE "tenant_kyc" RENAME COLUMN "reference1_name" TO "next_of_kin_full_name";
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenant_kyc' AND column_name = 'reference1_address') THEN
                    ALTER TABLE "tenant_kyc" RENAME COLUMN "reference1_address" TO "next_of_kin_address";
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenant_kyc' AND column_name = 'reference1_relationship') THEN
                    ALTER TABLE "tenant_kyc" RENAME COLUMN "reference1_relationship" TO "next_of_kin_relationship";
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenant_kyc' AND column_name = 'reference1_phone_number') THEN
                    ALTER TABLE "tenant_kyc" RENAME COLUMN "reference1_phone_number" TO "next_of_kin_phone_number";
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenant_kyc' AND column_name = 'next_of_kin_email') THEN
                    ALTER TABLE "tenant_kyc" ADD COLUMN "next_of_kin_email" character varying;
                END IF;

                -- Referral Agent
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenant_kyc' AND column_name = 'reference2_name') THEN
                    ALTER TABLE "tenant_kyc" RENAME COLUMN "reference2_name" TO "referral_agent_full_name";
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenant_kyc' AND column_name = 'reference2_phone_number') THEN
                    ALTER TABLE "tenant_kyc" RENAME COLUMN "reference2_phone_number" TO "referral_agent_phone_number";
                END IF;

                -- Missing Employment field
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenant_kyc' AND column_name = 'length_of_employment') THEN
                    ALTER TABLE "tenant_kyc" ADD COLUMN "length_of_employment" character varying;
                END IF;
            END $$;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Rollback is complex with defensive logic, keeping it simple as we want to stay aligned.
    }

}

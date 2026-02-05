import { MigrationInterface, QueryRunner } from "typeorm";

export class FixSchemaDrift1768484395312 implements MigrationInterface {
    name = 'FixSchemaDrift1768484395312'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "employer_phone_number"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "number_of_cars_owned"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "employer_address"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "reference1_name"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "reference1_address"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "reference1_relationship"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "reference1_phone_number"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "reference2_name"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "reference2_address"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "reference2_relationship"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "reference2_phone_number"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "reference1_email"`);
        await queryRunner.query(`ALTER TABLE "tenant_kyc" ADD "length_of_employment" character varying`);
        await queryRunner.query(`ALTER TABLE "tenant_kyc" ADD "next_of_kin_email" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "work_phone_number" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "next_of_kin_full_name" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "next_of_kin_address" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "next_of_kin_relationship" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "next_of_kin_phone_number" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "next_of_kin_email" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "referral_agent_full_name" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "referral_agent_phone_number" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "parking_needs" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "pending_kyc_id" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "available_property_ids" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "available_property_ids"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "pending_kyc_id"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "parking_needs"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "referral_agent_phone_number"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "referral_agent_full_name"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "next_of_kin_email"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "next_of_kin_phone_number"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "next_of_kin_relationship"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "next_of_kin_address"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "next_of_kin_full_name"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" DROP COLUMN "work_phone_number"`);
        await queryRunner.query(`ALTER TABLE "tenant_kyc" DROP COLUMN "next_of_kin_email"`);
        await queryRunner.query(`ALTER TABLE "tenant_kyc" DROP COLUMN "length_of_employment"`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "reference1_email" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "reference2_phone_number" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "reference2_relationship" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "reference2_address" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "reference2_name" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "reference1_phone_number" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "reference1_relationship" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "reference1_address" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "reference1_name" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "employer_address" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "number_of_cars_owned" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_applications" ADD "employer_phone_number" character varying`);
    }

}

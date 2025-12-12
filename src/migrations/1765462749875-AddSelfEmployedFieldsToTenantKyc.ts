import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSelfEmployedFieldsToTenantKyc1765462749875 implements MigrationInterface {
    name = 'AddSelfEmployedFieldsToTenantKyc1765462749875'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tenant_kyc" ADD "nature_of_business" character varying`);
        await queryRunner.query(`ALTER TABLE "tenant_kyc" ADD "business_name" character varying`);
        await queryRunner.query(`ALTER TABLE "tenant_kyc" ADD "business_address" character varying`);
        await queryRunner.query(`ALTER TABLE "tenant_kyc" ADD "business_duration" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tenant_kyc" DROP COLUMN "business_duration"`);
        await queryRunner.query(`ALTER TABLE "tenant_kyc" DROP COLUMN "business_address"`);
        await queryRunner.query(`ALTER TABLE "tenant_kyc" DROP COLUMN "business_name"`);
        await queryRunner.query(`ALTER TABLE "tenant_kyc" DROP COLUMN "nature_of_business"`);
    }

}

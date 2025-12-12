import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBusinessDurationToUsers1765463023147 implements MigrationInterface {
    name = 'AddBusinessDurationToUsers1765463023147'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "business_duration" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "business_duration"`);
    }

}

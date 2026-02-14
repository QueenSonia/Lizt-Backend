import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixTeamMemberRoleEnum1771500000001 implements MigrationInterface {
    name = 'FixTeamMemberRoleEnum1771500000001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TYPE "public"."team_member_role_enum" ADD VALUE IF NOT EXISTS 'prospect_agent';
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Note: PostgreSQL does not support removing values from an ENUM type
    }
}

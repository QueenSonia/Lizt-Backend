import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakePropertyHistoryTenantIdNullable1734336000000
  implements MigrationInterface
{
  name = 'MakePropertyHistoryTenantIdNullable1734336000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Make tenant_id nullable in property_histories table
    await queryRunner.query(
      `ALTER TABLE "property_histories" ALTER COLUMN "tenant_id" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert tenant_id to NOT NULL (this might fail if there are null values)
    await queryRunner.query(
      `ALTER TABLE "property_histories" ALTER COLUMN "tenant_id" SET NOT NULL`,
    );
  }
}

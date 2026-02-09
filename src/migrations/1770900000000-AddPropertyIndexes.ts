import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPropertyIndexes1770900000000 implements MigrationInterface {
  name = 'AddPropertyIndexes1770900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Index for filtering by owner (most common query pattern)
    await queryRunner.query(`
      CREATE INDEX "IDX_properties_owner_id" ON "properties" ("owner_id")
    `);

    // Composite index for vacant properties query (owner + status)
    await queryRunner.query(`
      CREATE INDEX "IDX_properties_owner_status" ON "properties" ("owner_id", "property_status")
    `);

    // Index for status-only queries
    await queryRunner.query(`
      CREATE INDEX "IDX_properties_status" ON "properties" ("property_status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_properties_status"`);
    await queryRunner.query(`DROP INDEX "IDX_properties_owner_status"`);
    await queryRunner.query(`DROP INDEX "IDX_properties_owner_id"`);
  }
}

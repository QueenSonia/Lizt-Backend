import { MigrationInterface, QueryRunner } from 'typeorm';

export class MovePaymentFrequencyToRents1761600000000
  implements MigrationInterface
{
  name = 'MovePaymentFrequencyToRents1761600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add payment_frequency column to rents table
    await queryRunner.query(`
      ALTER TABLE "rents" 
      ADD COLUMN "payment_frequency" varchar
    `);

    // Copy payment_frequency from properties to active rents
    await queryRunner.query(`
      UPDATE "rents" 
      SET "payment_frequency" = "properties"."payment_frequency"
      FROM "properties"
      WHERE "rents"."property_id" = "properties"."id" 
      AND "rents"."rent_status" = 'active'
    `);

    // Remove payment_frequency column from properties table
    await queryRunner.query(`
      ALTER TABLE "properties" 
      DROP COLUMN "payment_frequency"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Add payment_frequency column back to properties table
    await queryRunner.query(`
      ALTER TABLE "properties" 
      ADD COLUMN "payment_frequency" varchar
    `);

    // Copy payment_frequency from active rents back to properties
    await queryRunner.query(`
      UPDATE "properties" 
      SET "payment_frequency" = "rents"."payment_frequency"
      FROM "rents"
      WHERE "properties"."id" = "rents"."property_id" 
      AND "rents"."rent_status" = 'active'
    `);

    // Remove payment_frequency column from rents table
    await queryRunner.query(`
      ALTER TABLE "rents" 
      DROP COLUMN "payment_frequency"
    `);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReadyForMarketingStatus1734456000000
  implements MigrationInterface
{
  name = 'AddReadyForMarketingStatus1734456000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Add the new enum value
    // PostgreSQL requires this to be in a separate transaction from using the value
    await queryRunner.query(`
      ALTER TYPE "properties_property_status_enum" ADD VALUE 'ready_for_marketing'
    `);

    // Step 2: Commit the transaction to make the enum value available
    await queryRunner.commitTransaction();

    // Step 3: Start a new transaction for the data update
    await queryRunner.startTransaction();

    // Step 4: Update existing data - Convert vacant properties with rental_price to ready_for_marketing
    await queryRunner.query(`
      UPDATE properties 
      SET property_status = 'ready_for_marketing' 
      WHERE property_status = 'vacant' 
      AND rental_price IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert ready_for_marketing properties back to vacant
    await queryRunner.query(`
      UPDATE properties 
      SET property_status = 'vacant' 
      WHERE property_status = 'ready_for_marketing'
    `);

    // Note: PostgreSQL does not support removing enum values directly
    // To remove 'ready_for_marketing', you would need to:
    // 1. Create a new enum type without the value
    // 2. Alter the column to use the new type
    // 3. Drop the old enum type
    // This is complex and risky, so we're leaving it as a no-op
    console.log(
      'Warning: Cannot automatically remove enum value "ready_for_marketing". Manual intervention required if rollback is necessary.',
    );
  }
}

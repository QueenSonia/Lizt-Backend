import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPendingCompletionStatusAndIndexes1764100000000
  implements MigrationInterface
{
  name = 'AddPendingCompletionStatusAndIndexes1764100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add 'pending_completion' value to the application_status enum
    // TypeORM creates enum types with the naming convention: {table}_{column}_enum
    await queryRunner.query(
      `DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum 
          WHERE enumlabel = 'pending_completion' 
          AND enumtypid = (
            SELECT oid FROM pg_type WHERE typname = 'kyc_applications_status_enum'
          )
        ) THEN
          ALTER TYPE "public"."kyc_applications_status_enum" ADD VALUE 'pending_completion';
        END IF;
      END $$;`,
    );

    // Create index on phone_number for faster lookups
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kyc_applications_phone_number" ON "kyc_applications" ("phone_number")`,
    );

    // Create index on status for faster filtering
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kyc_applications_status" ON "kyc_applications" ("status")`,
    );

    // Create composite index on phone_number and status for optimized pending completion lookups
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kyc_applications_phone_status" ON "kyc_applications" ("phone_number", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the indexes
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_kyc_applications_phone_status"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_kyc_applications_status"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_kyc_applications_phone_number"`,
    );

    // Note: PostgreSQL does not support removing enum values directly
    // To remove 'pending_completion', you would need to:
    // 1. Create a new enum type without the value
    // 2. Alter the column to use the new type
    // 3. Drop the old enum type
    // This is complex and risky, so we're leaving it as a no-op
    // If rollback is needed, manual intervention would be required
    console.log(
      'Warning: Cannot automatically remove enum value "pending_completion". Manual intervention required if rollback is necessary.',
    );
  }
}

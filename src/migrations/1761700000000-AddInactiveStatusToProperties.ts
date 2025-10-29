import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInactiveStatusToProperties1761700000000
  implements MigrationInterface
{
  name = 'AddInactiveStatusToProperties1761700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add the new 'inactive' value to the property_status enum
    await queryRunner.query(
      `ALTER TYPE "properties_property_status_enum" ADD VALUE 'inactive'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Note: PostgreSQL doesn't support removing enum values directly
    // This would require recreating the enum type, which is complex
    // For now, we'll leave a comment about manual cleanup if needed

    // To properly rollback, you would need to:
    // 1. Create a new enum without 'inactive'
    // 2. Update all columns to use the new enum
    // 3. Drop the old enum
    // 4. Rename the new enum to the original name

    console.log(
      'Warning: Cannot automatically remove enum value. Manual cleanup required if rollback is needed.',
    );
  }
}

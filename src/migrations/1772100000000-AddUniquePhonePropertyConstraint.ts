import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniquePhonePropertyConstraint1772100000000
  implements MigrationInterface
{
  name = 'AddUniquePhonePropertyConstraint1772100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // First, remove any existing duplicates (keep the most recent per phone+property).
    // This ensures the unique index can be created cleanly.
    await queryRunner.query(`
      DELETE FROM "kyc_applications"
      WHERE "deleted_at" IS NULL
        AND "id" NOT IN (
          SELECT DISTINCT ON ("phone_number", "property_id") "id"
          FROM "kyc_applications"
          WHERE "deleted_at" IS NULL
          ORDER BY "phone_number", "property_id", "created_at" DESC
        )
    `);

    // Create a unique partial index on (phone_number, property_id) for non-deleted rows.
    // This prevents the race condition where two concurrent requests both pass the
    // application-level duplicate check and insert two rows.
    // The WHERE clause excludes soft-deleted rows so reapplication still works after deletion.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_kyc_app_phone_property_active"
      ON "kyc_applications" ("phone_number", "property_id")
      WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_kyc_app_phone_property_active"`,
    );
  }
}

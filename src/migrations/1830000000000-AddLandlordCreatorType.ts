import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds 'landlord' to the maintenance-request creator-type enum so landlords
 * can originate maintenance requests directly (in addition to filing on behalf
 * of tenants via approve+assign).
 *
 * `changed_by_role` on the status-history table is a varchar (not an enum) so
 * no migration is needed for the new 'landlord' actor label.
 */
export class AddLandlordCreatorType1830000000000 implements MigrationInterface {
  name = 'AddLandlordCreatorType1830000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'landlord'
          AND enumtypid = (
            SELECT oid FROM pg_type
            WHERE typname = 'maintenance_request_creator_type_enum'
          )
        ) THEN
          ALTER TYPE "public"."maintenance_request_creator_type_enum" ADD VALUE 'landlord';
        END IF;
      END $$;`,
    );
  }

  public async down(): Promise<void> {
    console.log(
      'Warning: AddLandlordCreatorType cannot be automatically rolled back. Postgres requires rebuilding the enum type to drop a value. Manual intervention required.',
    );
  }
}

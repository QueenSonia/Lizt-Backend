import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOfferAcceptedStatus1769100000000 implements MigrationInterface {
  name = 'AddOfferAcceptedStatus1769100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add 'offer_accepted' to the property_status enum
    // Check if the enum value already exists before adding
    await queryRunner.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum 
          WHERE enumlabel = 'offer_accepted' 
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'properties_property_status_enum')
        ) THEN
          ALTER TYPE properties_property_status_enum ADD VALUE 'offer_accepted';
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Note: PostgreSQL doesn't support removing enum values easily
    // The 'offer_accepted' value will remain in the enum but won't cause issues
  }
}

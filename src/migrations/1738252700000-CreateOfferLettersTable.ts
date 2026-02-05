import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateOfferLettersTable1738252700000
  implements MigrationInterface
{
  name = 'CreateOfferLettersTable1738252700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // First, add 'offer_pending' to the property_status enum
    // Check if the enum value already exists before adding
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum 
          WHERE enumlabel = 'offer_pending' 
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'properties_property_status_enum')
        ) THEN
          ALTER TYPE properties_property_status_enum ADD VALUE 'offer_pending';
        END IF;
      END
      $$;
    `);

    // Create the offer_letters table
    await queryRunner.createTable(
      new Table({
        name: 'offer_letters',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'kyc_application_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'property_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'landlord_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'rent_amount',
            type: 'decimal',
            precision: 12,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'rent_frequency',
            type: 'varchar',
            length: '20',
            isNullable: false,
          },
          {
            name: 'service_charge',
            type: 'decimal',
            precision: 12,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'tenancy_start_date',
            type: 'date',
            isNullable: false,
          },
          {
            name: 'tenancy_end_date',
            type: 'date',
            isNullable: false,
          },
          {
            name: 'caution_deposit',
            type: 'decimal',
            precision: 12,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'legal_fee',
            type: 'decimal',
            precision: 12,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'agency_fee',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['pending', 'accepted', 'rejected'],
            default: "'pending'",
            isNullable: false,
          },
          {
            name: 'token',
            type: 'varchar',
            length: '64',
            isUnique: true,
            isNullable: false,
          },
          {
            name: 'terms_of_tenancy',
            type: 'jsonb',
            isNullable: false,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'deleted_at',
            type: 'timestamp',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Create indexes for better query performance
    await queryRunner.createIndex(
      'offer_letters',
      new TableIndex({
        name: 'IDX_offer_letters_kyc_application_id',
        columnNames: ['kyc_application_id'],
      }),
    );

    await queryRunner.createIndex(
      'offer_letters',
      new TableIndex({
        name: 'IDX_offer_letters_property_id',
        columnNames: ['property_id'],
      }),
    );

    await queryRunner.createIndex(
      'offer_letters',
      new TableIndex({
        name: 'IDX_offer_letters_landlord_id',
        columnNames: ['landlord_id'],
      }),
    );

    await queryRunner.createIndex(
      'offer_letters',
      new TableIndex({
        name: 'IDX_offer_letters_token',
        columnNames: ['token'],
      }),
    );

    await queryRunner.createIndex(
      'offer_letters',
      new TableIndex({
        name: 'IDX_offer_letters_status',
        columnNames: ['status'],
      }),
    );

    // Create foreign key constraints
    await queryRunner.createForeignKey(
      'offer_letters',
      new TableForeignKey({
        columnNames: ['kyc_application_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'kyc_applications',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'offer_letters',
      new TableForeignKey({
        columnNames: ['property_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'properties',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'offer_letters',
      new TableForeignKey({
        columnNames: ['landlord_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'accounts',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys first
    const table = await queryRunner.getTable('offer_letters');
    if (table) {
      const foreignKeys = table.foreignKeys;
      for (const foreignKey of foreignKeys) {
        await queryRunner.dropForeignKey('offer_letters', foreignKey);
      }
    }

    // Drop the offer_letters table
    await queryRunner.dropTable('offer_letters');

    // Note: PostgreSQL doesn't support removing enum values easily
    // The 'offer_pending' value will remain in the enum but won't cause issues
  }
}

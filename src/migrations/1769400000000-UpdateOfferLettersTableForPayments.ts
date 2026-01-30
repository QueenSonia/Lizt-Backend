import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

export class UpdateOfferLettersTableForPayments1769400000000
  implements MigrationInterface
{
  name = 'UpdateOfferLettersTableForPayments1769400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1.3.1: Add total_amount, amount_paid, outstanding_balance columns
    await queryRunner.addColumn(
      'offer_letters',
      new TableColumn({
        name: 'total_amount',
        type: 'decimal',
        precision: 12,
        scale: 2,
        isNullable: true, // Nullable initially for existing records
      }),
    );

    await queryRunner.addColumn(
      'offer_letters',
      new TableColumn({
        name: 'amount_paid',
        type: 'decimal',
        precision: 12,
        scale: 2,
        default: 0,
        isNullable: false,
      }),
    );

    await queryRunner.addColumn(
      'offer_letters',
      new TableColumn({
        name: 'outstanding_balance',
        type: 'decimal',
        precision: 12,
        scale: 2,
        isNullable: true, // Nullable initially for existing records
      }),
    );

    // 1.3.2: Add payment_status column with enum
    // First create the enum type
    await queryRunner.query(`
      CREATE TYPE offer_letters_payment_status_enum AS ENUM (
        'unpaid',
        'partial',
        'fully_paid'
      );
    `);

    await queryRunner.addColumn(
      'offer_letters',
      new TableColumn({
        name: 'payment_status',
        type: 'enum',
        enum: ['unpaid', 'partial', 'fully_paid'],
        enumName: 'offer_letters_payment_status_enum',
        default: "'unpaid'",
        isNullable: false,
      }),
    );

    // 1.3.3: Add selected_at timestamp column
    await queryRunner.addColumn(
      'offer_letters',
      new TableColumn({
        name: 'selected_at',
        type: 'timestamp',
        isNullable: true,
      }),
    );

    // 1.3.4: Add new status enum values (selected, rejected_by_payment, payment_held_race_condition)
    // Check and add each enum value if it doesn't exist
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum 
          WHERE enumlabel = 'selected' 
          AND enumtypid = (
            SELECT oid FROM pg_type 
            WHERE typname = 'offer_letters_status_enum'
          )
        ) THEN
          ALTER TYPE offer_letters_status_enum ADD VALUE 'selected';
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum 
          WHERE enumlabel = 'rejected_by_payment' 
          AND enumtypid = (
            SELECT oid FROM pg_type 
            WHERE typname = 'offer_letters_status_enum'
          )
        ) THEN
          ALTER TYPE offer_letters_status_enum ADD VALUE 'rejected_by_payment';
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum 
          WHERE enumlabel = 'payment_held_race_condition' 
          AND enumtypid = (
            SELECT oid FROM pg_type 
            WHERE typname = 'offer_letters_status_enum'
          )
        ) THEN
          ALTER TYPE offer_letters_status_enum ADD VALUE 'payment_held_race_condition';
        END IF;
      END
      $$;
    `);

    // 1.3.5: Add indexes for payment queries
    await queryRunner.createIndex(
      'offer_letters',
      new TableIndex({
        name: 'IDX_offer_letters_payment_status',
        columnNames: ['payment_status'],
      }),
    );

    await queryRunner.createIndex(
      'offer_letters',
      new TableIndex({
        name: 'IDX_offer_letters_property_payment',
        columnNames: ['property_id', 'payment_status', 'status'],
      }),
    );

    // Update existing records to calculate total_amount and outstanding_balance
    // This handles existing offer letters that were created before this migration
    await queryRunner.query(`
      UPDATE offer_letters
      SET 
        total_amount = COALESCE(rent_amount, 0) + 
                      COALESCE(service_charge, 0) + 
                      COALESCE(
                        CASE 
                          WHEN caution_deposit IS NOT NULL AND caution_deposit::text ~ '^[0-9]+\.?[0-9]*$'
                          THEN caution_deposit
                          ELSE 0
                        END, 0
                      ) + 
                      COALESCE(
                        CASE 
                          WHEN legal_fee IS NOT NULL AND legal_fee::text ~ '^[0-9]+\.?[0-9]*$'
                          THEN legal_fee
                          ELSE 0
                        END, 0
                      ) + 
                      COALESCE(
                        CASE 
                          WHEN agency_fee IS NOT NULL AND agency_fee::text ~ '^[0-9]+\.?[0-9]*$'
                          THEN agency_fee::decimal
                          ELSE 0
                        END, 0
                      ),
        outstanding_balance = COALESCE(rent_amount, 0) + 
                             COALESCE(service_charge, 0) + 
                             COALESCE(
                               CASE 
                                 WHEN caution_deposit IS NOT NULL AND caution_deposit::text ~ '^[0-9]+\.?[0-9]*$'
                                 THEN caution_deposit
                                 ELSE 0
                               END, 0
                             ) + 
                             COALESCE(
                               CASE 
                                 WHEN legal_fee IS NOT NULL AND legal_fee::text ~ '^[0-9]+\.?[0-9]*$'
                                 THEN legal_fee
                                 ELSE 0
                               END, 0
                             ) + 
                             COALESCE(
                               CASE 
                                 WHEN agency_fee IS NOT NULL AND agency_fee::text ~ '^[0-9]+\.?[0-9]*$'
                                 THEN agency_fee::decimal
                                 ELSE 0
                               END, 0
                             )
      WHERE total_amount IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.dropIndex(
      'offer_letters',
      'IDX_offer_letters_property_payment',
    );
    await queryRunner.dropIndex(
      'offer_letters',
      'IDX_offer_letters_payment_status',
    );

    // Drop columns
    await queryRunner.dropColumn('offer_letters', 'selected_at');
    await queryRunner.dropColumn('offer_letters', 'payment_status');
    await queryRunner.dropColumn('offer_letters', 'outstanding_balance');
    await queryRunner.dropColumn('offer_letters', 'amount_paid');
    await queryRunner.dropColumn('offer_letters', 'total_amount');

    // Drop the payment_status enum type
    await queryRunner.query(`
      DROP TYPE IF EXISTS offer_letters_payment_status_enum;
    `);

    // Note: PostgreSQL doesn't support removing enum values easily
    // The new status enum values (selected, rejected_by_payment, payment_held_race_condition)
    // will remain in the enum but won't cause issues
  }
}

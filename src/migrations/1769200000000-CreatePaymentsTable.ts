import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreatePaymentsTable1769200000000 implements MigrationInterface {
  name = 'CreatePaymentsTable1769200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the payments table
    await queryRunner.createTable(
      new Table({
        name: 'payments',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'offer_letter_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'amount',
            type: 'decimal',
            precision: 12,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'payment_type',
            type: 'enum',
            enum: ['partial', 'full'],
            isNullable: false,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['pending', 'completed', 'failed', 'refunded'],
            default: "'pending'",
            isNullable: false,
          },
          {
            name: 'payment_method',
            type: 'enum',
            enum: ['card', 'bank_transfer'],
            isNullable: true,
          },
          {
            name: 'paystack_reference',
            type: 'varchar',
            length: '255',
            isUnique: true,
            isNullable: false,
          },
          {
            name: 'paystack_access_code',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'paystack_authorization_url',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'paid_at',
            type: 'timestamp',
            isNullable: true,
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
            isNullable: false,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Create indexes for better query performance
    await queryRunner.createIndex(
      'payments',
      new TableIndex({
        name: 'IDX_payments_offer_letter_id',
        columnNames: ['offer_letter_id'],
      }),
    );

    await queryRunner.createIndex(
      'payments',
      new TableIndex({
        name: 'IDX_payments_paystack_reference',
        columnNames: ['paystack_reference'],
      }),
    );

    await queryRunner.createIndex(
      'payments',
      new TableIndex({
        name: 'IDX_payments_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'payments',
      new TableIndex({
        name: 'IDX_payments_created_at',
        columnNames: ['created_at'],
      }),
    );

    // Create foreign key constraint
    await queryRunner.createForeignKey(
      'payments',
      new TableForeignKey({
        columnNames: ['offer_letter_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'offer_letters',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys first
    const table = await queryRunner.getTable('payments');
    if (table) {
      const foreignKeys = table.foreignKeys;
      for (const foreignKey of foreignKeys) {
        await queryRunner.dropForeignKey('payments', foreignKey);
      }
    }

    // Drop the payments table
    await queryRunner.dropTable('payments');
  }
}

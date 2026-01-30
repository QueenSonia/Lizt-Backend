import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreatePaymentLogsTable1769300000000 implements MigrationInterface {
  name = 'CreatePaymentLogsTable1769300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the payment_logs table
    await queryRunner.createTable(
      new Table({
        name: 'payment_logs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'payment_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'event_type',
            type: 'enum',
            enum: ['webhook', 'polling', 'initiation', 'verification', 'error'],
            isNullable: false,
          },
          {
            name: 'event_data',
            type: 'jsonb',
            isNullable: false,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    // Create indexes for better query performance
    await queryRunner.createIndex(
      'payment_logs',
      new TableIndex({
        name: 'IDX_payment_logs_payment_id',
        columnNames: ['payment_id'],
      }),
    );

    await queryRunner.createIndex(
      'payment_logs',
      new TableIndex({
        name: 'IDX_payment_logs_event_type',
        columnNames: ['event_type'],
      }),
    );

    await queryRunner.createIndex(
      'payment_logs',
      new TableIndex({
        name: 'IDX_payment_logs_created_at',
        columnNames: ['created_at'],
      }),
    );

    // Create foreign key constraint
    await queryRunner.createForeignKey(
      'payment_logs',
      new TableForeignKey({
        columnNames: ['payment_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'payments',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys first
    const table = await queryRunner.getTable('payment_logs');
    if (table) {
      const foreignKeys = table.foreignKeys;
      for (const foreignKey of foreignKeys) {
        await queryRunner.dropForeignKey('payment_logs', foreignKey);
      }
    }

    // Drop the payment_logs table
    await queryRunner.dropTable('payment_logs');
  }
}

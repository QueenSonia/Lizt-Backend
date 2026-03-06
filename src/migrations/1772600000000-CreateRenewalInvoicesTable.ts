import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateRenewalInvoicesTable1772600000000
  implements MigrationInterface
{
  name = 'CreateRenewalInvoicesTable1772600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the renewal_invoices table
    await queryRunner.createTable(
      new Table({
        name: 'renewal_invoices',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'token',
            type: 'varchar',
            length: '255',
            isUnique: true,
            isNullable: false,
          },
          {
            name: 'property_tenant_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'property_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'tenant_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'start_date',
            type: 'date',
            isNullable: false,
          },
          {
            name: 'end_date',
            type: 'date',
            isNullable: false,
          },
          {
            name: 'rent_amount',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'service_charge',
            type: 'decimal',
            precision: 10,
            scale: 2,
            default: 0,
            isNullable: false,
          },
          {
            name: 'legal_fee',
            type: 'decimal',
            precision: 10,
            scale: 2,
            default: 0,
            isNullable: false,
          },
          {
            name: 'other_charges',
            type: 'decimal',
            precision: 10,
            scale: 2,
            default: 0,
            isNullable: false,
          },
          {
            name: 'total_amount',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'payment_status',
            type: 'varchar',
            length: '20',
            default: "'unpaid'",
            isNullable: false,
          },
          {
            name: 'payment_reference',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'paid_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'otp_verified',
            type: 'boolean',
            default: false,
            isNullable: false,
          },
          {
            name: 'otp_verified_at',
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
            name: 'deleted_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'expires_at',
            type: 'timestamp',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Create indexes for better query performance
    await queryRunner.createIndex(
      'renewal_invoices',
      new TableIndex({
        name: 'IDX_renewal_invoices_token',
        columnNames: ['token'],
      }),
    );

    await queryRunner.createIndex(
      'renewal_invoices',
      new TableIndex({
        name: 'IDX_renewal_invoices_property_tenant_id',
        columnNames: ['property_tenant_id'],
      }),
    );

    await queryRunner.createIndex(
      'renewal_invoices',
      new TableIndex({
        name: 'IDX_renewal_invoices_payment_status',
        columnNames: ['payment_status'],
      }),
    );

    await queryRunner.createIndex(
      'renewal_invoices',
      new TableIndex({
        name: 'IDX_renewal_invoices_created_at',
        columnNames: ['created_at'],
      }),
    );

    // Create foreign key constraints
    await queryRunner.createForeignKey(
      'renewal_invoices',
      new TableForeignKey({
        columnNames: ['property_tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'property_tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'renewal_invoices',
      new TableForeignKey({
        columnNames: ['property_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'properties',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'renewal_invoices',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'accounts',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys first
    const table = await queryRunner.getTable('renewal_invoices');
    if (table) {
      const foreignKeys = table.foreignKeys;
      for (const foreignKey of foreignKeys) {
        await queryRunner.dropForeignKey('renewal_invoices', foreignKey);
      }
    }

    // Drop the renewal_invoices table
    await queryRunner.dropTable('renewal_invoices');
  }
}

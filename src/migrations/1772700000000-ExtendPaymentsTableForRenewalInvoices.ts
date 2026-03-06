import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class ExtendPaymentsTableForRenewalInvoices1772700000000
  implements MigrationInterface
{
  name = 'ExtendPaymentsTableForRenewalInvoices1772700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add renewal_invoice_id column to payments table
    await queryRunner.addColumn(
      'payments',
      new TableColumn({
        name: 'renewal_invoice_id',
        type: 'uuid',
        isNullable: true,
      }),
    );

    // Create index for renewal_invoice_id
    await queryRunner.createIndex(
      'payments',
      new TableIndex({
        name: 'IDX_payments_renewal_invoice_id',
        columnNames: ['renewal_invoice_id'],
      }),
    );

    // Create foreign key constraint
    await queryRunner.createForeignKey(
      'payments',
      new TableForeignKey({
        columnNames: ['renewal_invoice_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'renewal_invoices',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign key first
    const table = await queryRunner.getTable('payments');
    if (table) {
      const foreignKey = table.foreignKeys.find(
        (fk) => fk.columnNames.indexOf('renewal_invoice_id') !== -1,
      );
      if (foreignKey) {
        await queryRunner.dropForeignKey('payments', foreignKey);
      }
    }

    // Drop index
    await queryRunner.dropIndex('payments', 'IDX_payments_renewal_invoice_id');

    // Drop column
    await queryRunner.dropColumn('payments', 'renewal_invoice_id');
  }
}

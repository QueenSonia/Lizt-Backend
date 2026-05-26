import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateTenantNoticesTable1900000000000 implements MigrationInterface {
  name = 'CreateTenantNoticesTable1900000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'tenant_notices',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'tenant_id', type: 'uuid', isNullable: false },
          { name: 'landlord_id', type: 'uuid', isNullable: false },
          { name: 'fm_id', type: 'uuid', isNullable: true },
          { name: 'property_id', type: 'uuid', isNullable: true },
          { name: 'original_message', type: 'text', isNullable: false },
          { name: 'ai_extraction', type: 'jsonb', isNullable: true },
          { name: 'sub_intent', type: 'varchar', length: '64', isNullable: false },
          {
            name: 'status',
            type: 'varchar',
            length: '16',
            default: "'NEW'",
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
            isNullable: false,
          },
          { name: 'deleted_at', type: 'timestamp', isNullable: true },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'tenant_notices',
      new TableIndex({
        name: 'IDX_tenant_notices_landlord_status_created',
        columnNames: ['landlord_id', 'status', 'created_at'],
      }),
    );

    await queryRunner.createIndex(
      'tenant_notices',
      new TableIndex({
        name: 'IDX_tenant_notices_tenant_created',
        columnNames: ['tenant_id', 'created_at'],
      }),
    );

    await queryRunner.createForeignKey(
      'tenant_notices',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'accounts',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'tenant_notices',
      new TableForeignKey({
        columnNames: ['landlord_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'accounts',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('tenant_notices');
    if (table) {
      for (const fk of table.foreignKeys) {
        await queryRunner.dropForeignKey('tenant_notices', fk);
      }
    }
    await queryRunner.dropIndex(
      'tenant_notices',
      'IDX_tenant_notices_tenant_created',
    );
    await queryRunner.dropIndex(
      'tenant_notices',
      'IDX_tenant_notices_landlord_status_created',
    );
    await queryRunner.dropTable('tenant_notices');
  }
}

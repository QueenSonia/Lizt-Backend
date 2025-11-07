import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateScheduledMoveOutTable1762244482105
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'scheduled_move_outs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
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
            name: 'effective_date',
            type: 'date',
            isNullable: false,
          },
          {
            name: 'move_out_reason',
            type: 'enum',
            enum: [
              'lease_ended',
              'eviction',
              'early_termination',
              'mutual_agreement',
              'other',
            ],
            isNullable: true,
          },
          {
            name: 'owner_comment',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'tenant_comment',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'processed',
            type: 'boolean',
            default: false,
            isNullable: false,
          },
          {
            name: 'processed_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'now()',
            isNullable: false,
          },
        ],
        foreignKeys: [
          {
            columnNames: ['property_id'],
            referencedTableName: 'properties',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['tenant_id'],
            referencedTableName: 'accounts',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          {
            columnNames: ['property_id', 'tenant_id'],
          },
          {
            columnNames: ['effective_date'],
          },
          {
            columnNames: ['processed'],
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('scheduled_move_outs');
  }
}

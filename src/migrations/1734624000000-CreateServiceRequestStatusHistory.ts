import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateServiceRequestStatusHistory1734624000000
  implements MigrationInterface
{
  name = 'CreateServiceRequestStatusHistory1734624000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'service_request_status_history',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'service_request_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'previous_status',
            type: 'enum',
            enum: [
              'pending',
              'open',
              'in_progress',
              'resolved',
              'closed',
              'reopened',
              'urgent',
            ],
            isNullable: true,
          },
          {
            name: 'new_status',
            type: 'enum',
            enum: [
              'pending',
              'open',
              'in_progress',
              'resolved',
              'closed',
              'reopened',
              'urgent',
            ],
            isNullable: false,
          },
          {
            name: 'changed_by_user_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'changed_by_role',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'change_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'notes',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'changed_at',
            type: 'timestamp',
            isNullable: false,
            default: 'CURRENT_TIMESTAMP',
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
        ],
      }),
      true,
    );

    // Create indexes
    await queryRunner.createIndex(
      'service_request_status_history',
      new TableIndex({
        name: 'IDX_service_request_status_history_service_request_id',
        columnNames: ['service_request_id'],
      }),
    );

    await queryRunner.createIndex(
      'service_request_status_history',
      new TableIndex({
        name: 'IDX_service_request_status_history_changed_at',
        columnNames: ['changed_at'],
      }),
    );

    // Create foreign key constraints
    await queryRunner.createForeignKey(
      'service_request_status_history',
      new TableForeignKey({
        columnNames: ['service_request_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'service_requests',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'service_request_status_history',
      new TableForeignKey({
        columnNames: ['changed_by_user_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('service_request_status_history');
  }
}

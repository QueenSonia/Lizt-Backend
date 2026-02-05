import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateChatLogTable1767869597351 implements MigrationInterface {
  name = 'CreateChatLogTable1767869597351';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the chat_logs table
    await queryRunner.createTable(
      new Table({
        name: 'chat_logs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'phone_number',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'direction',
            type: 'enum',
            enum: ['INBOUND', 'OUTBOUND'],
            isNullable: false,
          },
          {
            name: 'message_type',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'content',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'whatsapp_message_id',
            type: 'varchar',
            isNullable: true,
            isUnique: true,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['SENT', 'DELIVERED', 'READ', 'FAILED'],
            default: "'SENT'",
            isNullable: false,
          },
          {
            name: 'error_code',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'error_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: true,
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

    // Create indexes for performance
    await queryRunner.createIndex(
      'chat_logs',
      new TableIndex({
        name: 'IDX_chat_logs_phone_number',
        columnNames: ['phone_number'],
      }),
    );

    await queryRunner.createIndex(
      'chat_logs',
      new TableIndex({
        name: 'IDX_chat_logs_created_at',
        columnNames: ['created_at'],
      }),
    );

    await queryRunner.createIndex(
      'chat_logs',
      new TableIndex({
        name: 'IDX_chat_logs_whatsapp_message_id',
        columnNames: ['whatsapp_message_id'],
        isUnique: true,
        where: 'whatsapp_message_id IS NOT NULL',
      }),
    );

    await queryRunner.createIndex(
      'chat_logs',
      new TableIndex({
        name: 'IDX_chat_logs_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'chat_logs',
      new TableIndex({
        name: 'IDX_chat_logs_direction',
        columnNames: ['direction'],
      }),
    );

    // Create foreign key constraint to users table
    await queryRunner.createForeignKey(
      'chat_logs',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'SET NULL',
        name: 'FK_chat_logs_user_id',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('chat_logs');
  }
}

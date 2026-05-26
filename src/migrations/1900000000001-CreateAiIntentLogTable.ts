import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
} from 'typeorm';

export class CreateAiIntentLogTable1900000000001 implements MigrationInterface {
  name = 'CreateAiIntentLogTable1900000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'ai_intent_log',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'tenant_id', type: 'uuid', isNullable: true },
          { name: 'phone_number', type: 'varchar', length: '32', isNullable: false },
          { name: 'inbound_text', type: 'text', isNullable: false },
          { name: 'prior_bot_message', type: 'text', isNullable: true },
          {
            name: 'prior_bot_message_type',
            type: 'varchar',
            length: '32',
            isNullable: true,
          },
          { name: 'raw_llm_response', type: 'jsonb', isNullable: true },
          { name: 'parsed_intent', type: 'varchar', length: '32', isNullable: true },
          { name: 'parsed_sub_intent', type: 'varchar', length: '64', isNullable: true },
          {
            name: 'confidence',
            type: 'decimal',
            precision: 4,
            scale: 3,
            isNullable: true,
          },
          {
            name: 'action_taken',
            type: 'varchar',
            length: '32',
            isNullable: false,
          },
          { name: 'error_message', type: 'text', isNullable: true },
          { name: 'latency_ms', type: 'int', isNullable: true },
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

    await queryRunner.createIndex(
      'ai_intent_log',
      new TableIndex({
        name: 'IDX_ai_intent_log_tenant_created',
        columnNames: ['tenant_id', 'created_at'],
      }),
    );

    await queryRunner.createIndex(
      'ai_intent_log',
      new TableIndex({
        name: 'IDX_ai_intent_log_intent_sub',
        columnNames: ['parsed_intent', 'parsed_sub_intent'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('ai_intent_log', 'IDX_ai_intent_log_intent_sub');
    await queryRunner.dropIndex('ai_intent_log', 'IDX_ai_intent_log_tenant_created');
    await queryRunner.dropTable('ai_intent_log');
  }
}

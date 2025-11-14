import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateKycFeedbackTable1731800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create kyc_feedback table
    await queryRunner.createTable(
      new Table({
        name: 'kyc_feedback',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'rating',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'comment',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'tenant_email',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'tenant_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'landlord_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'property_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'submitted_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
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
        ],
      }),
      true,
    );

    // Add check constraint for rating
    await queryRunner.query(
      `ALTER TABLE kyc_feedback ADD CONSTRAINT chk_rating CHECK (rating >= 1 AND rating <= 5)`,
    );

    // Create foreign key for landlord_id
    await queryRunner.createForeignKey(
      'kyc_feedback',
      new TableForeignKey({
        columnNames: ['landlord_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'accounts',
        onDelete: 'SET NULL',
        name: 'fk_kyc_feedback_landlord',
      }),
    );

    // Create indexes
    await queryRunner.createIndex(
      'kyc_feedback',
      new TableIndex({
        name: 'idx_kyc_feedback_landlord',
        columnNames: ['landlord_id'],
      }),
    );

    await queryRunner.createIndex(
      'kyc_feedback',
      new TableIndex({
        name: 'idx_kyc_feedback_submitted_at',
        columnNames: ['submitted_at'],
      }),
    );

    await queryRunner.createIndex(
      'kyc_feedback',
      new TableIndex({
        name: 'idx_kyc_feedback_rating',
        columnNames: ['rating'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.dropIndex('kyc_feedback', 'idx_kyc_feedback_rating');
    await queryRunner.dropIndex(
      'kyc_feedback',
      'idx_kyc_feedback_submitted_at',
    );
    await queryRunner.dropIndex('kyc_feedback', 'idx_kyc_feedback_landlord');

    // Drop foreign key
    await queryRunner.dropForeignKey(
      'kyc_feedback',
      'fk_kyc_feedback_landlord',
    );

    // Drop table
    await queryRunner.dropTable('kyc_feedback');
  }
}

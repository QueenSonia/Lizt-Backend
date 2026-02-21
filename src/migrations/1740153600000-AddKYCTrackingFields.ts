import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddKYCTrackingFields1740153600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add form_opened_at column
    await queryRunner.addColumn(
      'kyc_applications',
      new TableColumn({
        name: 'form_opened_at',
        type: 'timestamp',
        isNullable: true,
      }),
    );

    // Add form_opened_ip column
    await queryRunner.addColumn(
      'kyc_applications',
      new TableColumn({
        name: 'form_opened_ip',
        type: 'varchar',
        isNullable: true,
      }),
    );

    // Add decision_made_at column
    await queryRunner.addColumn(
      'kyc_applications',
      new TableColumn({
        name: 'decision_made_at',
        type: 'timestamp',
        isNullable: true,
      }),
    );

    // Add decision_made_ip column
    await queryRunner.addColumn(
      'kyc_applications',
      new TableColumn({
        name: 'decision_made_ip',
        type: 'varchar',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('kyc_applications', 'decision_made_ip');
    await queryRunner.dropColumn('kyc_applications', 'decision_made_at');
    await queryRunner.dropColumn('kyc_applications', 'form_opened_ip');
    await queryRunner.dropColumn('kyc_applications', 'form_opened_at');
  }
}

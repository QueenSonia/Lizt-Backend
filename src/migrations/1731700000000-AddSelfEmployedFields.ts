import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddSelfEmployedFields1731700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add self-employed specific fields to kyc_applications table
    await queryRunner.addColumn(
      'kyc_applications',
      new TableColumn({
        name: 'nature_of_business',
        type: 'varchar',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'kyc_applications',
      new TableColumn({
        name: 'business_name',
        type: 'varchar',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'kyc_applications',
      new TableColumn({
        name: 'business_address',
        type: 'varchar',
        isNullable: true,
      }),
    );

    // Note: business_duration already exists, so we don't add it again
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the added columns
    await queryRunner.dropColumn('kyc_applications', 'nature_of_business');
    await queryRunner.dropColumn('kyc_applications', 'business_name');
    await queryRunner.dropColumn('kyc_applications', 'business_address');
  }
}

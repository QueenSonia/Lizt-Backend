import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddUserAgentToKYCApplications1773200000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'kyc_applications',
      new TableColumn({
        name: 'user_agent',
        type: 'varchar',
        length: '512',
        isNullable: true,
        comment: 'Browser user agent string captured when the form was opened',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('kyc_applications', 'user_agent');
  }
}

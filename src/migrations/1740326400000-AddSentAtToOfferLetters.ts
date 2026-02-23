import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddSentAtToOfferLetters1740326400000
  implements MigrationInterface
{
  name = 'AddSentAtToOfferLetters1740326400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add sent_at column to track when offer letter was actually sent to tenant
    await queryRunner.addColumn(
      'offer_letters',
      new TableColumn({
        name: 'sent_at',
        type: 'timestamp',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('offer_letters', 'sent_at');
  }
}

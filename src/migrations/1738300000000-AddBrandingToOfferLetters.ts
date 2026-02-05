import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddBrandingToOfferLetters1738300000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add branding column to offer_letters table
    await queryRunner.addColumn(
      'offer_letters',
      new TableColumn({
        name: 'branding',
        type: 'jsonb',
        isNullable: true,
        comment:
          'Snapshot of landlord branding at time of offer letter creation',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('offer_letters', 'branding');
  }
}

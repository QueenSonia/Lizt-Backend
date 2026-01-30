import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Migration: Add PDF caching columns to offer_letters table
 * Adds pdf_url and pdf_generated_at for caching generated PDFs
 */
export class AddPdfCachingToOfferLetters1738252800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add pdf_url column to store Cloudinary URL
    await queryRunner.addColumn(
      'offer_letters',
      new TableColumn({
        name: 'pdf_url',
        type: 'text',
        isNullable: true,
      }),
    );

    // Add pdf_generated_at column to track when PDF was generated
    await queryRunner.addColumn(
      'offer_letters',
      new TableColumn({
        name: 'pdf_generated_at',
        type: 'timestamp',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('offer_letters', 'pdf_generated_at');
    await queryRunner.dropColumn('offer_letters', 'pdf_url');
  }
}

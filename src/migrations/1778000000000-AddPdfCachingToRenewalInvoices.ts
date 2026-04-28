import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Migration: Add PDF caching columns to renewal_invoices table.
 *
 * Mirrors AddPdfCachingToOfferLetters1738252800000 — same pdf_url +
 * pdf_generated_at pair. Used by RenewalLetterPdfService to skip
 * regeneration when an existing Cloudinary URL is recent. The cache is
 * also invalidated implicitly on supersession (a NEW row is created with
 * fresh nullable columns; the old row is locked but its URL keeps
 * resolving for audit / download).
 */
export class AddPdfCachingToRenewalInvoices1778000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'renewal_invoices',
      new TableColumn({
        name: 'pdf_url',
        type: 'text',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'renewal_invoices',
      new TableColumn({
        name: 'pdf_generated_at',
        type: 'timestamp',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('renewal_invoices', 'pdf_generated_at');
    await queryRunner.dropColumn('renewal_invoices', 'pdf_url');
  }
}

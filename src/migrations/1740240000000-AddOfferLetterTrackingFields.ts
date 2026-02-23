import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Migration: Add tracking fields to offer_letters table
 * Tracks when offer letters are viewed and accepted with IP addresses
 * Similar to KYC form tracking implementation
 */
export class AddOfferLetterTrackingFields1740240000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add form_opened_at - tracks when tenant views the offer letter
    await queryRunner.addColumn(
      'offer_letters',
      new TableColumn({
        name: 'form_opened_at',
        type: 'timestamp',
        isNullable: true,
        comment: 'Timestamp when the offer letter was first viewed by tenant',
      }),
    );

    // Add form_opened_ip - tracks IP address when offer letter is viewed
    await queryRunner.addColumn(
      'offer_letters',
      new TableColumn({
        name: 'form_opened_ip',
        type: 'varchar',
        length: '45',
        isNullable: true,
        comment: 'IP address when offer letter was viewed (supports IPv6)',
      }),
    );

    // Add decision_made_at - tracks when tenant accepts/rejects the offer
    await queryRunner.addColumn(
      'offer_letters',
      new TableColumn({
        name: 'decision_made_at',
        type: 'timestamp',
        isNullable: true,
        comment: 'Timestamp when tenant accepted or rejected the offer',
      }),
    );

    // Add decision_made_ip - tracks IP address when decision is made
    await queryRunner.addColumn(
      'offer_letters',
      new TableColumn({
        name: 'decision_made_ip',
        type: 'varchar',
        length: '45',
        isNullable: true,
        comment:
          'IP address when decision was made (accept/reject) (supports IPv6)',
      }),
    );

    console.log(
      '✅ Added tracking fields to offer_letters table: form_opened_at, form_opened_ip, decision_made_at, decision_made_ip',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove tracking fields in reverse order
    await queryRunner.dropColumn('offer_letters', 'decision_made_ip');
    await queryRunner.dropColumn('offer_letters', 'decision_made_at');
    await queryRunner.dropColumn('offer_letters', 'form_opened_ip');
    await queryRunner.dropColumn('offer_letters', 'form_opened_at');

    console.log('✅ Removed tracking fields from offer_letters table');
  }
}

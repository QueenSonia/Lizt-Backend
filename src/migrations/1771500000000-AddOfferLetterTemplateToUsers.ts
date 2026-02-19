import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOfferLetterTemplateToUsers1771500000000
  implements MigrationInterface
{
  name = 'AddOfferLetterTemplateToUsers1771500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" 
      ADD COLUMN IF NOT EXISTS "offer_letter_template" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" 
      DROP COLUMN IF EXISTS "offer_letter_template"
    `);
  }
}

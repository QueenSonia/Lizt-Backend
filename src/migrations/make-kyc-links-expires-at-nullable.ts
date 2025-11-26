import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeKycLinksExpiresAtNullable1732630000000
  implements MigrationInterface
{
  name = 'MakeKycLinksExpiresAtNullable1732630000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Make expires_at column nullable in kyc_links table
    await queryRunner.query(`
      ALTER TABLE "kyc_links" 
      ALTER COLUMN "expires_at" DROP NOT NULL
    `);

    // Set existing expires_at values to NULL to remove expiration
    await queryRunner.query(`
      UPDATE "kyc_links" 
      SET "expires_at" = NULL 
      WHERE "is_active" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Set a default expiration date for existing records (7 days from now)
    await queryRunner.query(`
      UPDATE "kyc_links" 
      SET "expires_at" = NOW() + INTERVAL '7 days' 
      WHERE "expires_at" IS NULL
    `);

    // Make expires_at column NOT NULL again
    await queryRunner.query(`
      ALTER TABLE "kyc_links" 
      ALTER COLUMN "expires_at" SET NOT NULL
    `);
  }
}

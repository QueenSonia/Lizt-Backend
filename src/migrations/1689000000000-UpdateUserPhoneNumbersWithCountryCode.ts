import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateUserPhoneNumbersWithCountryCode1689000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update phone numbers that start with '0' and are 11 digits long
    await queryRunner.query(`
            UPDATE users
            SET phone_number = '+234' || SUBSTRING(phone_number FROM 2)
            WHERE phone_number ~ '^0\\d{10}$';
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Optionally revert phone numbers that start with '+234' and are 14 characters long
    await queryRunner.query(`
            UPDATE users
            SET phone_number = '0' || SUBSTRING(phone_number FROM 5)
            WHERE phone_number ~ '^\\+234\\d{10}$';
        `);
  }
}

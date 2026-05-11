import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChannelToPasswordResetToken1792000000000
  implements MigrationInterface
{
  name = 'AddChannelToPasswordResetToken1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "password_reset_token" ADD COLUMN IF NOT EXISTS "channel" VARCHAR(16) NOT NULL DEFAULT 'email'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "password_reset_token" DROP COLUMN IF EXISTS "channel"`,
    );
  }
}

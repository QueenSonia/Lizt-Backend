import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Relax the Nigerian-only phone constraints so non-Nigerian (E.164) numbers can
 * be stored app-wide, and widen the renewal-invoice OTP phone audit columns.
 *
 * - users.phone_number / artisans.phone: CHECK `^234[0-9]{10}$` -> `^[1-9][0-9]{6,14}$`
 *   (general E.164 digits: a leading non-zero country code, 7–15 digits total).
 *   Every existing row already satisfies the broader pattern — verified against
 *   the live DB at authoring time: users 0 violations, artisans 0 violations —
 *   so this cannot fail on current data.
 * - renewal_invoices.accepted_by_phone / declined_by_phone: VARCHAR(16) -> VARCHAR(20),
 *   so a 15-digit foreign E.164 number has headroom (16 left only 1 char).
 *
 * down() intentionally does NOT restore the original `^234[0-9]{10}$` lock: once a
 * non-Nigerian number has been written, re-adding the NG-only CHECK would fail.
 * Dropping the relaxed CHECK is the safe inverse.
 */
export class RelaxPhoneConstraintsForInternational1920000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // users.phone_number — relax to general E.164
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP CONSTRAINT IF EXISTS "users_phone_number_canonical"
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "users_phone_number_canonical"
        CHECK (phone_number ~ '^[1-9][0-9]{6,14}$')
    `);

    // artisans.phone — mirror the same relaxation
    await queryRunner.query(`
      ALTER TABLE "artisans"
        DROP CONSTRAINT IF EXISTS "artisans_phone_canonical"
    `);
    await queryRunner.query(`
      ALTER TABLE "artisans"
        ADD CONSTRAINT "artisans_phone_canonical"
        CHECK (phone ~ '^[1-9][0-9]{6,14}$')
    `);

    // renewal_invoices OTP-acceptance audit columns — widen for foreign E.164
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
        ALTER COLUMN "accepted_by_phone" TYPE varchar(20)
    `);
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
        ALTER COLUMN "declined_by_phone" TYPE varchar(20)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Safe inverse: drop the relaxed CHECKs. We deliberately do NOT re-add the
    // NG-only `^234[0-9]{10}$` constraint — any foreign row written while this
    // migration was applied would make that re-add fail.
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP CONSTRAINT IF EXISTS "users_phone_number_canonical"
    `);
    await queryRunner.query(`
      ALTER TABLE "artisans"
        DROP CONSTRAINT IF EXISTS "artisans_phone_canonical"
    `);
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
        ALTER COLUMN "accepted_by_phone" TYPE varchar(16)
    `);
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
        ALTER COLUMN "declined_by_phone" TYPE varchar(16)
    `);
  }
}

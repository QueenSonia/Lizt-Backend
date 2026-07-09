import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill the deprecated scalar `accounts.role` from `roles[0]` wherever it is
 * NULL but `roles[]` is populated.
 *
 * `roles[]` is the source of truth (see account.entity.ts / accountHasRole), and
 * most rows created since the 1778 roles-array migration set only `roles[]`,
 * leaving the legacy scalar NULL (e.g. the Property-Kraft admin seeded by 1917,
 * and 13 other prod rows). Any lingering legacy read of `account.role` would
 * miss those rows. This aligns the scalar with `roles[0]` so those reads behave;
 * it does not change `roles[]` and is safe to run repeatedly.
 *
 * Idempotent: only touches rows where the scalar is still NULL.
 */
export class BackfillNullAccountRoleScalar1926000000000
  implements MigrationInterface
{
  name = 'BackfillNullAccountRoleScalar1926000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE accounts
          SET role = roles[1]
        WHERE role IS NULL
          AND cardinality(roles) > 0`,
    );
  }

  public async down(): Promise<void> {
    // No-op: the pre-backfill NULLs can't be distinguished from rows that were
    // always NULL, and the scalar is deprecated. Nothing to reverse.
  }
}

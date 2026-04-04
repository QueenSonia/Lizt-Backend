import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateNullPropertyIdInTenantBalanceLedger1774500000000
  implements MigrationInterface
{
  name = 'UpdateNullPropertyIdInTenantBalanceLedger1774500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log(
      '🔧 Updating NULL property_id entries in tenant_balance_ledger...',
    );

    // Update migration entries with NULL property_id to use the correct property from tenant's rent records
    await queryRunner.query(`
      UPDATE tenant_balance_ledger
      SET property_id = (
        SELECT DISTINCT r.property_id
        FROM rent r
        WHERE r.tenant_id = tenant_balance_ledger.tenant_id
        LIMIT 1
      )
      WHERE property_id IS NULL
        AND type = 'migration'
        AND EXISTS (
          SELECT 1 FROM rent r
          WHERE r.tenant_id = tenant_balance_ledger.tenant_id
        );
    `);

    // Log the number of updated records
    const result = await queryRunner.query(`
      SELECT COUNT(*) as updated_count
      FROM tenant_balance_ledger
      WHERE type = 'migration'
        AND property_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM rent r
          WHERE r.tenant_id = tenant_balance_ledger.tenant_id
        );
    `);

    console.log(
      `✅ Updated ${result[0]?.updated_count || 0} migration entries with correct property_id`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    console.log(
      '⚠️  Rolling back property_id updates for migration entries...',
    );

    // Rollback: Set property_id back to NULL for migration entries
    // This is a simple rollback - in practice, you might want to be more selective
    await queryRunner.query(`
      UPDATE tenant_balance_ledger
      SET property_id = NULL
      WHERE type = 'migration';
    `);

    console.log(
      '✅ Rollback completed - migration entries property_id set to NULL',
    );
  }
}

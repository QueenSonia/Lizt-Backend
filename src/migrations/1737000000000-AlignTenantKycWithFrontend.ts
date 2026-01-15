import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AlignTenantKycWithFrontend1737000000000
  implements MigrationInterface
{
  name = 'AlignTenantKycWithFrontend1737000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add missing columns first
    await queryRunner.addColumn(
      'tenant_kyc',
      new TableColumn({
        name: 'estimated_monthly_income',
        type: 'varchar',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'tenant_kyc',
      new TableColumn({
        name: 'contact_address',
        type: 'varchar',
        isNullable: true,
      }),
    );

    // 2. Rename columns to match frontend expectations
    await queryRunner.renameColumn(
      'tenant_kyc',
      'employer_address',
      'work_address',
    );
    await queryRunner.renameColumn(
      'tenant_kyc',
      'employer_phone_number',
      'work_phone_number',
    );
    await queryRunner.renameColumn(
      'tenant_kyc',
      'reference1_name',
      'next_of_kin_full_name',
    );
    await queryRunner.renameColumn(
      'tenant_kyc',
      'reference1_address',
      'next_of_kin_address',
    );
    await queryRunner.renameColumn(
      'tenant_kyc',
      'reference1_relationship',
      'next_of_kin_relationship',
    );
    await queryRunner.renameColumn(
      'tenant_kyc',
      'reference1_phone_number',
      'next_of_kin_phone_number',
    );
    await queryRunner.renameColumn(
      'tenant_kyc',
      'reference2_name',
      'referral_agent_full_name',
    );
    await queryRunner.renameColumn(
      'tenant_kyc',
      'reference2_phone_number',
      'referral_agent_phone_number',
    );

    // 3. Drop unused reference2 columns that don't have frontend equivalents
    await queryRunner.dropColumn('tenant_kyc', 'reference2_address');
    await queryRunner.dropColumn('tenant_kyc', 'reference2_relationship');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse all changes for rollback

    // 1. Re-add dropped columns
    await queryRunner.addColumn(
      'tenant_kyc',
      new TableColumn({
        name: 'reference2_address',
        type: 'varchar',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'tenant_kyc',
      new TableColumn({
        name: 'reference2_relationship',
        type: 'varchar',
        isNullable: true,
      }),
    );

    // 2. Rename columns back to original names
    await queryRunner.renameColumn(
      'tenant_kyc',
      'work_address',
      'employer_address',
    );
    await queryRunner.renameColumn(
      'tenant_kyc',
      'work_phone_number',
      'employer_phone_number',
    );
    await queryRunner.renameColumn(
      'tenant_kyc',
      'next_of_kin_full_name',
      'reference1_name',
    );
    await queryRunner.renameColumn(
      'tenant_kyc',
      'next_of_kin_address',
      'reference1_address',
    );
    await queryRunner.renameColumn(
      'tenant_kyc',
      'next_of_kin_relationship',
      'reference1_relationship',
    );
    await queryRunner.renameColumn(
      'tenant_kyc',
      'next_of_kin_phone_number',
      'reference1_phone_number',
    );
    await queryRunner.renameColumn(
      'tenant_kyc',
      'referral_agent_full_name',
      'reference2_name',
    );
    await queryRunner.renameColumn(
      'tenant_kyc',
      'referral_agent_phone_number',
      'reference2_phone_number',
    );

    // 3. Drop added columns
    await queryRunner.dropColumn('tenant_kyc', 'estimated_monthly_income');
    await queryRunner.dropColumn('tenant_kyc', 'contact_address');
  }
}

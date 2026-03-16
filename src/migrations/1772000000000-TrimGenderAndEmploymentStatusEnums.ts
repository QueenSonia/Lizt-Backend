import { MigrationInterface, QueryRunner } from 'typeorm';

export class TrimGenderAndEmploymentStatusEnums1772000000000
  implements MigrationInterface
{
  name = 'TrimGenderAndEmploymentStatusEnums1772000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Gender: keep only 'male', 'female' ──

    // Update any rows with removed values before changing the type
    await queryRunner.query(
      `UPDATE tenant_kyc SET gender = 'male' WHERE gender = 'other'`,
    );
    await queryRunner.query(
      `UPDATE kyc_applications SET gender = 'male' WHERE gender = 'other'`,
    );

    // tenant_kyc.gender
    await queryRunner.query(
      `CREATE TYPE tenant_kyc_gender_enum_new AS ENUM ('male', 'female')`,
    );
    await queryRunner.query(
      `ALTER TABLE tenant_kyc ALTER COLUMN gender TYPE tenant_kyc_gender_enum_new USING gender::text::tenant_kyc_gender_enum_new`,
    );
    await queryRunner.query(`DROP TYPE tenant_kyc_gender_enum`);
    await queryRunner.query(
      `ALTER TYPE tenant_kyc_gender_enum_new RENAME TO tenant_kyc_gender_enum`,
    );

    // kyc_applications.gender
    await queryRunner.query(
      `CREATE TYPE kyc_applications_gender_enum_new AS ENUM ('male', 'female')`,
    );
    await queryRunner.query(
      `ALTER TABLE kyc_applications ALTER COLUMN gender TYPE kyc_applications_gender_enum_new USING gender::text::kyc_applications_gender_enum_new`,
    );
    await queryRunner.query(`DROP TYPE kyc_applications_gender_enum`);
    await queryRunner.query(
      `ALTER TYPE kyc_applications_gender_enum_new RENAME TO kyc_applications_gender_enum`,
    );

    // ── EmploymentStatus: keep only 'employed', 'self-employed' ──

    // Update any rows with removed values before changing the type
    await queryRunner.query(
      `UPDATE tenant_kyc SET employment_status = 'employed' WHERE employment_status IN ('unemployed', 'student')`,
    );
    await queryRunner.query(
      `UPDATE kyc_applications SET employment_status = 'employed' WHERE employment_status IN ('unemployed', 'student')`,
    );

    // tenant_kyc.employment_status
    await queryRunner.query(
      `CREATE TYPE tenant_kyc_employment_status_enum_new AS ENUM ('employed', 'self-employed')`,
    );
    await queryRunner.query(
      `ALTER TABLE tenant_kyc ALTER COLUMN employment_status TYPE tenant_kyc_employment_status_enum_new USING employment_status::text::tenant_kyc_employment_status_enum_new`,
    );
    await queryRunner.query(`DROP TYPE tenant_kyc_employment_status_enum`);
    await queryRunner.query(
      `ALTER TYPE tenant_kyc_employment_status_enum_new RENAME TO tenant_kyc_employment_status_enum`,
    );

    // kyc_applications.employment_status
    await queryRunner.query(
      `CREATE TYPE kyc_applications_employment_status_enum_new AS ENUM ('employed', 'self-employed')`,
    );
    await queryRunner.query(
      `ALTER TABLE kyc_applications ALTER COLUMN employment_status TYPE kyc_applications_employment_status_enum_new USING employment_status::text::kyc_applications_employment_status_enum_new`,
    );
    await queryRunner.query(
      `DROP TYPE kyc_applications_employment_status_enum`,
    );
    await queryRunner.query(
      `ALTER TYPE kyc_applications_employment_status_enum_new RENAME TO kyc_applications_employment_status_enum`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── Restore Gender: add back 'other' ──

    // tenant_kyc.gender
    await queryRunner.query(
      `CREATE TYPE tenant_kyc_gender_enum_old AS ENUM ('male', 'female', 'other')`,
    );
    await queryRunner.query(
      `ALTER TABLE tenant_kyc ALTER COLUMN gender TYPE tenant_kyc_gender_enum_old USING gender::text::tenant_kyc_gender_enum_old`,
    );
    await queryRunner.query(`DROP TYPE tenant_kyc_gender_enum`);
    await queryRunner.query(
      `ALTER TYPE tenant_kyc_gender_enum_old RENAME TO tenant_kyc_gender_enum`,
    );

    // kyc_applications.gender
    await queryRunner.query(
      `CREATE TYPE kyc_applications_gender_enum_old AS ENUM ('male', 'female', 'other')`,
    );
    await queryRunner.query(
      `ALTER TABLE kyc_applications ALTER COLUMN gender TYPE kyc_applications_gender_enum_old USING gender::text::kyc_applications_gender_enum_old`,
    );
    await queryRunner.query(`DROP TYPE kyc_applications_gender_enum`);
    await queryRunner.query(
      `ALTER TYPE kyc_applications_gender_enum_old RENAME TO kyc_applications_gender_enum`,
    );

    // ── Restore EmploymentStatus: add back 'unemployed', 'student' ──

    // tenant_kyc.employment_status
    await queryRunner.query(
      `CREATE TYPE tenant_kyc_employment_status_enum_old AS ENUM ('employed', 'self-employed', 'unemployed', 'student')`,
    );
    await queryRunner.query(
      `ALTER TABLE tenant_kyc ALTER COLUMN employment_status TYPE tenant_kyc_employment_status_enum_old USING employment_status::text::tenant_kyc_employment_status_enum_old`,
    );
    await queryRunner.query(`DROP TYPE tenant_kyc_employment_status_enum`);
    await queryRunner.query(
      `ALTER TYPE tenant_kyc_employment_status_enum_old RENAME TO tenant_kyc_employment_status_enum`,
    );

    // kyc_applications.employment_status
    await queryRunner.query(
      `CREATE TYPE kyc_applications_employment_status_enum_old AS ENUM ('employed', 'self-employed', 'unemployed', 'student')`,
    );
    await queryRunner.query(
      `ALTER TABLE kyc_applications ALTER COLUMN employment_status TYPE kyc_applications_employment_status_enum_old USING employment_status::text::kyc_applications_employment_status_enum_old`,
    );
    await queryRunner.query(
      `DROP TYPE kyc_applications_employment_status_enum`,
    );
    await queryRunner.query(
      `ALTER TYPE kyc_applications_employment_status_enum_old RENAME TO kyc_applications_employment_status_enum`,
    );
  }
}

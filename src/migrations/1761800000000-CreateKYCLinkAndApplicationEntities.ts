import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKYCLinkAndApplicationEntities1761800000000
  implements MigrationInterface
{
  name = 'CreateKYCLinkAndApplicationEntities1761800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum types for KYC applications
    await queryRunner.query(
      `CREATE TYPE "kyc_applications_status_enum" AS ENUM('pending', 'approved', 'rejected')`,
    );

    // Create kyc_links table
    await queryRunner.query(`
      CREATE TABLE "kyc_links" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "token" uuid NOT NULL,
        "property_id" uuid NOT NULL,
        "landlord_id" uuid NOT NULL,
        "expires_at" TIMESTAMP NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "UQ_kyc_links_token" UNIQUE ("token"),
        CONSTRAINT "PK_kyc_links" PRIMARY KEY ("id")
      )
    `);

    // Create kyc_applications table
    await queryRunner.query(`
      CREATE TABLE "kyc_applications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "kyc_link_id" uuid NOT NULL,
        "property_id" uuid NOT NULL,
        "status" "kyc_applications_status_enum" NOT NULL DEFAULT 'pending',
        "tenant_id" uuid,
        "first_name" character varying NOT NULL,
        "last_name" character varying NOT NULL,
        "email" character varying NOT NULL,
        "phone_number" character varying NOT NULL,
        "date_of_birth" date NOT NULL,
        "gender" "tenant_kyc_gender_enum" NOT NULL,
        "nationality" character varying NOT NULL,
        "state_of_origin" character varying NOT NULL,
        "local_government_area" character varying NOT NULL,
        "marital_status" "tenant_kyc_maritalstatus_enum" NOT NULL,
        "employment_status" "tenant_kyc_employmentstatus_enum" NOT NULL,
        "occupation" character varying NOT NULL,
        "job_title" character varying NOT NULL,
        "employer_name" character varying,
        "employer_address" character varying,
        "monthly_net_income" character varying NOT NULL,
        "reference1_name" character varying NOT NULL,
        "reference1_address" character varying NOT NULL,
        "reference1_relationship" character varying NOT NULL,
        "reference1_phone_number" character varying NOT NULL,
        "reference2_name" character varying,
        "reference2_address" character varying,
        "reference2_relationship" character varying,
        "reference2_phone_number" character varying,
        CONSTRAINT "PK_kyc_applications" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key constraints for kyc_links
    await queryRunner.query(`
      ALTER TABLE "kyc_links" 
      ADD CONSTRAINT "FK_kyc_links_property_id" 
      FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "kyc_links" 
      ADD CONSTRAINT "FK_kyc_links_landlord_id" 
      FOREIGN KEY ("landlord_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // Add foreign key constraints for kyc_applications
    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      ADD CONSTRAINT "FK_kyc_applications_kyc_link_id" 
      FOREIGN KEY ("kyc_link_id") REFERENCES "kyc_links"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      ADD CONSTRAINT "FK_kyc_applications_property_id" 
      FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      ADD CONSTRAINT "FK_kyc_applications_tenant_id" 
      FOREIGN KEY ("tenant_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign key constraints
    await queryRunner.query(
      `ALTER TABLE "kyc_applications" DROP CONSTRAINT "FK_kyc_applications_tenant_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_applications" DROP CONSTRAINT "FK_kyc_applications_property_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_applications" DROP CONSTRAINT "FK_kyc_applications_kyc_link_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_links" DROP CONSTRAINT "FK_kyc_links_landlord_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_links" DROP CONSTRAINT "FK_kyc_links_property_id"`,
    );

    // Drop tables
    await queryRunner.query(`DROP TABLE "kyc_applications"`);
    await queryRunner.query(`DROP TABLE "kyc_links"`);

    // Drop enum types
    await queryRunner.query(`DROP TYPE "kyc_applications_status_enum"`);
  }
}

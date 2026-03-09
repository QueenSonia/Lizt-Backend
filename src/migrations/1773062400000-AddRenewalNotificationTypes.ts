import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRenewalNotificationTypes1773062400000
  implements MigrationInterface
{
  name = 'AddRenewalNotificationTypes1773062400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add renewal notification types to the enum
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" RENAME TO "notification_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notification_type_enum" AS ENUM('Service Request', 'Notice Agreement', 'Rent Created', 'User Added to Property', 'User Signed Up', 'Lease Signed', 'Property Created', 'KYC Submitted', 'Tenant Attached', 'Tenancy Ended', 'Tenancy Renewed', 'Renewal Link Sent', 'Renewal Payment Received', 'Offer Letter Generated', 'Offer Letter Sent', 'Offer Letter Accepted', 'Offer Letter Rejected', 'Payment Received', 'Invoice Generated', 'Invoice Sent', 'Invoice Viewed', 'Receipt Issued', 'Receipt Sent', 'Receipt Viewed', 'Rent reminder')`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" ALTER COLUMN "type" TYPE "public"."notification_type_enum" USING "type"::"text"::"public"."notification_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."notification_type_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" RENAME TO "notification_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notification_type_enum" AS ENUM('Service Request', 'Notice Agreement', 'Rent Created', 'User Added to Property', 'User Signed Up', 'Lease Signed', 'Property Created', 'KYC Submitted', 'Tenant Attached', 'Tenancy Ended', 'Offer Letter Generated', 'Offer Letter Sent', 'Offer Letter Accepted', 'Offer Letter Rejected', 'Payment Received', 'Invoice Generated', 'Invoice Sent', 'Invoice Viewed', 'Receipt Issued', 'Receipt Sent', 'Receipt Viewed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" ALTER COLUMN "type" TYPE "public"."notification_type_enum_old" USING "type"::"text"::"public"."notification_type_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."notification_type_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum_old" RENAME TO "notification_type_enum"`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentReceivedNotificationType1770600000000
  implements MigrationInterface
{
  name = 'AddPaymentReceivedNotificationType1770600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add 'Payment Received' to the notification_type_enum
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" RENAME TO "notification_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notification_type_enum" AS ENUM('Service Request', 'Notice Agreement', 'Rent Created', 'User Added to Property', 'User Signed Up', 'Lease Signed', 'Property Created', 'KYC Submitted', 'Tenant Attached', 'Tenancy Ended', 'Offer Letter Sent', 'Offer Letter Accepted', 'Offer Letter Rejected', 'Payment Received')`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" ALTER COLUMN "type" TYPE "public"."notification_type_enum" USING "type"::"text"::"public"."notification_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."notification_type_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."notification_type_enum_old" AS ENUM('Service Request', 'Notice Agreement', 'Rent Created', 'User Added to Property', 'User Signed Up', 'Lease Signed', 'Property Created', 'KYC Submitted', 'Tenant Attached', 'Tenancy Ended', 'Offer Letter Sent', 'Offer Letter Accepted', 'Offer Letter Rejected')`,
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

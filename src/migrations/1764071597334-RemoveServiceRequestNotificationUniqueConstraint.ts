import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveServiceRequestNotificationUniqueConstraint1764071597334
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the unique constraint on service_request_id
    await queryRunner.query(
      `ALTER TABLE "notification" DROP CONSTRAINT "REL_ce20f459c3930028d89627ce7b"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the unique constraint if rolling back
    await queryRunner.query(
      `ALTER TABLE "notification" ADD CONSTRAINT "REL_ce20f459c3930028d89627ce7b" UNIQUE ("service_request_id")`,
    );
  }
}

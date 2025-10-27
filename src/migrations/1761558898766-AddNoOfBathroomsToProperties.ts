import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNoOfBathroomsToProperties1761558898766
  implements MigrationInterface
{
  name = 'AddNoOfBathroomsToProperties1761558898766';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "properties" ADD "no_of_bathrooms" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "properties" DROP COLUMN "no_of_bathrooms"`,
    );
  }
}

import { Column, Entity } from "typeorm";
import { BaseEntity } from 'src/base.entity';

@Entity()
export class Waitlist extends BaseEntity {
     @Column({ nullable: false, type: 'varchar' })
      full_name: string;

      @Column({ nullable: false, type: 'varchar' })
      phone_number: string;

      @Column({ nullable: false, type: 'varchar' })
      option: string;

      @Column({ nullable: true, type: 'varchar' })
      referral_name: string;

      @Column({ nullable: true, type: 'varchar' })
      referral_phone_number: string;
}
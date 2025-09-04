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
}
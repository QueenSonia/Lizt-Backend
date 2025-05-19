import { BaseEntity } from 'src/base.entity';
import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { Users } from './user.entity';
import { Account } from './account.entity';

@Entity()
export class KYC extends BaseEntity {
  @Column({ nullable: true, type: 'varchar' })
  former_house_address: string;

  @Column({ nullable: true, type: 'varchar' })
  reason_for_leaving: string;

  @Column({ nullable: true, type: 'varchar' })
  former_accomodation_type: string;

  @Column({ nullable: false, type: 'varchar' })
  occupation: string;

  @Column({ nullable: false, type: 'varchar' })
  employers_name: string;

  @Column({ nullable: false, type: 'varchar' })
  employers_address: string;

  @Column({ nullable: false, type: 'varchar' })
  state_of_origin: string;

  @Column({ nullable: true, type: 'varchar' })
  lga_of_origin: string;

  @Column({ nullable: true, type: 'varchar' })
  home_town: string;

  @Column({ nullable: false, type: 'varchar' })
  nationality: string;

  @Column({ nullable: false, type: 'varchar' })
  religion: string;

  @Column({ nullable: false, type: 'varchar' })
  marital_status: string;

  @Column({ nullable: true, type: 'varchar' })
  name_of_spouse: string;

  @Column({ nullable: true, type: 'varchar' })
  next_of_kin: string;

  @Column({ nullable: true, type: 'varchar' })
  next_of_kin_address: string;

  @Column({ nullable: true, type: 'varchar' })
  guarantor: string;

  @Column({ nullable: true, type: 'varchar' })
  guarantor_address: string;

  @Column({ nullable: true, type: 'varchar' })
  guarantor_occupation: string;

  @Column({ nullable: true, type: 'varchar' })
  guarantor_phone_number: string;

  @Column({ nullable: false, type: 'varchar' })
  monthly_income: string;

  @Column({ nullable: false, type: 'varchar', default: false })
  accept_terms_and_condition: boolean;

  @OneToOne(() => Account, (user) => user.kyc, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: Account;
}

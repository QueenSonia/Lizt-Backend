import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('kyc_otp')
export class KYCOtp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  phone_number: string;

  @Column()
  otp_code: string;

  @Column()
  kyc_token: string;

  @Column({ default: false })
  is_verified: boolean;

  @Column({ default: true })
  is_active: boolean;

  @Column()
  expires_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

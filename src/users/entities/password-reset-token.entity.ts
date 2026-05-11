import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity()
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @Column()
  token: string;

  @Column({ nullable: true })
  otp: string;

  // 'email' or 'whatsapp' — records which channel the OTP was delivered on,
  // so resendOtp can re-send via the same channel without re-deriving from the
  // identifier (which we don't keep on the row).
  @Column({ type: 'varchar', length: 16, default: 'email' })
  channel: 'email' | 'whatsapp';

  @CreateDateColumn()
  created_at: Date;

  @Column({ type: 'timestamp', nullable: false })
  expires_at: Date;
}

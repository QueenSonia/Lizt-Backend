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

  @CreateDateColumn()
  created_at: Date;

  @Column({ type: 'timestamp', nullable: false })
  expires_at: Date;
}

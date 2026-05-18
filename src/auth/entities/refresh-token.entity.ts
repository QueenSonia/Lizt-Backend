import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { RolesEnum } from 'src/base.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  account_id: string;

  @Column({ type: 'text' })
  token: string;

  @Column({ type: 'timestamp' })
  expires_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @Column({ type: 'boolean', default: false })
  is_revoked: boolean;

  @Column({ type: 'varchar', nullable: true })
  user_agent: string;

  @Column({ type: 'varchar', nullable: true })
  ip_address: string;

  // The role the user picked at sign-in. Read at refresh time so the new
  // access token keeps the picked role instead of regressing to roles[0].
  // Nullable to tolerate rows issued before the migration backfilled.
  @Column({ type: 'enum', enum: RolesEnum, nullable: true })
  active_role: RolesEnum | null;
}

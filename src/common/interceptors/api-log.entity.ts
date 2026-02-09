import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('api_logs')
@Index(['endpoint', 'created_at'])
@Index(['duration_ms', 'created_at'])
export class ApiLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  method: string;

  @Column()
  endpoint: string;

  @Column()
  status_code: number;

  @Column()
  duration_ms: number;

  @Column({ nullable: true })
  ip: string;

  @Column({ nullable: true })
  user_agent: string;

  @Column({ nullable: true })
  user_id: string;

  @Column({ nullable: true })
  error_message: string;

  @CreateDateColumn()
  created_at: Date;
}

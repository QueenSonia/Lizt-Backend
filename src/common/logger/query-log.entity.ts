import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum QueryType {
  SELECT = 'SELECT',
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  OTHER = 'OTHER',
}

@Entity('query_logs')
@Index(['query_type', 'created_at'])
@Index(['duration_ms', 'created_at'])
@Index(['table_name', 'created_at'])
export class QueryLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: QueryType })
  query_type: QueryType;

  @Column({ type: 'text' })
  query: string;

  @Column({ nullable: true })
  table_name: string;

  @Column()
  duration_ms: number;

  @Column({ nullable: true, type: 'text' })
  parameters: string;

  @Column({ default: false })
  is_slow: boolean;

  @CreateDateColumn()
  created_at: Date;
}

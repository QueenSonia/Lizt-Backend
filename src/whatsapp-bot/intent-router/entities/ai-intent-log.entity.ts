import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type AiIntentAction =
  | 'auto_executed'
  | 'confirmation_sent'
  | 'notice_created'
  | 'menu_fallback'
  | 'low_confidence'
  | 'error';

@Entity('ai_intent_log')
@Index(['tenant_id', 'created_at'])
@Index(['parsed_intent', 'parsed_sub_intent'])
export class AiIntentLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  tenant_id: string | null;

  @Column({ type: 'varchar', length: 32, nullable: false })
  phone_number: string;

  @Column({ type: 'text', nullable: false })
  inbound_text: string;

  @Column({ type: 'text', nullable: true })
  prior_bot_message: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  prior_bot_message_type: string | null;

  @Column({ type: 'jsonb', nullable: true })
  raw_llm_response: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  parsed_intent: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  parsed_sub_intent: string | null;

  @Column({ type: 'decimal', precision: 4, scale: 3, nullable: true })
  confidence: number | null;

  @Column({ type: 'varchar', length: 32, nullable: false })
  action_taken: AiIntentAction;

  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  @Column({ type: 'int', nullable: true })
  latency_ms: number | null;

  @CreateDateColumn()
  created_at: Date;
}

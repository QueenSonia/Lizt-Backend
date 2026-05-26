import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../base.entity';

export enum TenantNoticeStatus {
  NEW = 'NEW',
  SEEN = 'SEEN',
  HANDLED = 'HANDLED',
}

@Entity('tenant_notices')
@Index(['landlord_id', 'status', 'created_at'])
@Index(['tenant_id', 'created_at'])
export class TenantNotice extends BaseEntity {
  @Column({ type: 'uuid', nullable: false })
  tenant_id: string;

  @Column({ type: 'uuid', nullable: false })
  landlord_id: string;

  @Column({ type: 'uuid', nullable: true })
  fm_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  property_id: string | null;

  @Column({ type: 'text', nullable: false })
  original_message: string;

  @Column({ type: 'jsonb', nullable: true })
  ai_extraction: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, nullable: false })
  sub_intent: string;

  @Column({
    type: 'varchar',
    length: 16,
    nullable: false,
    default: TenantNoticeStatus.NEW,
  })
  status: TenantNoticeStatus;
}

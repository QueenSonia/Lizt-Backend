import { Entity, Column } from 'typeorm';
import { BaseEntity } from 'src/base.entity';
import { MoveOutReasonEnum } from 'src/property-history/entities/property-history.entity';

@Entity({ name: 'scheduled_move_outs' })
export class ScheduledMoveOut extends BaseEntity {
  @Column({ nullable: false, type: 'uuid' })
  property_id: string;

  @Column({ nullable: false, type: 'uuid' })
  tenant_id: string;

  @Column({ nullable: false, type: 'date' })
  effective_date: Date;

  @Column({
    nullable: true,
    type: 'enum',
    enum: MoveOutReasonEnum,
  })
  move_out_reason?: string | null;

  @Column({ nullable: true, type: 'text' })
  owner_comment?: string | null;

  @Column({ nullable: true, type: 'text' })
  tenant_comment?: string | null;

  @Column({ nullable: false, type: 'boolean', default: false })
  processed: boolean;

  @Column({ nullable: true, type: 'timestamp' })
  processed_at?: Date | null;
}

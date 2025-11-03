// src/tenancy-history/entities/tenancy-history.entity.ts
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Users } from '../../users/entities/user.entity';
import { Property } from '../../properties/entities/property.entity';
import { Account } from 'src/users/entities/account.entity';

export enum MoveOutReasonEnum {
  LEASE_ENDED = 'lease_ended',
  EVICTION = 'eviction',
  EARLY_TERMINATION = 'early_termination',
  MUTUAL_AGREEMENT = 'mutual_agreement',
  OTHER = 'other',
}

@Entity({ name: 'property_histories' })
export class PropertyHistory extends BaseEntity {
  @Column({ nullable: false, type: 'uuid' })
  property_id: string;

  @Column({ nullable: false, type: 'uuid' })
  tenant_id: string;

  @Column({ nullable: false, type: 'timestamp' })
  move_in_date: Date;

  @Column({ nullable: true, type: 'timestamp' })
  move_out_date?: Date | null;

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

  @Column({ type: 'int', nullable: false })
  monthly_rent: number;

  @ManyToOne(() => Property, (p) => p.property_histories, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'property_id', referencedColumnName: 'id' })
  property: Property;

  @ManyToOne(() => Account, (u) => u.property_histories)
  @JoinColumn({ name: 'tenant_id', referencedColumnName: 'id' })
  tenant: Account;
}

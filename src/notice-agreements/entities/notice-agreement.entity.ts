import { BaseEntity } from 'src/base.entity';
import { Property } from 'src/properties/entities/property.entity';
import { Users } from 'src/users/entities/user.entity';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';

export enum NoticeStatus {
  ACKNOWLEDGED = 'acknowledged',
  NOT_ACKNOWLEDGED = 'not_acknowledged',
  PENDING = 'pending',
}

export enum SendVia {
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
}

export enum NoticeType {
  RENT_INCREASE = 'rent_increase',
  LEASE_RENEWAL = 'lease_renewal',
  EVICTION = 'eviction',
  WARNING = 'warning',
}

@Entity({ name: 'notice_agreement' })
export class NoticeAgreement extends BaseEntity {
  @Column({ type: 'varchar', unique: true })
  notice_id: string;

  @Column({
    type: 'enum',
    enum: NoticeType,
  })
  notice_type: NoticeType;

  @Column({ type: 'varchar' })
  tenant_name: string;

  @Column({ type: 'varchar' })
  property_name: string;

  @Column({ type: 'timestamp' })
  effective_date: Date;

  @Column({ type: 'varchar', nullable: true })
  notice_image?: string | null;

  @Column({
    type: 'enum',
    enum: NoticeStatus,
    default: NoticeStatus.PENDING,
  })
  status: NoticeStatus;

  @Column({
    type: 'enum',
    enum: SendVia,
    array: true, // allows multiple values
    default: [SendVia.EMAIL],
  })
  send_via: SendVia[];

  @Column({ type: 'text', nullable: true })
  additional_notes?: string | null;

  @Column({ type: 'uuid', nullable: true })
  property_id: string;

  @Column({ type: 'uuid', nullable: true })
  tenant_id: string;

  @ManyToOne(() => Property, (p) => p.notice_agreements)
  @JoinColumn({ name: 'property_id', referencedColumnName: 'id' })
  property: Property;

  @ManyToOne(() => Users, (u) => u.notice_agreements)
  @JoinColumn({ name: 'tenant_id', referencedColumnName: 'id' })
  tenant: Users;
}

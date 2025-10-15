import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { PropertyStatusEnum } from '../dto/create-property.dto';
import { Users } from 'src/users/entities/user.entity';
import { Rent } from 'src/rents/entities/rent.entity';
import { PropertyTenant } from './property-tenants.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { RentIncrease } from 'src/rents/entities/rent-increase.entity';
import { NoticeAgreement } from 'src/notice-agreements/entities/notice-agreement.entity';
import { Account } from 'src/users/entities/account.entity';
import { Notification } from 'src/notifications/entities/notification.entity';

@Entity({ name: 'properties' })
export class Property extends BaseEntity {
  @Column({ nullable: false, type: 'varchar' })
  name: string;

  @Column({ nullable: false, type: 'varchar' })
  location: string;

  @Column({ nullable: true, type: 'varchar' })
  description: string;

  @Column({
    nullable: false,
    type: 'enum',
    enum: [PropertyStatusEnum.OCCUPIED, PropertyStatusEnum.VACANT],
    default: PropertyStatusEnum.VACANT,
  })
  property_status: string;

  @Column({ nullable: false, type: 'uuid' })
  owner_id: string;

  @Column({ nullable: false, type: 'varchar' })
  property_type: string;

  @Column({ nullable: true, type: 'varchar', array: true })
  property_images: string[];

  @Column({ nullable: false, type: 'int' })
  no_of_bedrooms: number;

  @Column({ type: 'int', nullable: true })
  rental_price: number;

  @Column({ nullable: true, type: 'varchar' })
  payment_frequency: string;

  @Column({ type: 'int', nullable: true })
  security_deposit: number;

  @Column({ type: 'int', nullable: true })
  service_charge: number;

  @Column({ nullable: true, type: 'text' })
  comment?: string | null;

  @OneToMany(() => PropertyTenant, (t) => t.property)
  property_tenants: PropertyTenant[];

  @ManyToOne(() => Account, (owner) => owner.properties)
  @JoinColumn({ name: 'owner_id', referencedColumnName: 'id' })
  owner: Account;

  @OneToMany(() => Rent, (r) => r.property)
  rents: Rent[];

  @OneToMany(() => ServiceRequest, (sr) => sr.property)
  service_requests: ServiceRequest[];

  @OneToMany(() => PropertyHistory, (ph) => ph.property)
  property_histories: PropertyHistory[];

  @OneToMany(() => RentIncrease, (ri) => ri.property)
  rent_increases: RentIncrease[];

  @OneToMany(() => NoticeAgreement, (na) => na.property)
  notice_agreements: NoticeAgreement[];

  @OneToMany(() => Notification, (no) => no.property)
  notification: Notification[];
}

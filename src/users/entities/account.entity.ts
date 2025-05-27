import { BaseEntity, RolesEnum } from 'src/base.entity';
import {
  Column,
  Entity,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Users } from './user.entity';
import { Property } from 'src/properties/entities/property.entity';
import { Rent } from 'src/rents/entities/rent.entity';
import { KYC } from './kyc.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { NoticeAgreement } from 'src/notice-agreements/entities/notice-agreement.entity';
import { Notification } from 'src/notifications/entities/notification.entity';

@Entity('accounts')
export class Account extends BaseEntity {
  @Column({ nullable: false, type: 'varchar' })
  email: string;

  @Column({ nullable: true, type: 'varchar' })
  password: string;

  @Column({ nullable: false, type: 'boolean', default: false })
  is_verified: boolean;

  @Column({ nullable: true })
  profile_name: string;

  @Column({
    type: 'enum',
    enum: RolesEnum,
  })
  role: RolesEnum;

    @Column({ nullable: true })
  creator_id: string;

   @Column({ nullable: false, type: 'uuid' })
  userId: string;

  // @Column({ nullable: false, type: 'boolean', default: false })
  // is_sub_account: boolean;

  @ManyToOne(() => Users, (user) => user.accounts, { onDelete: 'CASCADE' })
  user: Users;

  // Add role-specific relations here
  @OneToMany(() => Property, (p) => p.owner)
  properties: Property[];

  @OneToMany(() => Rent, (r) => r.tenant)
  rents: Rent[];

  @OneToMany(() => PropertyTenant, (pt) => pt.tenant)
  property_tenants: PropertyTenant[];

  @OneToMany(() => PropertyHistory, (ph) => ph.tenant)
  property_histories: PropertyHistory[];

  @OneToMany(() => ServiceRequest, (sr) => sr.tenant)
  service_requests: ServiceRequest[];

   @OneToMany(() => NoticeAgreement, (na) => na.tenant)
    notice_agreements: NoticeAgreement[];

  @OneToOne(() => KYC, (kyc) => kyc.user)
  kyc: KYC;

  @OneToMany(() => Notification, (notification) => notification.user)
  notification: Notification[];
}

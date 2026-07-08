import { BaseEntity, RolesEnum } from 'src/base.entity';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
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
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import { NoticeAgreement } from 'src/notice-agreements/entities/notice-agreement.entity';
import { Notification } from 'src/notifications/entities/notification.entity';
import { Team } from './team.entity';
import { TeamMember } from './team-member.entity';
import { KYCLink } from 'src/kyc-links/entities/kyc-link.entity';

/**
 * Distinguishes a corporate landlord (whose `profile_name` holds the company
 * name) from an individual (whose display name comes from first+last name).
 * Only meaningful on accounts carrying the `landlord` role.
 */
export enum LandlordType {
  CORPORATE = 'corporate',
  INDIVIDUAL = 'individual',
}

@Entity('accounts')
export class Account extends BaseEntity {
  @Index('IDX_accounts_email_unique', { unique: true })
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
    array: true,
    default: '{}',
  })
  roles: RolesEnum[];

  @Column({ type: 'uuid', nullable: true })
  creator_id: string;

  // Self-relation to the managing admin (Property Kraft) that created this
  // account — maps to the existing `creator_id` column. Read-only convenience
  // for resolving e.g. branding through `account.creator.user`; writes still
  // go through the `creator_id` scalar.
  @ManyToOne(() => Account, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'creator_id' })
  creator?: Account;

  @Column({ type: 'enum', enum: LandlordType, nullable: true })
  landlord_type: LandlordType;

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

  @OneToMany(() => PropertyTenant, (pt) => pt.tenant, {
    onDelete: 'CASCADE',
  })
  property_tenants: PropertyTenant[];

  @OneToMany(() => PropertyHistory, (ph) => ph.tenant)
  property_histories: PropertyHistory[];

  @OneToMany(() => MaintenanceRequest, (sr) => sr.tenant)
  maintenance_requests: MaintenanceRequest[];

  @OneToMany(() => NoticeAgreement, (na) => na.tenant)
  notice_agreements: NoticeAgreement[];

  @OneToOne(() => KYC, (kyc) => kyc.user)
  kyc: KYC;

  @OneToMany(() => Notification, (notification) => notification.user)
  notification: Notification[];

  // One account can be part of many teams through TeamMember
  @OneToMany(() => TeamMember, (teamMember) => teamMember.account)
  teamMemberships: TeamMember[];

  @OneToOne(() => Team, (team) => team.creatorId, { onDelete: 'CASCADE' })
  team: Team;

  @OneToMany(() => KYCLink, (kycLink) => kycLink.landlord)
  kyc_links: KYCLink[];
}

/**
 * Account role check against the multi-role `roles[]` column.
 *
 * The legacy scalar `account.role` was removed; `roles[]` is now the sole
 * source of truth. For SQL filters use `:r = ANY(accounts.roles)` or
 * TypeORM's `ArrayContains`.
 */
export function accountHasRole(
  account: Pick<Account, 'roles'> | null | undefined,
  role: RolesEnum,
): boolean {
  if (!account) return false;
  return account.roles?.includes(role) === true;
}

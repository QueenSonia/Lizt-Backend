import { BaseEntity, RolesEnum } from 'src/base.entity';
import {
  Column,
  Entity,
  Index,
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

  // Kept temporarily for back-compat — mirrors roles[0] on every write.
  // Future cleanup: migrate `account.role` reads to `account.roles.includes(X)` and drop this column.
  @Column({
    type: 'enum',
    enum: RolesEnum,
    nullable: true,
  })
  role: RolesEnum | null;

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
 * Account role check that respects the multi-role `roles[]` column.
 *
 * `account.role` is a single-value mirror of `roles[0]` kept for back-compat,
 * so a multi-role account whose target role isn't first is invisible to
 * `acc.role === X` and to `WHERE accounts.role = X` SQL filters. Always use
 * this helper (or its SQL equivalent: load the account, then filter in JS)
 * instead of comparing `account.role` directly.
 */
export function accountHasRole(
  account: Pick<Account, 'role' | 'roles'> | null | undefined,
  role: RolesEnum,
): boolean {
  if (!account) return false;
  return account.roles?.includes(role) === true || account.role === role;
}

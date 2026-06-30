import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Account } from '../../users/entities/account.entity';
import { KYCApplication } from './kyc-application.entity';

/**
 * Whether a KYC link surfaces a single landlord's vacancies (`landlord`, the
 * legacy/default shape) or all vacancies across an admin's managed landlords
 * (`admin`). Admin-scoped links resolve properties via
 * `resolveManagedLandlordIds(admin_creator_id)`.
 */
export enum KycLinkScope {
  LANDLORD = 'landlord',
  ADMIN = 'admin',
}

@Entity({ name: 'kyc_links' })
export class KYCLink extends BaseEntity {
  @Column({ type: 'uuid', unique: true })
  token: string;

  @Column({ type: 'uuid' })
  landlord_id: string;

  @Column({
    type: 'enum',
    enum: KycLinkScope,
    default: KycLinkScope.LANDLORD,
  })
  scope_type: KycLinkScope;

  // Set when scope_type = 'admin'; the admin account whose managed landlords'
  // vacancies this link aggregates. NULL for legacy per-landlord links.
  @Column({ type: 'uuid', nullable: true })
  admin_creator_id: string;

  @Column({ type: 'timestamp', nullable: true })
  expires_at: Date;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @ManyToOne(() => Account, (account) => account.kyc_links)
  @JoinColumn({ name: 'landlord_id' })
  landlord: Account;

  @OneToMany(() => KYCApplication, (application) => application.kyc_link)
  applications: KYCApplication[];
}

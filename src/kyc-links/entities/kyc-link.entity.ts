import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Property } from '../../properties/entities/property.entity';
import { Account } from '../../users/entities/account.entity';
import { KYCApplication } from './kyc-application.entity';

@Entity({ name: 'kyc_links' })
export class KYCLink extends BaseEntity {
  @Column({ type: 'uuid', unique: true })
  token: string;

  @Column({ type: 'uuid' })
  property_id: string;

  @Column({ type: 'uuid' })
  landlord_id: string;

  @Column({ type: 'timestamp' })
  expires_at: Date;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @ManyToOne(() => Property, (property) => property.kyc_links)
  @JoinColumn({ name: 'property_id' })
  property: Property;

  @ManyToOne(() => Account, (account) => account.kyc_links)
  @JoinColumn({ name: 'landlord_id' })
  landlord: Account;

  @OneToMany(() => KYCApplication, (application) => application.kyc_link)
  applications: KYCApplication[];
}

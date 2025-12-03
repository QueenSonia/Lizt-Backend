import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Account } from '../../users/entities/account.entity';
import { KYCApplication } from './kyc-application.entity';

@Entity({ name: 'kyc_links' })
export class KYCLink extends BaseEntity {
  @Column({ type: 'uuid', unique: true })
  token: string;

  @Column({ type: 'uuid' })
  landlord_id: string;

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

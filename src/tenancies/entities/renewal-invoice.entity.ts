import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { PropertyTenant } from '../../properties/entities/property-tenants.entity';
import { Property } from '../../properties/entities/property.entity';
import { Account } from '../../users/entities/account.entity';
import { Fee } from '../../common/billing/fees';

export enum RenewalPaymentStatus {
  UNPAID = 'unpaid',
  PAID = 'paid',
  PARTIAL = 'partial',
  PENDING_APPROVAL = 'pending_approval',
}

export enum RenewalLetterStatus {
  DRAFT = 'draft',
  SENT = 'sent',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
}

@Entity('renewal_invoices')
@Index(['token'])
@Index(['property_tenant_id'])
@Index(['payment_status'])
@Index(['created_at'])
@Index(['letter_status'])
@Index(['superseded_by_id'])
export class RenewalInvoice extends BaseEntity {
  @Column({ type: 'varchar', length: 255, unique: true })
  token: string;

  @Column({ type: 'uuid' })
  property_tenant_id: string;

  @ManyToOne(() => PropertyTenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'property_tenant_id' })
  propertyTenant: PropertyTenant;

  @Column({ type: 'uuid' })
  property_id: string;

  @ManyToOne(() => Property, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'property_id' })
  property: Property;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Account;

  @Column({ type: 'date' })
  start_date: Date;

  @Column({ type: 'date' })
  end_date: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  rent_amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  service_charge: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  legal_fee: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  other_charges: number;

  // Billing v2 — missing fee types, previously hardcoded to 0 at cron time.
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  caution_deposit: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  agency_fee: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  other_fees: Array<{
    externalId: string;
    name: string;
    amount: number;
    recurring: boolean;
  }>;

  /** Full Fee[] snapshot — see common/billing/fees.ts. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  fee_breakdown: Fee[];

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total_amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  outstanding_balance: number;

  /**
   * Signed wallet balance at the time this invoice was created.
   * positive = tenant had credit (reduced total)
   * negative = tenant had outstanding debt (increased total)
   */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  wallet_balance: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  amount_paid: number | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  payment_option: string | null;

  @Column({ type: 'varchar', length: 20, default: 'landlord' })
  token_type: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  approval_status: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: RenewalPaymentStatus.UNPAID,
  })
  payment_status: RenewalPaymentStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  payment_reference: string | null;

  @Column({ type: 'timestamp', nullable: true })
  paid_at: Date | null;

  @Column({ type: 'boolean', default: false })
  otp_verified: boolean;

  @Column({ type: 'timestamp', nullable: true })
  otp_verified_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  expires_at: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  receipt_token: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  receipt_number: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  payment_frequency: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  payment_method: string | null;

  // ── Renewal-letter lifecycle (distinct from payment lifecycle) ──────────
  @Column({
    type: 'enum',
    enum: RenewalLetterStatus,
    enumName: 'renewal_letter_status_enum',
    default: RenewalLetterStatus.DRAFT,
  })
  letter_status: RenewalLetterStatus;

  /** Sanitized HTML of the editable letter body (see common/sanitize-html config). */
  @Column({ type: 'text', nullable: true })
  letter_body_html: string | null;

  /** Free-text slot overrides (landlord name override, company, tenant address lines). */
  // `any` here is deliberate — narrower types (Record<string, unknown>) fight
  // TypeORM's _QueryDeepPartialEntity expansion in call-sites that pass
  // Partial<RenewalInvoice> into manager.update(). Keep the DTO types strict.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  @Column({ type: 'jsonb', nullable: true })
  letter_body_fields: Record<string, any> | null;

  @Column({ type: 'timestamptz', nullable: true })
  letter_sent_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  accepted_at: Date | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  accepted_by_phone: string | null;

  /**
   * The 6-digit code the tenant used to accept — persisted for the audit
   * stamp only (live OTP challenges live in Redis with TTL).
   */
  @Column({ type: 'varchar', length: 8, nullable: true })
  acceptance_otp: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decision_made_at: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  decision_made_ip: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  declined_at: Date | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  declined_by_phone: string | null;

  /**
   * The 6-digit code the tenant used to decline — persisted for the audit
   * stamp only, mirroring `acceptance_otp` (live OTP challenges live in
   * Redis with TTL).
   */
  @Column({ type: 'varchar', length: 8, nullable: true })
  decline_otp: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  decline_reason: string | null;

  /**
   * Stamped by processOverdueRents when the rent expires while the letter
   * is still in 'sent' state — the cron flips letter_status to 'accepted'
   * and sets this column. The tenant page renders an AUTO-RENEWED stamp
   * variant (no OTP/phone metadata) when this is non-null.
   */
  @Column({ type: 'timestamptz', nullable: true })
  auto_renewed_at: Date | null;

  // ── PDF caching ─────────────────────────────────────────────────────────
  /**
   * Cloudinary URL of the most recently rendered renewal-letter PDF.
   * Generated post-accept/post-decline (and on demand from the download
   * endpoints). Stale by design — the download endpoint re-renders if
   * either letter_status or letter_body_html has moved since
   * pdf_generated_at, so a landlord edit between sends invalidates the
   * cache without an explicit cache bust.
   */
  @Column({ type: 'text', nullable: true })
  pdf_url: string | null;

  @Column({ type: 'timestamp', nullable: true })
  pdf_generated_at: Date | null;

  // ── Supersession (cross-version integrity) ──────────────────────────────
  /** Points from a NEW row to the version it replaces. Set at creation. */
  @Column({ type: 'uuid', nullable: true })
  supersedes_id: string | null;

  /** Points from an OLD row to its replacement. Non-null ⇒ row is locked. */
  @Column({ type: 'uuid', nullable: true })
  superseded_by_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  superseded_at: Date | null;
}

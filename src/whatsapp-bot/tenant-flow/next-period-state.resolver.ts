import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';

import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Rent } from 'src/rents/entities/rent.entity';
import {
  RenewalInvoice,
  RenewalLetterStatus,
  RenewalPaymentStatus,
} from 'src/tenancies/entities/renewal-invoice.entity';
import { PaymentPlan, PaymentPlanStatus } from 'src/payment-plans/entities/payment-plan.entity';
import {
  PaymentPlanInstallment,
  InstallmentStatus,
} from 'src/payment-plans/entities/payment-plan-installment.entity';

/**
 * Discriminated state of a tenant's next rent period as seen by the WhatsApp
 * bot. Each variant tells the dispatcher which branch to take when the tenant
 * taps "Pay Rent" with no outstanding balance.
 *
 * Precedence (top wins, short-circuit):
 *  1. Active plan with any pending installment  → ACTIVE_PLAN_LINK
 *  2. Any non-superseded row with approval_status='pending' → EXISTING_REQUEST
 *  3. Latest non-superseded row matching the period-fit guard, branched on
 *     (letter_status, payment_status)
 *  4. Otherwise → NEW_REQUEST
 */
export type NextPeriodState =
  | {
      kind: 'ACTIVE_PLAN_LINK';
      plan: PaymentPlan;
      nextInstallment: PaymentPlanInstallment;
    }
  | { kind: 'UNPAID_INVOICE_LINK'; invoice: RenewalInvoice }
  | { kind: 'ALREADY_PAID'; invoice: RenewalInvoice }
  | { kind: 'EXISTING_REQUEST'; invoice: RenewalInvoice }
  | { kind: 'DRAFT_LETTER_PENDING'; invoice: RenewalInvoice }
  | { kind: 'SENT_LETTER_PENDING'; invoice: RenewalInvoice }
  | { kind: 'NEW_REQUEST' };

@Injectable()
export class NextPeriodStateResolver {
  constructor(
    @InjectRepository(RenewalInvoice)
    private readonly renewalInvoiceRepo: Repository<RenewalInvoice>,
    @InjectRepository(PaymentPlan)
    private readonly paymentPlanRepo: Repository<PaymentPlan>,
  ) {}

  async resolve(propertyTenant: PropertyTenant, rent: Rent): Promise<NextPeriodState> {
    // 1. Active payment plan supersedes everything else — both parties have
    //    already agreed on installments, no new renewal request makes sense.
    const activePlanState = await this.findActivePlanWithPendingInstallment(
      propertyTenant.id,
    );
    if (activePlanState) return activePlanState;

    // 2. Already-pending tenant request — don't ping the landlord again,
    //    just acknowledge to the tenant we've nudged.
    const existingRequest = await this.renewalInvoiceRepo.findOne({
      where: {
        property_tenant_id: propertyTenant.id,
        approval_status: 'pending',
        superseded_by_id: IsNull(),
      },
      order: { created_at: 'DESC' },
    });
    if (existingRequest) {
      return { kind: 'EXISTING_REQUEST', invoice: existingRequest };
    }

    // 3. Latest non-superseded, non-expired row.
    const latest = await this.findLatestRow(propertyTenant.id);
    if (latest && this.fitsNextPeriod(latest, rent)) {
      const branched = this.branchOnLetterAndPayment(latest);
      if (branched) return branched;
    }

    // 4. Nothing usable — fresh request path.
    return { kind: 'NEW_REQUEST' };
  }

  private async findActivePlanWithPendingInstallment(
    propertyTenantId: string,
  ): Promise<NextPeriodState | null> {
    const plans = await this.paymentPlanRepo.find({
      where: {
        property_tenant_id: propertyTenantId,
        status: PaymentPlanStatus.ACTIVE,
      },
      relations: ['installments'],
      order: { created_at: 'DESC' },
    });

    for (const plan of plans) {
      const pending = (plan.installments ?? [])
        .filter((i) => i.status === InstallmentStatus.PENDING)
        .sort((a, b) => a.sequence - b.sequence);
      if (pending.length > 0) {
        return { kind: 'ACTIVE_PLAN_LINK', plan, nextInstallment: pending[0] };
      }
    }
    return null;
  }

  private async findLatestRow(propertyTenantId: string): Promise<RenewalInvoice | null> {
    const now = new Date();
    return this.renewalInvoiceRepo
      .createQueryBuilder('ri')
      .where('ri.property_tenant_id = :ptId', { ptId: propertyTenantId })
      .andWhere('ri.superseded_by_id IS NULL')
      .andWhere('(ri.expires_at IS NULL OR ri.expires_at > :now)', { now })
      .orderBy('ri.created_at', 'DESC')
      .getOne();
  }

  /**
   * Decide whether the row's billing period overlaps with what the tenant
   * is asking about. If the row's start_date is on or before the active
   * rent's expiry, treat it as the *current* outstanding period (the
   * tenant taps Pay → we send them their existing invoice link). If it's
   * far in the future (>7 days past expiry+1), treat as stale.
   */
  private fitsNextPeriod(invoice: RenewalInvoice, rent: Rent): boolean {
    if (!rent.expiry_date) return true;
    const expiry = new Date(rent.expiry_date);
    expiry.setUTCHours(0, 0, 0, 0);
    const rowStart = new Date(invoice.start_date);
    rowStart.setUTCHours(0, 0, 0, 0);

    if (rowStart.getTime() <= expiry.getTime()) return true;

    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const expectedNextStart = new Date(expiry);
    expectedNextStart.setUTCDate(expectedNextStart.getUTCDate() + 1);
    return rowStart.getTime() - expectedNextStart.getTime() <= SEVEN_DAYS_MS;
  }

  private branchOnLetterAndPayment(invoice: RenewalInvoice): NextPeriodState | null {
    if (invoice.payment_status === RenewalPaymentStatus.PAID) {
      return { kind: 'ALREADY_PAID', invoice };
    }
    if (
      invoice.letter_status === RenewalLetterStatus.ACCEPTED &&
      (invoice.payment_status === RenewalPaymentStatus.UNPAID ||
        invoice.payment_status === RenewalPaymentStatus.PARTIAL)
    ) {
      return { kind: 'UNPAID_INVOICE_LINK', invoice };
    }
    if (invoice.letter_status === RenewalLetterStatus.SENT) {
      return { kind: 'SENT_LETTER_PENDING', invoice };
    }
    if (invoice.letter_status === RenewalLetterStatus.DRAFT) {
      return { kind: 'DRAFT_LETTER_PENDING', invoice };
    }
    // DECLINED letter or anything else → fall through to NEW_REQUEST.
    return null;
  }
}

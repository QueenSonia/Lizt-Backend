import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { PaymentPlansService } from '../../src/payment-plans/payment-plans.service';
import {
  PaymentPlan,
  PaymentPlanScope,
  PaymentPlanSourceType,
} from '../../src/payment-plans/entities/payment-plan.entity';
import { PaymentPlanInstallment } from '../../src/payment-plans/entities/payment-plan-installment.entity';
import {
  PaymentPlanSource,
  PaymentPlanSourceKind,
} from '../../src/payment-plans/entities/payment-plan-source.entity';
import { PaymentPlanAllocation } from '../../src/payment-plans/entities/payment-plan-allocation.entity';
import {
  AdHocInvoice,
  AdHocInvoiceStatus,
} from '../../src/ad-hoc-invoices/entities/ad-hoc-invoice.entity';
import { RenewalInvoice } from '../../src/tenancies/entities/renewal-invoice.entity';
import { PropertyTenant } from '../../src/properties/entities/property-tenants.entity';
import { Property } from '../../src/properties/entities/property.entity';
import { PropertyHistory } from '../../src/property-history/entities/property-history.entity';
import { NotificationService } from '../../src/notifications/notification.service';
import { EventsGateway } from '../../src/events/events.gateway';
import { PaystackService } from '../../src/payments/paystack.service';
import { TenanciesService } from '../../src/tenancies/tenancies.service';
import { TenantBalancesService } from '../../src/tenant-balances/tenant-balances.service';
import { WhatsAppNotificationLogService } from '../../src/whatsapp-bot/whatsapp-notification-log.service';
import { UtilService } from '../../src/utils/utility-service';
import { PaymentPlanRequestsService } from '../../src/payment-plans/payment-plan-requests.service';
import { RenewalChargeService } from '../../src/renewal-letters/renewal-charge.service';
import { ManagementScopeService } from '../../src/common/scope/management-scope.service';
import { NotificationRecipientsService } from '../../src/common/notify/notification-recipients.service';
import { AdHocInvoicesService } from '../../src/ad-hoc-invoices/ad-hoc-invoices.service';

/**
 * Cover for the ad-hoc-invoice (Type B) settlement path:
 *  - the source_type discriminator routes ad-hoc/OB plans as wallet-backed,
 *  - a covered ad-hoc is marked PAID *credit-free* once its source residual
 *    reaches zero (the wallet was already credited by the OB_PAYMENT), and
 *  - a partial settlement flips it to PARTIAL at the derived amount.
 */
describe('PaymentPlansService — ad-hoc settlement', () => {
  let service: PaymentPlansService;

  const repoMock = () => ({
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    create: jest.fn((_e: unknown, v: unknown) => v),
    createQueryBuilder: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentPlansService,
        { provide: getRepositoryToken(PaymentPlan), useValue: repoMock() },
        { provide: getRepositoryToken(PaymentPlanInstallment), useValue: repoMock() },
        { provide: getRepositoryToken(PaymentPlanSource), useValue: repoMock() },
        { provide: getRepositoryToken(PaymentPlanAllocation), useValue: repoMock() },
        { provide: getRepositoryToken(AdHocInvoice), useValue: repoMock() },
        { provide: getRepositoryToken(RenewalInvoice), useValue: repoMock() },
        { provide: getRepositoryToken(PropertyTenant), useValue: repoMock() },
        { provide: getRepositoryToken(Property), useValue: repoMock() },
        { provide: getRepositoryToken(PropertyHistory), useValue: repoMock() },
        { provide: DataSource, useValue: { transaction: jest.fn(), getRepository: jest.fn() } },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        { provide: EventsGateway, useValue: { emitHistoryAdded: jest.fn() } },
        { provide: PaystackService, useValue: {} },
        { provide: TenanciesService, useValue: { refreshInvoiceTotals: jest.fn(), markInvoiceAsPaid: jest.fn() } },
        { provide: TenantBalancesService, useValue: { applyChange: jest.fn() } },
        { provide: WhatsAppNotificationLogService, useValue: { cancelPendingByReferenceIds: jest.fn() } },
        { provide: UtilService, useValue: {} },
        { provide: PaymentPlanRequestsService, useValue: { markApproved: jest.fn() } },
        { provide: RenewalChargeService, useValue: {} },
        {
          provide: ManagementScopeService,
          useValue: { managesLandlord: jest.fn().mockResolvedValue(false) },
        },
        {
          provide: NotificationRecipientsService,
          useValue: { resolveRecipients: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: AdHocInvoicesService,
          useValue: { sendInvoiceLinkNotification: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(PaymentPlansService);
  });

  describe('isInvoiceFeeChargePlan with source_type', () => {
    const call = (p: Partial<PaymentPlan>) =>
      (service as any).isInvoiceFeeChargePlan(p as PaymentPlan);

    it('false for an ad-hoc plan (source_type ad_hoc_invoice)', () => {
      expect(
        call({
          scope: PaymentPlanScope.CHARGE,
          source_type: PaymentPlanSourceType.AD_HOC_INVOICE,
          ad_hoc_invoice_id: 'inv-1',
          charge_external_id: null,
        }),
      ).toBe(false);
    });

    it('false for an OB plan (source_type outstanding_balance)', () => {
      expect(
        call({
          scope: PaymentPlanScope.CHARGE,
          source_type: PaymentPlanSourceType.OUTSTANDING_BALANCE,
          charge_external_id: 'outstanding_balance',
        }),
      ).toBe(false);
    });

    it('true for a real renewal-invoice fee (source_type renewal_invoice_fee)', () => {
      expect(
        call({
          scope: PaymentPlanScope.CHARGE,
          source_type: PaymentPlanSourceType.RENEWAL_INVOICE_FEE,
          charge_external_id: null,
          ad_hoc_invoice_id: null,
        }),
      ).toBe(true);
    });

    it('false for a legacy OB plan written before source_type existed', () => {
      // No source_type field — falls back to the charge_external_id check.
      expect(
        call({
          scope: PaymentPlanScope.CHARGE,
          charge_external_id: 'outstanding_balance',
        }),
      ).toBe(false);
    });
  });

  describe('applySourceSettlement (credit-free)', () => {
    const adHocSource = (): PaymentPlanSource =>
      ({
        id: 'src-1',
        source_kind: PaymentPlanSourceKind.AD_HOC_INVOICE,
        source_ad_hoc_invoice_id: 'inv-1',
        covered_amount: 100,
      }) as unknown as PaymentPlanSource;

    const managerWith = (invoice: Partial<AdHocInvoice> | null) => ({
      findOne: jest.fn().mockResolvedValue(invoice),
      update: jest.fn().mockResolvedValue(undefined),
    });

    it('marks the ad-hoc PAID with payment_method=payment_plan at residual 0', async () => {
      const manager = managerWith({
        id: 'inv-1',
        total_amount: 100,
        status: AdHocInvoiceStatus.PENDING,
      });
      // (manager, source, residualRemaining, appliedThisInstallment)
      await (service as any).applySourceSettlement(manager, adHocSource(), 0, 100);
      expect(manager.update).toHaveBeenCalledWith(
        AdHocInvoice,
        'inv-1',
        expect.objectContaining({
          status: AdHocInvoiceStatus.PAID,
          amount_paid: 100,
          payment_method: 'payment_plan',
          // Coverage cleared on full settlement so a completed plan never strands it.
          covered_by_plan_id: null,
        }),
      );
    });

    it('marks PARTIAL accumulating amount_paid by the amount applied', async () => {
      const manager = managerWith({
        id: 'inv-1',
        total_amount: 100,
        amount_paid: 0,
        status: AdHocInvoiceStatus.PENDING,
      });
      // residual 40 remaining, ₦60 applied this installment.
      await (service as any).applySourceSettlement(manager, adHocSource(), 40, 60);
      expect(manager.update).toHaveBeenCalledWith(
        AdHocInvoice,
        'inv-1',
        expect.objectContaining({
          status: AdHocInvoiceStatus.PARTIAL,
          amount_paid: 60,
        }),
      );
      const [, , payload] = manager.update.mock.calls[0];
      expect(payload.payment_method).toBeUndefined();
    });

    it('accumulates onto an invoice that already had a prior amount_paid', async () => {
      const manager = managerWith({
        id: 'inv-1',
        total_amount: 100,
        amount_paid: 20, // already partially paid before this plan
        status: AdHocInvoiceStatus.PARTIAL,
      });
      // Apply ₦15 more this installment, residual still > 1 → PARTIAL at 35.
      await (service as any).applySourceSettlement(manager, adHocSource(), 25, 15);
      expect(manager.update).toHaveBeenCalledWith(
        AdHocInvoice,
        'inv-1',
        expect.objectContaining({
          status: AdHocInvoiceStatus.PARTIAL,
          amount_paid: 35,
        }),
      );
    });

    it('does nothing for an already-paid invoice', async () => {
      const manager = managerWith({
        id: 'inv-1',
        total_amount: 100,
        status: AdHocInvoiceStatus.PAID,
      });
      await (service as any).applySourceSettlement(manager, adHocSource(), 0, 100);
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('ignores non-ad-hoc (arrears) sources', async () => {
      const manager = managerWith({ id: 'inv-1', total_amount: 100 });
      const arrears = {
        id: 'src-2',
        source_kind: PaymentPlanSourceKind.ARREARS,
        source_ad_hoc_invoice_id: null,
        covered_amount: 100,
      } as unknown as PaymentPlanSource;
      await (service as any).applySourceSettlement(manager, arrears, 0, 100);
      expect(manager.findOne).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
    });
  });
});

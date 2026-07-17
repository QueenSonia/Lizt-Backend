import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { PaymentPlansService } from '../../src/payment-plans/payment-plans.service';
import {
  PaymentPlan,
  PaymentPlanScope,
  PaymentPlanStatus,
} from '../../src/payment-plans/entities/payment-plan.entity';
import {
  PaymentPlanInstallment,
  InstallmentPaymentMethod,
  InstallmentStatus,
} from '../../src/payment-plans/entities/payment-plan-installment.entity';
import { PaymentPlanSource } from '../../src/payment-plans/entities/payment-plan-source.entity';
import { PaymentPlanAllocation } from '../../src/payment-plans/entities/payment-plan-allocation.entity';
import { AdHocInvoice } from '../../src/ad-hoc-invoices/entities/ad-hoc-invoice.entity';
import { RenewalInvoice } from '../../src/tenancies/entities/renewal-invoice.entity';
import { PropertyTenant } from '../../src/properties/entities/property-tenants.entity';
import { Property } from '../../src/properties/entities/property.entity';
import { PropertyHistory } from '../../src/property-history/entities/property-history.entity';
import { PaymentIntent } from '../../src/payments/entities/payment-intent.entity';
import { NotificationService } from '../../src/notifications/notification.service';
import { EventsGateway } from '../../src/events/events.gateway';
import { ACTIVE_PAYMENT_GATEWAY } from '../../src/payments/gateway/payment-gateway.interface';
import { GatewayRegistryService } from '../../src/payments/gateway/gateway-registry.service';
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
 * Regression cover for the verified "phantom wallet credit" double-reduction:
 * a charge-scope plan on a current-period invoice fee carves that fee out of
 * the renewal invoice at creation, so it must NOT also credit the wallet per
 * installment (which would reduce the invoice a second time). The synthetic
 * Outstanding-Balance charge settles real wallet debt and MUST credit.
 */
describe('PaymentPlansService — double-reduction fix', () => {
  let service: PaymentPlansService;
  let tenantBalances: { applyChange: jest.Mock };

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
    tenantBalances = { applyChange: jest.fn().mockResolvedValue({}) };

    const dataSourceMock = {
      // Run the transaction callback with a lightweight manager.
      transaction: jest.fn(async (cb: any) =>
        cb({
          // Installment/invoice status flips are compare-and-swap; the service
          // gates on `affected`, so the mock must report a winning update.
          update: jest.fn().mockResolvedValue({ affected: 1 }),
          create: jest.fn((_e: unknown, v: unknown) => v),
          save: jest.fn().mockResolvedValue(undefined),
          count: jest.fn().mockResolvedValue(1), // 1 pending left → plan not completed
          findOne: jest.fn().mockResolvedValue(null),
          // No wallet-backed sources → FIFO settlement is a clean no-op.
          find: jest.fn().mockResolvedValue([]),
        }),
      ),
      getRepository: jest.fn(),
    };

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
        // Written at checkout-init so the reconciliation sweep can rescue a
        // payment whose webhook and browser-return both failed.
        { provide: getRepositoryToken(PaymentIntent), useValue: repoMock() },
        { provide: DataSource, useValue: dataSourceMock },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        { provide: EventsGateway, useValue: { emitHistoryAdded: jest.fn() } },
        { provide: ACTIVE_PAYMENT_GATEWAY, useValue: {} },
        { provide: GatewayRegistryService, useValue: {} },
        { provide: TenanciesService, useValue: { refreshInvoiceTotals: jest.fn(), markInvoiceAsPaid: jest.fn() } },
        { provide: TenantBalancesService, useValue: tenantBalances },
        { provide: WhatsAppNotificationLogService, useValue: { queue: jest.fn(), cancelPendingByReferenceIds: jest.fn().mockResolvedValue(undefined) } },
        { provide: UtilService, useValue: { normalizePhoneNumber: jest.fn() } },
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

  const obPlan = (): PaymentPlan =>
    ({
      id: 'plan-ob',
      tenant_id: 'T',
      property_id: 'P',
      scope: PaymentPlanScope.CHARGE,
      charge_external_id: 'outstanding_balance',
      charge_fee_kind: 'other',
      charge_name: 'Outstanding Balance',
    } as unknown as PaymentPlan);

  const serviceChargePlan = (): PaymentPlan =>
    ({
      id: 'plan-svc',
      tenant_id: 'T',
      property_id: 'P',
      scope: PaymentPlanScope.CHARGE,
      charge_external_id: null,
      charge_fee_kind: 'service',
      charge_name: 'Service Charge',
    } as unknown as PaymentPlan);

  const customOtherFeePlan = (): PaymentPlan =>
    ({
      id: 'plan-other',
      tenant_id: 'T',
      property_id: 'P',
      scope: PaymentPlanScope.CHARGE,
      charge_external_id: 'custom_misc_1',
      charge_fee_kind: 'other',
      charge_name: 'Misc Items',
    } as unknown as PaymentPlan);

  const tenancyPlan = (): PaymentPlan =>
    ({ id: 'plan-ten', scope: PaymentPlanScope.TENANCY, charge_external_id: null } as unknown as PaymentPlan);

  describe('isInvoiceFeeChargePlan', () => {
    const call = (p: PaymentPlan) => (service as any).isInvoiceFeeChargePlan(p);

    it('true for a standard fee charge plan (service charge, external_id null)', () => {
      expect(call(serviceChargePlan())).toBe(true);
    });
    it('true for a named "other" fee charge plan (non-OB external_id)', () => {
      expect(call(customOtherFeePlan())).toBe(true);
    });
    it('false for the Outstanding Balance synthetic charge', () => {
      expect(call(obPlan())).toBe(false);
    });
    it('false for a tenancy-scope plan', () => {
      expect(call(tenancyPlan())).toBe(false);
    });
  });

  describe('markInstallmentPaid wallet-credit gating', () => {
    const drive = async (plan: PaymentPlan) => {
      const installment = {
        id: 'inst-1',
        sequence: 1,
        amount: 250,
        plan,
      } as unknown as PaymentPlanInstallment;

      // Re-read status check → still pending.
      (service as any).installmentRepository.findOne.mockResolvedValue({
        id: 'inst-1',
        status: InstallmentStatus.PENDING,
      });
      // Landlord resolution.
      (service as any).propertyRepository.findOne.mockResolvedValue({
        id: 'P',
        owner_id: 'L',
      });
      // Short-circuit the post-transaction side effects.
      jest.spyOn(service as any, 'logPlanEvent').mockResolvedValue(undefined);
      jest
        .spyOn(service as any, 'dispatchInstallmentNotifications')
        .mockResolvedValue(undefined);
      jest.spyOn(service as any, 'getPlan').mockResolvedValue({
        ...plan,
        status: PaymentPlanStatus.ACTIVE,
        installments: [installment],
      });

      await (service as any).markInstallmentPaid(installment, {
        amount: 250,
        method: InstallmentPaymentMethod.PAYSTACK,
        paystackRef: 'REF_1',
      });
    };

    it('does NOT credit the wallet for an invoice-fee charge plan (service charge)', async () => {
      await drive(serviceChargePlan());
      expect(tenantBalances.applyChange).not.toHaveBeenCalled();
    });

    it('does NOT credit the wallet for a named "other" fee charge plan', async () => {
      await drive(customOtherFeePlan());
      expect(tenantBalances.applyChange).not.toHaveBeenCalled();
    });

    it('DOES credit the wallet for the Outstanding Balance charge plan', async () => {
      await drive(obPlan());
      expect(tenantBalances.applyChange).toHaveBeenCalledTimes(1);
      expect(tenantBalances.applyChange).toHaveBeenCalledWith(
        'T',
        'L',
        250,
        expect.objectContaining({ relatedEntityType: 'payment_plan_installment' }),
        // The credit now shares the installment-claim transaction: notes=undefined,
        // and the EntityManager is passed as externalManager so it commits atomically.
        undefined,
        expect.anything(),
      );
    });
  });

  describe('cancelPlan restore amount', () => {
    const setupCancel = (plan: PaymentPlan) => {
      jest.spyOn(service as any, 'getPlan').mockResolvedValue(plan);
      jest.spyOn(service as any, 'logPlanEvent').mockResolvedValue(undefined);
      return jest
        .spyOn(service as any, 'restoreChargeToInvoice')
        .mockResolvedValue(undefined);
    };

    it('restores ONLY the unpaid remainder for an invoice-fee charge plan', async () => {
      const plan = {
        ...serviceChargePlan(),
        status: PaymentPlanStatus.ACTIVE,
        renewal_invoice_id: 'inv-1',
        total_amount: 500,
        // cancelPlan authorizes against the owning landlord (canManageOwner).
        property: { owner_id: 'L' },
        installments: [
          { id: 'i1', status: InstallmentStatus.PAID, amount: 250, amount_paid: 250 },
          { id: 'i2', status: InstallmentStatus.PENDING, amount: 250, amount_paid: null },
        ],
      } as unknown as PaymentPlan;
      const restoreSpy = setupCancel(plan);

      await service.cancelPlan('plan-svc', 'L');

      // total 500 − paid 250 = 250 restored (not the full 500).
      expect(restoreSpy).toHaveBeenCalledWith(
        expect.anything(),
        'inv-1',
        'service',
        null,
        'Service Charge',
        250,
      );
    });

    it('restores the FULL amount for an Outstanding Balance plan', async () => {
      const plan = {
        ...obPlan(),
        status: PaymentPlanStatus.ACTIVE,
        renewal_invoice_id: 'inv-1',
        total_amount: 500,
        property: { owner_id: 'L' },
        installments: [
          { id: 'i1', status: InstallmentStatus.PAID, amount: 250, amount_paid: 250 },
          { id: 'i2', status: InstallmentStatus.PENDING, amount: 250, amount_paid: null },
        ],
      } as unknown as PaymentPlan;
      const restoreSpy = setupCancel(plan);

      await service.cancelPlan('plan-ob', 'L');

      expect(restoreSpy).toHaveBeenCalledWith(
        expect.anything(),
        'inv-1',
        'other',
        'outstanding_balance',
        'Outstanding Balance',
        500,
      );
    });
  });
});

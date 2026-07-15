import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksController } from '../../src/payments/webhooks.controller';
import { PaymentService } from '../../src/payments/payment.service';
import { RenewalPaymentService } from '../../src/tenancies/renewal-payment.service';
import { PaystackLogger } from '../../src/payments/paystack-logger.service';
import { PaymentPlansService } from '../../src/payment-plans/payment-plans.service';
import { AdHocInvoicesService } from '../../src/ad-hoc-invoices/ad-hoc-invoices.service';
import { PropertyHistoryService } from '../../src/property-history/property-history.service';
import { PaystackGateway } from '../../src/payments/gateway/paystack.gateway';
import { MonnifyGateway } from '../../src/payments/gateway/monnify.gateway';
import { GatewayRegistryService } from '../../src/payments/gateway/gateway-registry.service';
import * as crypto from 'crypto';

/** Webhook processing is deferred via setImmediate — flush the macrotask queue. */
const flushSetImmediate = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

describe('WebhooksController', () => {
  let controller: WebhooksController;

  const secretKey = 'test_secret_key';

  const mockPaymentService = {
    processSuccessfulPayment: jest.fn().mockResolvedValue(undefined),
    processBankTransferRejected: jest.fn().mockResolvedValue(undefined),
  };

  const mockRenewalPaymentService = {
    processWebhookPayment: jest.fn().mockResolvedValue(undefined),
    processWebhookTransferRejected: jest.fn().mockResolvedValue(undefined),
  };

  const mockPaymentPlansService = {
    markInstallmentPaidFromWebhook: jest.fn().mockResolvedValue(undefined),
    markPlanPaidOffFromWebhook: jest.fn().mockResolvedValue(undefined),
  };

  const mockAdHocInvoicesService = {
    markInvoicePaidFromWebhook: jest.fn().mockResolvedValue(undefined),
  };

  const mockPropertyHistoryService = {
    createPropertyHistory: jest.fn().mockResolvedValue(undefined),
  };

  const mockPaystackLogger = {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string): string | undefined =>
      key === 'PAYSTACK_SECRET_KEY' ? secretKey : undefined,
    ),
  };

  beforeEach(async () => {
    // Real adapter + registry so the controller exercises the actual HMAC
    // verification and event normalization (PaystackService is not needed
    // for the webhook path).
    const paystackGateway = new PaystackGateway(
      {} as any,
      mockConfigService as any,
    );
    // Monnify is registered but stays unused by these Paystack-route tests;
    // its lazy config means constructing it here is harmless.
    const monnifyGateway = new MonnifyGateway(
      {} as any,
      mockConfigService as any,
    );
    const registry = new GatewayRegistryService(
      mockConfigService as any,
      paystackGateway,
      monnifyGateway,
    );

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: PaymentService, useValue: mockPaymentService },
        { provide: RenewalPaymentService, useValue: mockRenewalPaymentService },
        { provide: PaystackLogger, useValue: mockPaystackLogger },
        { provide: GatewayRegistryService, useValue: registry },
        { provide: PaymentPlansService, useValue: mockPaymentPlansService },
        { provide: AdHocInvoicesService, useValue: mockAdHocInvoicesService },
        {
          provide: PropertyHistoryService,
          useValue: mockPropertyHistoryService,
        },
      ],
    }).compile();

    controller = module.get<WebhooksController>(WebhooksController);

    jest.clearAllMocks();
  });

  const sign = (body: unknown) =>
    crypto
      .createHmac('sha512', secretKey)
      .update(JSON.stringify(body))
      .digest('hex');

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('handlePaystackWebhook', () => {
    const mockWebhookBody = {
      event: 'charge.success',
      data: {
        reference: 'LIZT_1234567890_abc123',
        amount: 50000000, // kobo
        status: 'success',
      },
    };

    it('accepts a valid charge.success webhook and processes a NORMALIZED event in the background', async () => {
      const req = {
        rawBody: JSON.stringify(mockWebhookBody),
        headers: {},
      } as any;
      const result = await controller.handlePaystackWebhook(
        req,
        sign(mockWebhookBody),
        mockWebhookBody,
        '127.0.0.1',
      );

      expect(result).toEqual({ status: 'success' });

      await flushSetImmediate();
      expect(mockPaymentService.processSuccessfulPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'payment.success',
          reference: 'LIZT_1234567890_abc123',
          amountNaira: 500000, // adapter owns kobo → naira
          gateway: 'paystack',
        }),
      );
    });

    it.each([
      [
        'PLANPAYOFF_1_a',
        { payment_plan_payoff_id: 'p1' },
        () => mockPaymentPlansService.markPlanPaidOffFromWebhook,
      ],
      [
        'PLAN_1_a',
        { payment_plan_installment_id: 'i1' },
        () => mockPaymentPlansService.markInstallmentPaidFromWebhook,
      ],
      [
        'INV_1_a',
        { ad_hoc_invoice_id: 'a1' },
        () => mockAdHocInvoicesService.markInvoicePaidFromWebhook,
      ],
      [
        'RENEWAL_1_a',
        { renewal_invoice_id: 'r1' },
        () => mockRenewalPaymentService.processWebhookPayment,
      ],
    ])(
      'routes %s references to the right processor',
      async (reference, metadata, processor) => {
        const body = {
          event: 'charge.success',
          data: { reference, amount: 100000, metadata },
        };
        const req = { rawBody: JSON.stringify(body), headers: {} } as any;

        const result = await controller.handlePaystackWebhook(
          req,
          sign(body),
          body,
          '127.0.0.1',
        );
        expect(result).toEqual({ status: 'success' });

        await flushSetImmediate();
        expect(processor()).toHaveBeenCalledWith(
          expect.objectContaining({
            reference,
            amountNaira: 1000,
            metadata,
            gateway: 'paystack',
          }),
        );
        expect(
          mockPaymentService.processSuccessfulPayment,
        ).not.toHaveBeenCalled();
      },
    );

    it('routes bank.transfer.rejected for renewals to the renewal processor', async () => {
      const body = {
        event: 'bank.transfer.rejected',
        data: {
          reference: 'RENEWAL_1_a',
          amount: 100000,
          gateway_response: 'Amount mismatch',
          metadata: { renewal_invoice_id: 'r1' },
        },
      };
      const req = { rawBody: JSON.stringify(body), headers: {} } as any;

      await controller.handlePaystackWebhook(req, sign(body), body, '1.1.1.1');
      await flushSetImmediate();

      expect(
        mockRenewalPaymentService.processWebhookTransferRejected,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: 'RENEWAL_1_a',
          amountNaira: 1000,
          gatewayResponse: 'Amount mismatch',
        }),
      );
    });

    it('records an ops artifact for rejected payments on the plan lane instead of dead-ending', async () => {
      const body = {
        event: 'bank.transfer.rejected',
        data: {
          reference: 'PLAN_1_a',
          amount: 100000,
          gateway_response: 'Rejected',
          metadata: { payment_plan_installment_id: 'i1', property_id: 'prop1' },
        },
      };
      const req = { rawBody: JSON.stringify(body), headers: {} } as any;

      await controller.handlePaystackWebhook(req, sign(body), body, '1.1.1.1');
      await flushSetImmediate();

      expect(
        mockPropertyHistoryService.createPropertyHistory,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          property_id: 'prop1',
          event_type: 'bank_transfer_rejected',
          related_entity_type: 'payment_plan',
        }),
      );
      expect(
        mockPaymentService.processBankTransferRejected,
      ).not.toHaveBeenCalled();
    });

    it('rejects webhook with invalid signature', async () => {
      const req = {
        rawBody: JSON.stringify(mockWebhookBody),
        headers: {},
      } as any;

      const result = await controller.handlePaystackWebhook(
        req,
        'invalid_signature',
        mockWebhookBody,
        '127.0.0.1',
      );

      expect(result.status).toBe('error');
      await flushSetImmediate();
      expect(
        mockPaymentService.processSuccessfulPayment,
      ).not.toHaveBeenCalled();
    });

    it('rejects webhook with missing signature', async () => {
      const req = {
        rawBody: JSON.stringify(mockWebhookBody),
        headers: {},
      } as any;

      const result = await controller.handlePaystackWebhook(
        req,
        undefined as any,
        mockWebhookBody,
        '127.0.0.1',
      );

      expect(result.status).toBe('error');
      await flushSetImmediate();
      expect(
        mockPaymentService.processSuccessfulPayment,
      ).not.toHaveBeenCalled();
    });

    it('skips non-payment events without invoking processors', async () => {
      const otherEventBody = {
        event: 'charge.failed',
        data: mockWebhookBody.data,
      };
      const req = {
        rawBody: JSON.stringify(otherEventBody),
        headers: {},
      } as any;

      const result = await controller.handlePaystackWebhook(
        req,
        sign(otherEventBody),
        otherEventBody,
        '127.0.0.1',
      );

      expect(result).toEqual({ status: 'success' });
      await flushSetImmediate();
      expect(
        mockPaymentService.processSuccessfulPayment,
      ).not.toHaveBeenCalled();
    });

    it('ignores IP whitelisting in non-production', async () => {
      process.env.NODE_ENV = 'development';
      const req = {
        rawBody: JSON.stringify(mockWebhookBody),
        headers: {},
      } as any;
      const result = await controller.handlePaystackWebhook(
        req,
        sign(mockWebhookBody),
        mockWebhookBody,
        '1.1.1.1', // Not a Paystack IP
      );

      expect(result.status).toBe('success');
      await flushSetImmediate();
      expect(mockPaymentService.processSuccessfulPayment).toHaveBeenCalled();
    });
  });

  describe('handleMonnifyWebhook', () => {
    it('rejects a Monnify webhook whose signature does not verify (no MONNIFY_SECRET_KEY configured) and processes nothing', async () => {
      const body = { eventType: 'SUCCESSFUL_TRANSACTION', eventData: {} };
      const req = { rawBody: JSON.stringify(body), headers: {} } as any;

      const result = await controller.handleMonnifyWebhook(
        req,
        'not-a-valid-signature',
        body,
        '127.0.0.1',
      );

      expect(result.status).toBe('error');
      await flushSetImmediate();
      expect(
        mockPaymentService.processSuccessfulPayment,
      ).not.toHaveBeenCalled();
    });

    it('routes a validly-signed Monnify SUCCESSFUL_TRANSACTION through the shared normalized router', async () => {
      const monnifySecret = 'monnify_secret';
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'PAYSTACK_SECRET_KEY'
          ? secretKey
          : key === 'MONNIFY_SECRET_KEY'
            ? monnifySecret
            : undefined,
      );

      const body = {
        eventType: 'SUCCESSFUL_TRANSACTION',
        eventData: {
          paymentReference: 'RENEWAL_1_abc',
          amountPaid: 1000,
          totalPayable: 1000,
          paymentStatus: 'PAID',
          paymentMethod: 'ACCOUNT_TRANSFER',
          metaData: { renewal_invoice_id: 'r1' },
        },
      };
      const rawBody = JSON.stringify(body);
      const signature = crypto
        .createHmac('sha512', monnifySecret)
        .update(rawBody)
        .digest('hex');
      const req = { rawBody, headers: {} } as any;

      const result = await controller.handleMonnifyWebhook(
        req,
        signature,
        body,
        '127.0.0.1',
      );

      expect(result).toEqual({ status: 'success' });
      await flushSetImmediate();
      expect(
        mockRenewalPaymentService.processWebhookPayment,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: 'RENEWAL_1_abc',
          amountNaira: 1000, // naira passthrough
          gateway: 'monnify',
        }),
      );
    });
  });
});

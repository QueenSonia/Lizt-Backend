import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhooksController } from '../../src/payments/webhooks.controller';
import { PaymentService } from '../../src/payments/payment.service';
import { RenewalPaymentService } from '../../src/tenancies/renewal-payment.service';
import { PaystackLogger } from '../../src/payments/paystack-logger.service';
import { PaymentPlansService } from '../../src/payment-plans/payment-plans.service';
import { AdHocInvoicesService } from '../../src/ad-hoc-invoices/ad-hoc-invoices.service';
import * as crypto from 'crypto';

/** Webhook processing is deferred via setImmediate — flush the macrotask queue. */
const flushSetImmediate = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

describe('WebhooksController', () => {
  let controller: WebhooksController;

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

  const mockPaystackLogger = {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        {
          provide: PaymentService,
          useValue: mockPaymentService,
        },
        {
          provide: RenewalPaymentService,
          useValue: mockRenewalPaymentService,
        },
        {
          provide: PaystackLogger,
          useValue: mockPaystackLogger,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: PaymentPlansService,
          useValue: mockPaymentPlansService,
        },
        {
          provide: AdHocInvoicesService,
          useValue: mockAdHocInvoicesService,
        },
      ],
    }).compile();

    controller = module.get<WebhooksController>(WebhooksController);

    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('handlePaystackWebhook', () => {
    const secretKey = 'test_secret_key';
    const mockWebhookBody = {
      event: 'charge.success',
      data: {
        reference: 'LIZT_1234567890_abc123',
        amount: 50000000,
        status: 'success',
      },
    };

    beforeEach(() => {
      mockConfigService.get.mockReturnValue(secretKey);
    });

    it('should accept a valid charge.success webhook and process it in the background', async () => {
      const signature = crypto
        .createHmac('sha512', secretKey)
        .update(JSON.stringify(mockWebhookBody))
        .digest('hex');

      const req = {
        rawBody: JSON.stringify(mockWebhookBody),
        headers: {},
      } as any;
      const result = await controller.handlePaystackWebhook(
        req,
        signature,
        mockWebhookBody,
        '127.0.0.1',
      );

      expect(result).toEqual({ status: 'success' });

      // Processing is deferred to a setImmediate callback
      await flushSetImmediate();
      expect(mockPaymentService.processSuccessfulPayment).toHaveBeenCalledWith(
        mockWebhookBody.data,
      );
    });

    it('should reject webhook with invalid signature', async () => {
      const invalidSignature = 'invalid_signature';
      const req = {
        rawBody: JSON.stringify(mockWebhookBody),
        headers: {},
      } as any;

      const result = await controller.handlePaystackWebhook(
        req,
        invalidSignature,
        mockWebhookBody,
        '127.0.0.1',
      );

      expect(result.status).toBe('error');
      await flushSetImmediate();
      expect(
        mockPaymentService.processSuccessfulPayment,
      ).not.toHaveBeenCalled();
    });

    it('should reject webhook with missing signature', async () => {
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

    it('should skip non-charge.success events', async () => {
      const otherEventBody = {
        event: 'charge.failed',
        data: mockWebhookBody.data,
      };

      const signature = crypto
        .createHmac('sha512', secretKey)
        .update(JSON.stringify(otherEventBody))
        .digest('hex');

      const req = {
        rawBody: JSON.stringify(otherEventBody),
        headers: {},
      } as any;
      const result = await controller.handlePaystackWebhook(
        req,
        signature,
        otherEventBody,
        '127.0.0.1',
      );

      expect(result).toEqual({ status: 'success' });
      await flushSetImmediate();
      expect(
        mockPaymentService.processSuccessfulPayment,
      ).not.toHaveBeenCalled();
    });

    it('should ignore IP whitelisting in non-production', async () => {
      process.env.NODE_ENV = 'development';
      const signature = crypto
        .createHmac('sha512', secretKey)
        .update(JSON.stringify(mockWebhookBody))
        .digest('hex');

      const req = {
        rawBody: JSON.stringify(mockWebhookBody),
        headers: {},
      } as any;
      const result = await controller.handlePaystackWebhook(
        req,
        signature,
        mockWebhookBody,
        '1.1.1.1', // Not a Paystack IP
      );

      expect(result.status).toBe('success');
      await flushSetImmediate();
      expect(mockPaymentService.processSuccessfulPayment).toHaveBeenCalled();
    });
  });
});

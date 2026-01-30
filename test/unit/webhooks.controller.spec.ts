import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhooksController } from '../../src/payments/webhooks.controller';
import { PaymentService } from '../../src/payments/payment.service';
import { PaystackLogger } from '../../src/payments/paystack-logger.service';
import * as crypto from 'crypto';

describe('WebhooksController', () => {
  let controller: WebhooksController;

  const mockPaymentService = {
    processSuccessfulPayment: jest.fn(),
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
          provide: PaystackLogger,
          useValue: mockPaystackLogger,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
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
    const webhookSecret = 'test_webhook_secret';
    const mockWebhookBody = {
      event: 'charge.success',
      data: {
        reference: 'LIZT_1234567890_abc123',
        amount: 50000000, // 500,000 NGN in kobo
        status: 'success',
        paid_at: '2026-01-28T10:30:00Z',
        channel: 'card',
        customer: {
          email: 'tenant@example.com',
        },
      },
    };

    beforeEach(() => {
      mockConfigService.get.mockReturnValue(webhookSecret);
    });

    it('should process valid webhook with correct signature', async () => {
      // Generate valid signature
      const signature = crypto
        .createHmac('sha512', webhookSecret)
        .update(JSON.stringify(mockWebhookBody))
        .digest('hex');

      const req = {} as any;
      const result = await controller.handlePaystackWebhook(
        req,
        signature,
        mockWebhookBody,
      );

      expect(result).toEqual({ status: 'success' });
      expect(mockPaymentService.processSuccessfulPayment).toHaveBeenCalledWith(
        mockWebhookBody.data,
      );
      expect(mockPaystackLogger.info).toHaveBeenCalledWith(
        'Webhook received',
        expect.any(Object),
      );
    });

    it('should reject webhook with invalid signature', async () => {
      const invalidSignature = 'invalid_signature';

      const req = {} as any;
      const result = await controller.handlePaystackWebhook(
        req,
        invalidSignature,
        mockWebhookBody,
      );

      // Should return error status but still 200 OK
      expect(result.status).toBe('error');
      expect(
        mockPaymentService.processSuccessfulPayment,
      ).not.toHaveBeenCalled();
      expect(mockPaystackLogger.error).toHaveBeenCalledWith(
        'Invalid webhook signature',
        expect.any(Object),
      );
    });

    it('should reject webhook with missing signature', async () => {
      const req = {} as any;
      const result = await controller.handlePaystackWebhook(
        req,
        undefined as any,
        mockWebhookBody,
      );

      // Should return error status but still 200 OK
      expect(result.status).toBe('error');
      expect(
        mockPaymentService.processSuccessfulPayment,
      ).not.toHaveBeenCalled();
      expect(mockPaystackLogger.error).toHaveBeenCalledWith(
        'Webhook signature missing',
        expect.any(Object),
      );
    });

    it('should ignore non-charge.success events', async () => {
      const otherEventBody = {
        event: 'charge.failed',
        data: mockWebhookBody.data,
      };

      const signature = crypto
        .createHmac('sha512', webhookSecret)
        .update(JSON.stringify(otherEventBody))
        .digest('hex');

      const req = {} as any;
      const result = await controller.handlePaystackWebhook(
        req,
        signature,
        otherEventBody,
      );

      expect(result).toEqual({ status: 'success' });
      expect(
        mockPaymentService.processSuccessfulPayment,
      ).not.toHaveBeenCalled();
      expect(mockPaystackLogger.info).toHaveBeenCalledWith(
        'Webhook event ignored',
        expect.any(Object),
      );
    });

    it('should return 200 OK even when processing fails', async () => {
      mockPaymentService.processSuccessfulPayment.mockRejectedValue(
        new Error('Processing failed'),
      );

      const signature = crypto
        .createHmac('sha512', webhookSecret)
        .update(JSON.stringify(mockWebhookBody))
        .digest('hex');

      const req = {} as any;
      const result = await controller.handlePaystackWebhook(
        req,
        signature,
        mockWebhookBody,
      );

      // Should still return 200 OK with error status
      expect(result.status).toBe('error');
      expect(result.message).toBe('Processing failed');
      expect(mockPaystackLogger.error).toHaveBeenCalledWith(
        'Webhook processing error',
        expect.any(Object),
      );
    });

    it('should handle missing webhook secret configuration', async () => {
      mockConfigService.get.mockReturnValue(undefined);

      const signature = 'some_signature';
      const req = {} as any;
      const result = await controller.handlePaystackWebhook(
        req,
        signature,
        mockWebhookBody,
      );

      expect(result.status).toBe('error');
      expect(mockPaystackLogger.error).toHaveBeenCalledWith(
        'PAYSTACK_WEBHOOK_SECRET not configured',
        expect.any(Object),
      );
    });
  });
});

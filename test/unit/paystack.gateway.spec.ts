import { HttpException, HttpStatus } from '@nestjs/common';
import * as crypto from 'crypto';
import { PaystackGateway } from '../../src/payments/gateway/paystack.gateway';
import {
  DuplicateReferenceError,
  GatewayReferenceNotFoundError,
} from '../../src/payments/gateway/payment-gateway.interface';

describe('PaystackGateway', () => {
  const SECRET = 'sk_test_gateway_secret';

  const mockPaystackService = {
    initializeTransaction: jest.fn(),
    verifyTransaction: jest.fn(),
  };
  const mockConfigService = {
    get: jest.fn((key: string) =>
      key === 'PAYSTACK_SECRET_KEY' ? SECRET : undefined,
    ),
  };

  let gateway: PaystackGateway;

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new PaystackGateway(
      mockPaystackService as any,
      mockConfigService as any,
    );
  });

  describe('initializePayment', () => {
    it('converts naira to kobo, defaults channels, and maps the response', async () => {
      mockPaystackService.initializeTransaction.mockResolvedValue({
        status: true,
        message: 'ok',
        data: {
          authorization_url: 'https://checkout.paystack.com/abc',
          access_code: 'ACCESS_123',
          reference: 'RENEWAL_1_abc',
        },
      });

      const result = await gateway.initializePayment({
        amountNaira: 150_000.5,
        email: 't@x.com',
        reference: 'RENEWAL_1_abc',
        callbackUrl: 'https://app/return',
        metadata: { renewal_invoice_id: 'inv-1' },
      });

      expect(mockPaystackService.initializeTransaction).toHaveBeenCalledWith({
        email: 't@x.com',
        amount: 15_000_050, // naira → kobo, rounded
        reference: 'RENEWAL_1_abc',
        callback_url: 'https://app/return',
        metadata: { renewal_invoice_id: 'inv-1' },
        channels: ['card', 'bank_transfer'],
      });
      expect(result).toEqual({
        reference: 'RENEWAL_1_abc',
        checkoutUrl: 'https://checkout.paystack.com/abc',
        gatewayTransactionId: 'ACCESS_123',
        gateway: 'paystack',
      });
    });

    it('maps a duplicate-reference rejection to DuplicateReferenceError', async () => {
      mockPaystackService.initializeTransaction.mockRejectedValue(
        new HttpException(
          {
            statusCode: 400,
            message: 'Paystack error: Duplicate Transaction Reference',
            error: 'PaystackError',
          },
          HttpStatus.BAD_REQUEST,
        ),
      );

      await expect(
        gateway.initializePayment({
          amountNaira: 100,
          email: 't@x.com',
          reference: 'RENEWAL_dup',
          callbackUrl: 'https://app/return',
          metadata: {},
        }),
      ).rejects.toBeInstanceOf(DuplicateReferenceError);
    });
  });

  describe('verifyPayment', () => {
    const verifyResponse = (data: Partial<Record<string, any>>) => ({
      status: true,
      message: 'ok',
      data: {
        status: 'success',
        reference: 'REF_1',
        amount: 250_000, // kobo
        channel: 'card',
        paid_at: '2026-07-15T10:00:00.000Z',
        gateway_response: 'Successful',
        metadata: { renewal_invoice_id: 'inv-1' },
        ...data,
      },
    });

    it('maps success with kobo→naira and a Date paidAt', async () => {
      mockPaystackService.verifyTransaction.mockResolvedValue(
        verifyResponse({}),
      );

      const result = await gateway.verifyPayment('REF_1');

      expect(result.status).toBe('success');
      expect(result.moneyReceived).toBe(true);
      expect(result.amountNaira).toBe(2500);
      expect(result.channel).toBe('card');
      expect(result.paidAt).toEqual(new Date('2026-07-15T10:00:00.000Z'));
      expect(result.gateway).toBe('paystack');
      expect(result.rawStatus).toBe('success');
      expect(result.metadata).toEqual({ renewal_invoice_id: 'inv-1' });
    });

    it.each(['failed', 'abandoned', 'reversed'])(
      'maps %s to failed with moneyReceived=false',
      async (status) => {
        mockPaystackService.verifyTransaction.mockResolvedValue(
          verifyResponse({ status, paid_at: null }),
        );

        const result = await gateway.verifyPayment('REF_1');
        expect(result.status).toBe('failed');
        expect(result.moneyReceived).toBe(false);
        expect(result.paidAt).toBeNull();
      },
    );

    it.each(['ongoing', 'pending', 'processing', 'queued'])(
      'maps %s to pending',
      async (status) => {
        mockPaystackService.verifyTransaction.mockResolvedValue(
          verifyResponse({ status, paid_at: null }),
        );

        const result = await gateway.verifyPayment('REF_1');
        expect(result.status).toBe('pending');
        expect(result.moneyReceived).toBe(false);
      },
    );

    it('maps "Transaction reference not found" to GatewayReferenceNotFoundError', async () => {
      mockPaystackService.verifyTransaction.mockRejectedValue(
        new HttpException(
          {
            statusCode: 404,
            message: 'Paystack error: Transaction reference not found',
            error: 'PaystackError',
          },
          HttpStatus.NOT_FOUND,
        ),
      );

      await expect(gateway.verifyPayment('NOPE')).rejects.toBeInstanceOf(
        GatewayReferenceNotFoundError,
      );
    });

    it('passes transient errors through untouched (no fake not-found)', async () => {
      const transient = new HttpException(
        {
          statusCode: 503,
          message: 'Paystack service is currently unavailable',
          error: 'ServiceUnavailable',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      mockPaystackService.verifyTransaction.mockRejectedValue(transient);

      await expect(gateway.verifyPayment('REF_1')).rejects.toBe(transient);
    });
  });

  describe('verifyWebhookSignature', () => {
    const rawBody = JSON.stringify({ event: 'charge.success', data: {} });
    const validSignature = crypto
      .createHmac('sha512', SECRET)
      .update(rawBody)
      .digest('hex');

    it('accepts a valid HMAC signature', () => {
      expect(
        gateway.verifyWebhookSignature(rawBody, {
          'x-paystack-signature': validSignature,
        }),
      ).toBe(true);
    });

    it('rejects an invalid signature', () => {
      expect(
        gateway.verifyWebhookSignature(rawBody, {
          'x-paystack-signature': 'f'.repeat(validSignature.length),
        }),
      ).toBe(false);
    });

    it('rejects a missing signature', () => {
      expect(gateway.verifyWebhookSignature(rawBody, {})).toBe(false);
    });

    it('rejects when the secret key is not configured', () => {
      mockConfigService.get.mockReturnValueOnce(undefined);
      expect(
        gateway.verifyWebhookSignature(rawBody, {
          'x-paystack-signature': validSignature,
        }),
      ).toBe(false);
    });
  });

  describe('parseWebhookEvent', () => {
    it('maps charge.success with kobo→naira', () => {
      const event = gateway.parseWebhookEvent({
        event: 'charge.success',
        data: {
          reference: 'PLAN_1_abc',
          amount: 500_000,
          channel: 'bank_transfer',
          paid_at: '2026-07-15T10:00:00.000Z',
          metadata: { payment_plan_installment_id: 'i-1' },
        },
      });

      expect(event.type).toBe('payment.success');
      expect(event.rawEventType).toBe('charge.success');
      expect(event.reference).toBe('PLAN_1_abc');
      expect(event.amountNaira).toBe(5000);
      expect(event.channel).toBe('bank_transfer');
      expect(event.metadata).toEqual({ payment_plan_installment_id: 'i-1' });
      expect(event.gateway).toBe('paystack');
    });

    it('maps bank.transfer.rejected to transfer.rejected with gatewayResponse', () => {
      const event = gateway.parseWebhookEvent({
        event: 'bank.transfer.rejected',
        data: {
          reference: 'RENEWAL_1_abc',
          amount: 100_000,
          gateway_response: 'Transfer amount mismatch',
          metadata: { renewal_invoice_id: 'inv-1' },
        },
      });

      expect(event.type).toBe('transfer.rejected');
      expect(event.amountNaira).toBe(1000);
      expect(event.gatewayResponse).toBe('Transfer amount mismatch');
    });

    it('maps unknown events to other without throwing', () => {
      const event = gateway.parseWebhookEvent({
        event: 'subscription.create',
        data: {},
      });
      expect(event.type).toBe('other');
    });
  });

  it('exposes name, expiry, and source IPs', () => {
    expect(gateway.name).toBe('paystack');
    expect(gateway.checkoutExpiryMinutes).toBe(30);
    expect(gateway.allowedSourceIps()).toEqual([
      '52.31.139.75',
      '52.49.173.169',
      '52.214.14.220',
    ]);
  });
});

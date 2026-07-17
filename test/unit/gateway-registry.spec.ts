import { GatewayRegistryService } from '../../src/payments/gateway/gateway-registry.service';
import {
  GatewayReferenceNotFoundError,
  PaymentGateway,
  VerifyPaymentResult,
} from '../../src/payments/gateway/payment-gateway.interface';

const verifyResult = (
  gateway: string,
  reference: string,
): VerifyPaymentResult => ({
  status: 'success',
  rawStatus: 'success',
  moneyReceived: true,
  reference,
  amountNaira: 1000,
  channel: 'card',
  paidAt: new Date('2026-07-15T10:00:00.000Z'),
  metadata: null,
  gateway,
  raw: {},
});

const fakeGateway = (name: string): PaymentGateway & { verifyPayment: jest.Mock } =>
  ({
    name,
    checkoutExpiryMinutes: 30,
    initializePayment: jest.fn(),
    verifyPayment: jest.fn(),
    verifyWebhookSignature: jest.fn(),
    parseWebhookEvent: jest.fn(),
    allowedSourceIps: jest.fn(() => []),
  }) as any;

describe('GatewayRegistryService', () => {
  let paystack: ReturnType<typeof fakeGateway>;
  let monnify: ReturnType<typeof fakeGateway>;
  let env: Record<string, string | undefined>;
  let registry: GatewayRegistryService;

  const mockConfigService = {
    get: jest.fn((key: string) => env[key]),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    env = {};
    paystack = fakeGateway('paystack');
    monnify = fakeGateway('monnify');
    registry = new GatewayRegistryService(
      mockConfigService as any,
      paystack as any,
      monnify as any,
    );
  });

  describe('active()', () => {
    it('defaults to paystack when PAYMENT_GATEWAY is unset', () => {
      expect(registry.active().name).toBe('paystack');
    });

    it('resolves the gateway named by PAYMENT_GATEWAY', () => {
      env.PAYMENT_GATEWAY = 'monnify';
      expect(registry.active().name).toBe('monnify');
    });

    it('throws loudly on an unknown gateway name', () => {
      env.PAYMENT_GATEWAY = 'flutterwave';
      expect(() => registry.active()).toThrow(/Unknown payment gateway/);
    });
  });

  describe('verifyByReference()', () => {
    it('returns the active gateway result when it knows the reference', async () => {
      env.PAYMENT_GATEWAY = 'monnify';
      monnify.verifyPayment.mockResolvedValue(
        verifyResult('monnify', 'REF_1'),
      );

      const result = await registry.verifyByReference('REF_1');

      expect(result.gateway).toBe('monnify');
      expect(paystack.verifyPayment).not.toHaveBeenCalled();
    });

    it('falls back through other adapters on not-found', async () => {
      env.PAYMENT_GATEWAY = 'monnify';
      monnify.verifyPayment.mockRejectedValue(
        new GatewayReferenceNotFoundError('REF_LEGACY'),
      );
      paystack.verifyPayment.mockResolvedValue(
        verifyResult('paystack', 'REF_LEGACY'),
      );

      const result = await registry.verifyByReference('REF_LEGACY');

      expect(result.gateway).toBe('paystack');
      expect(monnify.verifyPayment).toHaveBeenCalledWith('REF_LEGACY');
      expect(paystack.verifyPayment).toHaveBeenCalledWith('REF_LEGACY');
    });

    it('rethrows the original not-found when every adapter misses', async () => {
      env.PAYMENT_GATEWAY = 'monnify';
      const original = new GatewayReferenceNotFoundError('REF_GONE');
      monnify.verifyPayment.mockRejectedValue(original);
      paystack.verifyPayment.mockRejectedValue(
        new GatewayReferenceNotFoundError('REF_GONE'),
      );

      await expect(registry.verifyByReference('REF_GONE')).rejects.toBe(
        original,
      );
    });

    it('propagates transient errors immediately without probing legacy adapters', async () => {
      env.PAYMENT_GATEWAY = 'monnify';
      const transient = new Error('ECONNRESET');
      monnify.verifyPayment.mockRejectedValue(transient);

      await expect(registry.verifyByReference('REF_1')).rejects.toBe(
        transient,
      );
      expect(paystack.verifyPayment).not.toHaveBeenCalled();
    });

    it('propagates a transient error from the fallback adapter too', async () => {
      env.PAYMENT_GATEWAY = 'monnify';
      monnify.verifyPayment.mockRejectedValue(
        new GatewayReferenceNotFoundError('REF_1'),
      );
      const transient = new Error('ETIMEDOUT');
      paystack.verifyPayment.mockRejectedValue(transient);

      await expect(registry.verifyByReference('REF_1')).rejects.toBe(
        transient,
      );
    });
  });
});

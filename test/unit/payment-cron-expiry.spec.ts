import { PaymentService } from '../../src/payments/payment.service';
import { PaymentStatus } from '../../src/payments/entities/payment.entity';
import {
  GatewayReferenceNotFoundError,
  VerifyPaymentResult,
} from '../../src/payments/gateway/payment-gateway.interface';

/**
 * Focused money-safety test for the checkExpiredPayments cron under the
 * gateway abstraction. Constructs PaymentService with stubbed deps and spies
 * on its own outcome methods (processSuccessfulPayment / markAsFailed) so we
 * assert only the DECISION the cron makes per normalized verify result —
 * without exercising the huge success path.
 */
describe('PaymentService.checkExpiredPayments (money-safety decisions)', () => {
  const NOW = new Date('2026-07-15T12:00:00.000Z');

  const makePayment = (overrides: Partial<any> = {}) => ({
    id: 'pay-1',
    gateway: 'monnify',
    gateway_reference: 'RENEWAL_1_abc',
    status: PaymentStatus.PENDING,
    // 35 minutes old — past the 30-min gate, inside Monnify's 40-min window.
    created_at: new Date(NOW.getTime() - 35 * 60 * 1000),
    ...overrides,
  });

  const verifyResult = (
    overrides: Partial<VerifyPaymentResult>,
  ): VerifyPaymentResult => ({
    status: 'pending',
    rawStatus: 'PENDING',
    moneyReceived: false,
    reference: 'RENEWAL_1_abc',
    amountNaira: 1000,
    channel: 'card',
    paidAt: null,
    metadata: null,
    gateway: 'monnify',
    raw: {},
    ...overrides,
  });

  let service: PaymentService;
  let paymentRepo: { find: jest.Mock };
  let gatewayVerify: jest.Mock;
  let logger: any;

  const buildService = (payment: any) => {
    paymentRepo = { find: jest.fn().mockResolvedValue([payment]) };
    gatewayVerify = jest.fn();
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    const registry = {
      get: jest.fn(() => ({ verifyPayment: gatewayVerify })),
      names: jest.fn(() => ['monnify', 'paystack']),
    };

    // Construct with positional args; only the fields the cron touches are
    // real. The rest are unused by this path.
    service = new PaymentService(
      paymentRepo as any, // paymentRepository
      {} as any, // paymentLogRepository
      {} as any, // offerLetterRepository
      {} as any, // propertyRepository
      {} as any, // usersRepository
      {} as any, // accountRepository
      {} as any, // kycApplicationRepository
      {} as any, // gateway (ACTIVE_PAYMENT_GATEWAY)
      registry as any, // gatewayRegistry
      logger as any, // paystackLogger
      {} as any, // tenantAttachmentService
      {} as any, // propertyHistoryService
      {} as any, // templateSenderService
      {} as any, // invoicesService
      {} as any, // notificationService
      {} as any, // eventsGateway
      {} as any, // dataSource
      {} as any, // receiptGeneratorService
      {} as any, // whatsappNotificationLog
      {} as any, // notificationRecipients
      {} as any, // utilService
    );

    // Spy on the terminal decisions rather than run them.
    jest
      .spyOn(service, 'processSuccessfulPayment')
      .mockResolvedValue(undefined);
    jest.spyOn(service, 'markAsFailed').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'logPaymentEvent')
      .mockResolvedValue(undefined);
  };

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('processes a payment the gateway now reports as successful', async () => {
    const payment = makePayment();
    buildService(payment);
    const result = verifyResult({ status: 'success', moneyReceived: true });
    gatewayVerify.mockResolvedValue(result);

    await service.checkExpiredPayments();

    expect(service.processSuccessfulPayment).toHaveBeenCalledWith(result);
    expect(service.markAsFailed).not.toHaveBeenCalled();
  });

  it('does NOT fail a 35-min-old payment the gateway still reports PENDING (inside the checkout window)', async () => {
    const payment = makePayment();
    buildService(payment);
    gatewayVerify.mockResolvedValue(verifyResult({ status: 'pending' }));

    await service.checkExpiredPayments();

    expect(service.markAsFailed).not.toHaveBeenCalled();
    expect(service.processSuccessfulPayment).not.toHaveBeenCalled();
  });

  it('does NOT fail a row where money was received without clean success (PARTIALLY_PAID/OVERPAID)', async () => {
    const payment = makePayment();
    buildService(payment);
    gatewayVerify.mockResolvedValue(
      verifyResult({
        status: 'pending',
        rawStatus: 'PARTIALLY_PAID',
        moneyReceived: true,
      }),
    );

    await service.checkExpiredPayments();

    expect(service.markAsFailed).not.toHaveBeenCalled();
    expect(service.processSuccessfulPayment).not.toHaveBeenCalled();
    // Surfaced for ops.
    expect(logger.error).toHaveBeenCalled();
  });

  it('fails a payment the gateway reports failed', async () => {
    const payment = makePayment();
    buildService(payment);
    gatewayVerify.mockResolvedValue(
      verifyResult({ status: 'failed', rawStatus: 'EXPIRED' }),
    );

    await service.checkExpiredPayments();

    expect(service.markAsFailed).toHaveBeenCalledWith(
      'pay-1',
      expect.objectContaining({ reason: 'timeout' }),
    );
  });

  it('force-fails a still-pending payment older than the 24h long-stop', async () => {
    const payment = makePayment({
      created_at: new Date(NOW.getTime() - 25 * 60 * 60 * 1000),
    });
    buildService(payment);
    gatewayVerify.mockResolvedValue(verifyResult({ status: 'pending' }));

    await service.checkExpiredPayments();

    expect(service.markAsFailed).toHaveBeenCalledWith(
      'pay-1',
      expect.objectContaining({ reason: 'timeout_longstop' }),
    );
  });

  it('classifies a never-initiated payment (gateway has no such reference) as never_initiated', async () => {
    const payment = makePayment();
    buildService(payment);
    gatewayVerify.mockRejectedValue(
      new GatewayReferenceNotFoundError('RENEWAL_1_abc'),
    );

    await service.checkExpiredPayments();

    expect(service.markAsFailed).toHaveBeenCalledWith(
      'pay-1',
      expect.objectContaining({ reason: 'never_initiated' }),
    );
  });

  it('does NOT fail on a transient verify error (network/5xx)', async () => {
    const payment = makePayment();
    buildService(payment);
    gatewayVerify.mockRejectedValue(new Error('ECONNRESET'));

    await service.checkExpiredPayments();

    expect(service.markAsFailed).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});

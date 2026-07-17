import { PaymentReconciliationService } from '../../src/payments/payment-reconciliation.service';
import {
  PaymentIntent,
  PaymentIntentLane,
  PaymentIntentStatus,
} from '../../src/payments/entities/payment-intent.entity';
import {
  GatewayReferenceNotFoundError,
  VerifyPaymentResult,
} from '../../src/payments/gateway/payment-gateway.interface';

/**
 * Money-safety tests for the reconciliation sweep — the safety net that credits
 * payments whose webhook AND browser-return both failed.
 *
 * Mirrors payment-cron-expiry.spec.ts: stub the deps, spy on the lane
 * processors, and assert only the DECISION the sweep makes per verify result.
 * We never exercise a real credit path here — those are the processors' own
 * tests. What must not regress is WHICH processor is called, and when a row is
 * allowed to become terminal.
 */
describe('PaymentReconciliationService.reconcilePendingIntents', () => {
  const NOW = new Date('2026-07-16T12:00:00.000Z');
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;

  const makeIntent = (
    overrides: Partial<PaymentIntent> = {},
  ): PaymentIntent => ({
    id: 'intent-1',
    reference: 'RENEWAL_1_abc',
    gateway: 'monnify',
    lane: PaymentIntentLane.RENEWAL,
    amount_naira: 1_200_000,
    status: PaymentIntentStatus.PENDING,
    related_entity_id: 'invoice-1',
    checkout_url: null,
    gateway_transaction_id: null,
    // property_id is load-bearing, not decoration: recordAmountMismatchArtifact
    // can only attach an ops row to a property, and silently degrades to a log
    // without it. Every init site stamps it.
    metadata: {
      renewal_invoice_id: 'invoice-1',
      property_id: 'property-1',
      tenant_id: 'tenant-1',
      payment_option: 'custom',
    },
    verify_attempts: 0,
    last_verified_at: null,
    resolved_at: null,
    // Older than Monnify's 40-min checkout window by default.
    created_at: new Date(NOW.getTime() - 2 * HOUR),
    updated_at: new Date(NOW.getTime() - 2 * HOUR),
    ...overrides,
  });

  const verifyResult = (
    overrides: Partial<VerifyPaymentResult> = {},
  ): VerifyPaymentResult => ({
    status: 'pending',
    rawStatus: 'PENDING',
    moneyReceived: false,
    reference: 'RENEWAL_1_abc',
    amountNaira: 1_200_000,
    channel: 'bank_transfer',
    paidAt: null,
    metadata: {
      renewal_invoice_id: 'invoice-1',
      property_id: 'property-1',
      tenant_id: 'tenant-1',
      payment_option: 'custom',
    },
    gateway: 'monnify',
    raw: {},
    ...overrides,
  });

  let service: PaymentReconciliationService;
  let intentRepo: { find: jest.Mock; update: jest.Mock };
  let historyRepo: { find: jest.Mock; save: jest.Mock; create: jest.Mock };
  let gatewayVerify: jest.Mock;
  let renewal: { processWebhookPayment: jest.Mock };
  let adHoc: { markInvoicePaidFromWebhook: jest.Mock };
  let plans: {
    markInstallmentPaidFromWebhook: jest.Mock;
    markPlanPaidOffFromWebhook: jest.Mock;
  };
  let logger: any;

  const buildService = (intents: PaymentIntent[]) => {
    intentRepo = {
      find: jest.fn().mockResolvedValue(intents),
      update: jest.fn().mockResolvedValue(undefined),
    };
    historyRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((x) => x),
    };
    gatewayVerify = jest.fn();
    renewal = { processWebhookPayment: jest.fn().mockResolvedValue(undefined) };
    adHoc = {
      markInvoicePaidFromWebhook: jest.fn().mockResolvedValue(undefined),
    };
    plans = {
      markInstallmentPaidFromWebhook: jest.fn().mockResolvedValue(undefined),
      markPlanPaidOffFromWebhook: jest.fn().mockResolvedValue(undefined),
    };
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    const registry = {
      get: jest.fn(() => ({
        verifyPayment: gatewayVerify,
        checkoutExpiryMinutes: 40,
      })),
      // The cross-gateway fallback only runs after the row's OWN gateway
      // returned a definitive not-found. Default it to not-found too — i.e.
      // "no gateway has this reference" — which is the real shape of an
      // orphaned intent. Tests that want a mislabelled row override it.
      verifyByReference: jest
        .fn()
        .mockRejectedValue(new GatewayReferenceNotFoundError('RENEWAL_1_abc')),
      names: jest.fn(() => ['monnify', 'paystack']),
    };

    service = new PaymentReconciliationService(
      intentRepo as any,
      historyRepo as any,
      registry as any,
      logger,
      renewal as any,
      adHoc as any,
      plans as any,
    );
  };

  /** The status the sweep wrote for the (single) intent under test. */
  const writtenStatus = () =>
    intentRepo.update.mock.calls
      .map(([, patch]) => patch.status)
      .filter(Boolean)
      .pop();

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  describe('lane dispatch', () => {
    // The whole design rests on the sweep replaying the webhook rather than
    // re-implementing credit. If a lane routes to the wrong processor, money
    // lands on the wrong record.
    it.each([
      [PaymentIntentLane.RENEWAL, 'renewal'],
      [PaymentIntentLane.AD_HOC_INVOICE, 'adHoc'],
      [PaymentIntentLane.PAYMENT_PLAN_INSTALLMENT, 'installment'],
      [PaymentIntentLane.PAYMENT_PLAN_PAYOFF, 'payoff'],
    ])(
      'lane %s dispatches to its own processor and nothing else',
      async (lane) => {
        buildService([makeIntent({ lane })]);
        gatewayVerify.mockResolvedValue(
          verifyResult({
            status: 'success',
            rawStatus: 'PAID',
            moneyReceived: true,
          }),
        );

        await service.reconcilePendingIntents();

        const calls = {
          renewal: renewal.processWebhookPayment.mock.calls.length,
          adHoc: adHoc.markInvoicePaidFromWebhook.mock.calls.length,
          installment: plans.markInstallmentPaidFromWebhook.mock.calls.length,
          payoff: plans.markPlanPaidOffFromWebhook.mock.calls.length,
        };
        // Exactly one processor fired.
        expect(Object.values(calls).reduce((a, b) => a + b, 0)).toBe(1);
        expect(writtenStatus()).toBe(PaymentIntentStatus.RESOLVED);
      },
    );

    it('parks an unknown lane instead of silently never reconciling it', async () => {
      buildService([
        makeIntent({ lane: 'brand_new_lane' as PaymentIntentLane }),
      ]);
      gatewayVerify.mockResolvedValue(
        verifyResult({
          status: 'success',
          rawStatus: 'PAID',
          moneyReceived: true,
        }),
      );

      await service.reconcilePendingIntents();

      expect(renewal.processWebhookPayment).not.toHaveBeenCalled();
      expect(writtenStatus()).not.toBe(PaymentIntentStatus.RESOLVED);
    });
  });

  describe('decision table', () => {
    it('credits a success and marks the intent resolved', async () => {
      buildService([makeIntent()]);
      const v = verifyResult({
        status: 'success',
        rawStatus: 'PAID',
        moneyReceived: true,
      });
      gatewayVerify.mockResolvedValue(v);

      await service.reconcilePendingIntents();

      expect(renewal.processWebhookPayment).toHaveBeenCalledTimes(1);
      expect(writtenStatus()).toBe(PaymentIntentStatus.RESOLVED);
    });

    it('marks a gateway-reported failure as failed without crediting', async () => {
      buildService([makeIntent()]);
      gatewayVerify.mockResolvedValue(
        verifyResult({ status: 'failed', rawStatus: 'FAILED' }),
      );

      await service.reconcilePendingIntents();

      expect(renewal.processWebhookPayment).not.toHaveBeenCalled();
      expect(writtenStatus()).toBe(PaymentIntentStatus.FAILED);
    });

    it('marks a reference no gateway has ever seen as failed (never initiated)', async () => {
      buildService([makeIntent()]);
      gatewayVerify.mockRejectedValue(
        new GatewayReferenceNotFoundError('RENEWAL_1_abc'),
      );

      await service.reconcilePendingIntents();

      expect(writtenStatus()).toBe(PaymentIntentStatus.FAILED);
    });

    it('leaves a still-payable checkout alone (inside the 40-min window)', async () => {
      buildService([
        makeIntent({ created_at: new Date(NOW.getTime() - 10 * MINUTE) }),
      ]);
      gatewayVerify.mockResolvedValue(verifyResult({ status: 'pending' }));

      await service.reconcilePendingIntents();

      expect(renewal.processWebhookPayment).not.toHaveBeenCalled();
      expect(writtenStatus()).toBeUndefined(); // touched only
    });

    it('abandons a still-unpaid intent past the 24h long-stop', async () => {
      buildService([
        makeIntent({ created_at: new Date(NOW.getTime() - 25 * HOUR) }),
      ]);
      gatewayVerify.mockResolvedValue(verifyResult({ status: 'pending' }));

      await service.reconcilePendingIntents();

      expect(writtenStatus()).toBe(PaymentIntentStatus.ABANDONED);
    });
  });

  describe('money-safety', () => {
    // Monnify maps PARTIALLY_PAID/OVERPAID to pending+moneyReceived. Real money
    // is sitting at the gateway; auto-failing it would bury it.
    it.each(['PARTIALLY_PAID', 'OVERPAID'])(
      'never auto-fails a %s intent, and writes an ops artifact',
      async (rawStatus) => {
        buildService([makeIntent()]);
        gatewayVerify.mockResolvedValue(
          verifyResult({ status: 'pending', rawStatus, moneyReceived: true }),
        );

        await service.reconcilePendingIntents();

        expect(writtenStatus()).not.toBe(PaymentIntentStatus.FAILED);
        expect(writtenStatus()).not.toBe(PaymentIntentStatus.ABANDONED);
        expect(historyRepo.save).toHaveBeenCalledTimes(1);
      },
    );

    // The branch-ORDER regression: a money-holding row that is also past the
    // long-stop must NOT be swept into `abandoned` by the age rule.
    it('does NOT abandon a money-holding intent that is past the 24h long-stop', async () => {
      buildService([
        makeIntent({ created_at: new Date(NOW.getTime() - 30 * HOUR) }),
      ]);
      gatewayVerify.mockResolvedValue(
        verifyResult({
          status: 'pending',
          rawStatus: 'PARTIALLY_PAID',
          moneyReceived: true,
        }),
      );

      await service.reconcilePendingIntents();

      expect(writtenStatus()).not.toBe(PaymentIntentStatus.ABANDONED);
      expect(writtenStatus()).toBe(PaymentIntentStatus.ERROR); // parked for a human
      expect(historyRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('metadata fallback', () => {
    // Both adapters can return metadata that is empty but TRUTHY ({} / []), so
    // `??` would let it win and the processor would throw on missing ids.
    it.each([[{}], [[] as any]])(
      'falls back to the stored metadata when the gateway echoes %p',
      async (empty) => {
        buildService([makeIntent()]);
        gatewayVerify.mockResolvedValue(
          verifyResult({
            status: 'success',
            rawStatus: 'PAID',
            moneyReceived: true,
            metadata: empty,
          }),
        );

        await service.reconcilePendingIntents();

        const event = renewal.processWebhookPayment.mock.calls[0][0];
        // The stored copy, intact — without this the processor throws on the
        // missing renewal_invoice_id and the payment never credits.
        expect(event.metadata).toEqual(makeIntent().metadata);
        expect(event.metadata.renewal_invoice_id).toBe('invoice-1');
      },
    );

    it('prefers the gateway metadata when it is populated', async () => {
      buildService([makeIntent()]);
      gatewayVerify.mockResolvedValue(
        verifyResult({
          status: 'success',
          rawStatus: 'PAID',
          moneyReceived: true,
          metadata: { renewal_invoice_id: 'from-gateway' },
        }),
      );

      await service.reconcilePendingIntents();

      const event = renewal.processWebhookPayment.mock.calls[0][0];
      expect(event.metadata).toEqual({ renewal_invoice_id: 'from-gateway' });
    });
  });

  describe('resilience', () => {
    it('isolates a throwing intent so the rest of the batch still runs', async () => {
      buildService([
        makeIntent({ id: 'intent-1', reference: 'RENEWAL_boom' }),
        makeIntent({ id: 'intent-2', reference: 'RENEWAL_ok' }),
      ]);
      gatewayVerify
        .mockRejectedValueOnce(new Error('gateway 500'))
        .mockResolvedValueOnce(
          verifyResult({
            status: 'success',
            rawStatus: 'PAID',
            moneyReceived: true,
          }),
        );

      await service.reconcilePendingIntents();

      expect(renewal.processWebhookPayment).toHaveBeenCalledTimes(1);
    });

    it('parks an intent whose verify has failed too many times', async () => {
      buildService([makeIntent({ verify_attempts: 7 })]); // cap is 8
      gatewayVerify.mockRejectedValue(new Error('gateway 500'));

      await service.reconcilePendingIntents();

      expect(writtenStatus()).toBe(PaymentIntentStatus.ERROR);
    });

    // A capped sweep that looks complete is how a backlog hides.
    it('logs when it hits the batch cap rather than truncating silently', async () => {
      buildService(
        Array.from({ length: 101 }, (_, i) =>
          makeIntent({ id: `intent-${i}`, reference: `RENEWAL_${i}` }),
        ),
      );
      gatewayVerify.mockResolvedValue(verifyResult({ status: 'pending' }));

      await service.reconcilePendingIntents();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('batch cap'),
        expect.anything(),
      );
    });
  });
});

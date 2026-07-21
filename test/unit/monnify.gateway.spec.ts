import * as crypto from 'crypto';
import { of, throwError } from 'rxjs';
import { MonnifyGateway } from '../../src/payments/gateway/monnify.gateway';
import {
  DuplicateReferenceError,
  GatewayReferenceNotFoundError,
} from '../../src/payments/gateway/payment-gateway.interface';

const SECRET = 'monnify_secret';
const API_KEY = 'MK_TEST_key';
const CONTRACT = 'CONTRACT123';

const envelope = <T>(responseBody: T, overrides: Partial<any> = {}) => ({
  requestSuccessful: true,
  responseMessage: 'success',
  responseCode: '0',
  responseBody,
  ...overrides,
});

const axiosOk = (data: unknown) => of({ data } as any);

const axios4xx = (status: number, data: unknown) =>
  throwError(() => ({
    isAxiosError: true,
    response: { status, data },
    message: `Request failed with status code ${status}`,
  }));

describe('MonnifyGateway', () => {
  let gateway: MonnifyGateway;

  const mockHttpService = { get: jest.fn(), post: jest.fn() };
  const env: Record<string, string | undefined> = {};
  const mockConfigService = { get: jest.fn((key: string) => env[key]) };

  const loginResponse = () =>
    axiosOk(envelope({ accessToken: 'token_1', expiresIn: 3600 }));

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(env)) delete env[key];
    env.MONNIFY_API_KEY = API_KEY;
    env.MONNIFY_SECRET_KEY = SECRET;
    env.MONNIFY_CONTRACT_CODE = CONTRACT;
    gateway = new MonnifyGateway(
      mockHttpService as any,
      mockConfigService as any,
    );
  });

  describe('token management', () => {
    it('logs in once for concurrent calls (single-flight) and reuses the cached token', async () => {
      mockHttpService.post.mockReturnValueOnce(loginResponse());
      mockHttpService.get.mockReturnValue(
        axiosOk(
          envelope({
            paymentStatus: 'PAID',
            paymentReference: 'REF',
            amountPaid: 100,
            totalPayable: 100,
            paymentMethod: 'CARD',
            paidOn: '2026-07-15 10:00:00.0',
            metaData: {},
          }),
        ),
      );

      await Promise.all([
        gateway.verifyPayment('REF'),
        gateway.verifyPayment('REF'),
      ]);
      await gateway.verifyPayment('REF');

      const loginCalls = mockHttpService.post.mock.calls.filter(([url]) =>
        String(url).includes('/api/v1/auth/login'),
      );
      expect(loginCalls).toHaveLength(1);
      expect(loginCalls[0][2].headers.Authorization).toBe(
        `Basic ${Buffer.from(`${API_KEY}:${SECRET}`).toString('base64')}`,
      );
    });

    it('re-logs in and retries once on a 401', async () => {
      mockHttpService.post
        .mockReturnValueOnce(loginResponse()) // initial login
        .mockReturnValueOnce(
          axiosOk(envelope({ accessToken: 'token_2', expiresIn: 3600 })),
        ); // re-login
      mockHttpService.get
        .mockReturnValueOnce(axios4xx(401, {})) // expired token
        .mockReturnValueOnce(
          axiosOk(
            envelope({
              paymentStatus: 'PAID',
              paymentReference: 'REF',
              amountPaid: 100,
              totalPayable: 100,
              paymentMethod: 'CARD',
              paidOn: null,
              metaData: {},
            }),
          ),
        );

      const result = await gateway.verifyPayment('REF');
      expect(result.status).toBe('success');
      expect(mockHttpService.get).toHaveBeenCalledTimes(2);
    });

    it('boots without creds and only fails at first use with a 503', async () => {
      delete env.MONNIFY_API_KEY;
      const keyless = new MonnifyGateway(
        mockHttpService as any,
        mockConfigService as any,
      );
      await expect(keyless.verifyPayment('REF')).rejects.toMatchObject({
        status: 503,
      });
      expect(mockHttpService.get).not.toHaveBeenCalled();
    });
  });

  describe('initializePayment', () => {
    beforeEach(() => {
      mockHttpService.post.mockImplementation((url: string) => {
        if (url.includes('/api/v1/auth/login')) return loginResponse();
        return axiosOk(
          envelope({
            transactionReference: 'MNFY|12|20260715|000001',
            paymentReference: 'RENEWAL_1_abc',
            checkoutUrl: 'https://sandbox.sdk.monnify.com/checkout/xyz',
          }),
        );
      });
    });

    it('sends naira untouched with contractCode, our reference, translated channels, and metaData', async () => {
      const result = await gateway.initializePayment({
        amountNaira: 150000.5,
        email: 't@x.com',
        customerName: 'Ada Obi',
        reference: 'RENEWAL_1_abc',
        callbackUrl: 'https://app/renewal-invoice/tok',
        metadata: { renewal_invoice_id: 'inv-1' },
        channels: ['card', 'bank_transfer'],
      });

      const initCall = mockHttpService.post.mock.calls.find(([url]) =>
        String(url).includes('init-transaction'),
      );
      expect(initCall[1]).toEqual(
        expect.objectContaining({
          amount: 150000.5, // NAIRA — no kobo conversion
          customerName: 'Ada Obi',
          customerEmail: 't@x.com',
          paymentReference: 'RENEWAL_1_abc',
          currencyCode: 'NGN',
          contractCode: CONTRACT,
          redirectUrl: 'https://app/renewal-invoice/tok',
          paymentMethods: ['CARD', 'ACCOUNT_TRANSFER'],
          metaData: { renewal_invoice_id: 'inv-1' },
        }),
      );
      expect(result).toEqual({
        reference: 'RENEWAL_1_abc',
        checkoutUrl: 'https://sandbox.sdk.monnify.com/checkout/xyz',
        gatewayTransactionId: 'MNFY|12|20260715|000001',
        gateway: 'monnify',
      });
    });

    it('maps a duplicate paymentReference rejection to DuplicateReferenceError', async () => {
      mockHttpService.post.mockImplementation((url: string) => {
        if (url.includes('/api/v1/auth/login')) return loginResponse();
        return axios4xx(
          400,
          envelope(null, {
            requestSuccessful: false,
            responseMessage: 'Duplicate payment reference',
          }),
        );
      });

      await expect(
        gateway.initializePayment({
          amountNaira: 100,
          email: 't@x.com',
          reference: 'RENEWAL_dup',
          callbackUrl: 'https://app/x',
          metadata: {},
        }),
      ).rejects.toBeInstanceOf(DuplicateReferenceError);
    });
  });

  describe('initializeBankTransfer', () => {
    const TXN_REF = 'MNFY|12|20260721|000042';

    const transferBody = (overrides: Record<string, any> = {}) => ({
      accountNumber: '6912037290',
      accountName: 'PROPERTY KRAFT-PRO',
      bankName: 'Moniepoint Microfinance Bank',
      bankCode: '50515',
      accountDurationSeconds: 2400,
      amount: 2000,
      fee: 0,
      totalPayable: 2000,
      paymentReference: 'INV_1_abc',
      ...overrides,
    });

    const mockTransferInit = (body: any) => {
      mockHttpService.post.mockImplementation((url: string) => {
        if (url.includes('/api/v1/auth/login')) return loginResponse();
        if (url.includes('/bank-transfer/init-payment')) return body;
        return axiosOk(envelope(null));
      });
    };

    it('POSTs the piped transactionReference and normalizes the account details', async () => {
      mockTransferInit(axiosOk(envelope(transferBody())));

      const result = await gateway.initializeBankTransfer(TXN_REF);

      const call = mockHttpService.post.mock.calls.find(([url]) =>
        String(url).includes('/bank-transfer/init-payment'),
      );
      expect(call[1]).toEqual({ transactionReference: TXN_REF });
      expect(result).toEqual({
        bankName: 'Moniepoint Microfinance Bank',
        bankCode: '50515',
        accountNumber: '6912037290',
        accountName: 'PROPERTY KRAFT-PRO',
        expiresInSeconds: 2400,
        amountNaira: 2000,
        feeNaira: 0,
      });
    });

    it('coerces string amounts/duration (Monnify sends strings) and prefers totalPayable', async () => {
      mockTransferInit(
        axiosOk(
          envelope(
            transferBody({
              accountDurationSeconds: '1187',
              amount: '2000.00',
              fee: '10.75',
              totalPayable: '2010.75',
            }),
          ),
        ),
      );

      const result = await gateway.initializeBankTransfer(TXN_REF);
      expect(result).toMatchObject({
        expiresInSeconds: 1187,
        amountNaira: 2010.75, // totalPayable wins — it's what the payer must send
        feeNaira: 10.75,
      });
    });

    it('falls back to the documented 2400s when accountDurationSeconds is malformed', async () => {
      mockTransferInit(
        axiosOk(envelope(transferBody({ accountDurationSeconds: 'soon' }))),
      );
      const result = await gateway.initializeBankTransfer(TXN_REF);
      expect(result?.expiresInSeconds).toBe(2400);
    });

    it('falls back to amount when totalPayable is absent', async () => {
      mockTransferInit(
        axiosOk(envelope(transferBody({ totalPayable: undefined }))),
      );
      const result = await gateway.initializeBankTransfer(TXN_REF);
      expect(result?.amountNaira).toBe(2000);
    });

    it('throws 502 GatewayTransferInitFailed on an unsuccessful envelope', async () => {
      mockTransferInit(
        axiosOk(
          envelope(null, {
            requestSuccessful: false,
            responseMessage: 'Cannot generate account',
          }),
        ),
      );
      await expect(gateway.initializeBankTransfer(TXN_REF)).rejects.toMatchObject({
        status: 502,
      });
    });

    it('throws 502 when the envelope succeeds but carries no accountNumber', async () => {
      mockTransferInit(
        axiosOk(envelope(transferBody({ accountNumber: undefined }))),
      );
      await expect(gateway.initializeBankTransfer(TXN_REF)).rejects.toMatchObject({
        status: 502,
      });
    });

    it('passes deterministic 4xx failures straight through (no retry burn)', async () => {
      mockTransferInit(
        axios4xx(
          422,
          envelope(null, {
            requestSuccessful: false,
            responseMessage: 'Invalid transaction reference',
          }),
        ),
      );
      await expect(gateway.initializeBankTransfer(TXN_REF)).rejects.toMatchObject(
        { response: { status: 422 } },
      );
      // one login + one transfer call — no retries on a deterministic 4xx
      const transferCalls = mockHttpService.post.mock.calls.filter(([url]) =>
        String(url).includes('/bank-transfer/init-payment'),
      );
      expect(transferCalls).toHaveLength(1);
    });
  });

  describe('verifyPayment', () => {
    const verifyResponse = (overrides: Record<string, any>) =>
      axiosOk(
        envelope({
          paymentStatus: 'PAID',
          paymentReference: 'INV_1_abc',
          transactionReference: 'MNFY|12|x',
          amountPaid: 2500,
          totalPayable: 2500,
          paymentMethod: 'ACCOUNT_TRANSFER',
          paidOn: '2026-07-15 10:23:45.123',
          metaData: { ad_hoc_invoice_id: 'a1' },
          ...overrides,
        }),
      );

    beforeEach(() => {
      mockHttpService.post.mockReturnValue(loginResponse());
    });

    it('queries by paymentReference (v2, URL-encoded) and maps PAID → success', async () => {
      mockHttpService.get.mockReturnValue(verifyResponse({}));

      const result = await gateway.verifyPayment('INV_1_abc');

      expect(mockHttpService.get.mock.calls[0][0]).toContain(
        '/api/v2/merchant/transactions/query?paymentReference=INV_1_abc',
      );
      expect(result.status).toBe('success');
      expect(result.moneyReceived).toBe(true);
      expect(result.amountNaira).toBe(2500); // naira passthrough
      expect(result.channel).toBe('bank_transfer'); // normalized
      expect(result.paidAt).toEqual(new Date('2026-07-15T10:23:45.123+01:00'));
      expect(result.metadata).toEqual({ ad_hoc_invoice_id: 'a1' });
      expect(result.gateway).toBe('monnify');
    });

    // VERBATIM from a real sandbox webhook (captured 2026-07-16): Monnify sends
    // EIGHT fractional-second digits, not milliseconds. The old `\d{1,3}` cap
    // made the whole pattern fail, so every webhook-credited payment silently
    // recorded paidAt=null — and the invented '.123' fixture above never caught
    // it. Do not "tidy" this value.
    it('parses the 8-fractional-digit timestamp a real webhook actually sends', async () => {
      mockHttpService.get.mockReturnValue(
        verifyResponse({ paidOn: '2026-07-16 14:25:16.89802504' }),
      );

      const result = await gateway.verifyPayment('INV_1_abc');

      expect(result.paidAt).not.toBeNull();
      // Sub-millisecond precision is dropped, not rounded.
      expect(result.paidAt).toEqual(new Date('2026-07-16T14:25:16.898+01:00'));
    });

    it('URL-encodes references', async () => {
      mockHttpService.get.mockReturnValue(verifyResponse({}));
      await gateway.verifyPayment('MNFY|12|weird ref');
      expect(mockHttpService.get.mock.calls[0][0]).toContain(
        encodeURIComponent('MNFY|12|weird ref'),
      );
    });

    it.each([
      ['PARTIALLY_PAID', 'pending', true],
      ['OVERPAID', 'pending', true],
      ['PENDING', 'pending', false],
      ['FAILED', 'failed', false],
      ['EXPIRED', 'failed', false],
      ['REVERSED', 'failed', false],
    ])(
      'maps %s → %s with moneyReceived=%s',
      async (rawStatus, expected, moneyReceived) => {
        mockHttpService.get.mockReturnValue(
          verifyResponse({ paymentStatus: rawStatus, paidOn: null }),
        );
        const result = await gateway.verifyPayment('INV_1_abc');
        expect(result.status).toBe(expected);
        expect(result.moneyReceived).toBe(moneyReceived);
        expect(result.rawStatus).toBe(rawStatus);
      },
    );

    it('coerces string amounts and survives the query-API day-first date format', async () => {
      mockHttpService.get.mockReturnValue(
        verifyResponse({
          amountPaid: '2500.00',
          totalPayable: '2500.00',
          paidOn: '15/7/2026 1:05:09 PM',
        }),
      );
      const result = await gateway.verifyPayment('INV_1_abc');
      expect(result.amountNaira).toBe(2500);
      expect(result.paidAt).toEqual(new Date('2026-07-15T13:05:09+01:00'));
    });

    it('returns null paidAt (never Invalid Date) for null/garbage dates', async () => {
      mockHttpService.get.mockReturnValue(
        verifyResponse({ paidOn: 'not a date' }),
      );
      const result = await gateway.verifyPayment('INV_1_abc');
      expect(result.paidAt).toBeNull();
    });

    // VERBATIM sandbox response for an unknown reference (captured 2026-07-15):
    // HTTP 404 + responseCode "99" + this exact wording. Do not "tidy" this
    // string — an invented message like 'Transaction not found' is what let a
    // looksLikeNotFound regex that never matched Monnify ship unnoticed.
    const REAL_NOT_FOUND_MESSAGE =
      'Could not find transaction with payment reference NOPE for merchant';

    it('maps a definitive not-found to GatewayReferenceNotFoundError', async () => {
      mockHttpService.get.mockReturnValue(
        axios4xx(
          404,
          envelope(null, {
            requestSuccessful: false,
            responseCode: '99',
            responseMessage: REAL_NOT_FOUND_MESSAGE,
          }),
        ),
      );
      await expect(gateway.verifyPayment('NOPE')).rejects.toBeInstanceOf(
        GatewayReferenceNotFoundError,
      );
    });

    // The 404 above is the primary signal; this pins the wording fallback on
    // its own. Monnify says "could not FIND", so /not\s*found/ never matched —
    // without /could\s*not\s*find/ the legacy-Paystack cutover fallback would
    // rest entirely on the status check.
    it('recognizes the real not-found wording on a non-404 4xx (regex fallback)', async () => {
      mockHttpService.get.mockReturnValue(
        axios4xx(
          400,
          envelope(null, {
            requestSuccessful: false,
            responseCode: '99',
            responseMessage: REAL_NOT_FOUND_MESSAGE,
          }),
        ),
      );
      await expect(gateway.verifyPayment('NOPE')).rejects.toBeInstanceOf(
        GatewayReferenceNotFoundError,
      );
    });

    it('passes 5xx transients through untouched (after retries) — never a fake not-found', async () => {
      mockHttpService.get.mockReturnValue(
        axios4xx(503, { requestSuccessful: false, responseMessage: 'oops' }),
      );
      await expect(gateway.verifyPayment('REF')).rejects.not.toBeInstanceOf(
        GatewayReferenceNotFoundError,
      );
    }, 15000);
  });

  describe('verifyWebhookSignature', () => {
    const rawBody = JSON.stringify({
      eventType: 'SUCCESSFUL_TRANSACTION',
      eventData: {},
    });
    const validSignature = crypto
      .createHmac('sha512', SECRET)
      .update(rawBody)
      .digest('hex');

    it('accepts a valid HMAC-SHA512 signature', () => {
      expect(
        gateway.verifyWebhookSignature(rawBody, {
          'monnify-signature': validSignature,
        }),
      ).toBe(true);
    });

    it('rejects an invalid signature', () => {
      expect(
        gateway.verifyWebhookSignature(rawBody, {
          'monnify-signature': 'f'.repeat(validSignature.length),
        }),
      ).toBe(false);
    });

    it('rejects a missing signature by default (all environments)', () => {
      expect(gateway.verifyWebhookSignature(rawBody, {})).toBe(false);
    });

    it('accepts a missing signature ONLY behind the explicit escape hatch', () => {
      env.MONNIFY_ALLOW_UNSIGNED_WEBHOOKS = 'true';
      expect(gateway.verifyWebhookSignature(rawBody, {})).toBe(true);
    });
  });

  describe('parseWebhookEvent', () => {
    it('maps SUCCESSFUL_TRANSACTION with PAID to payment.success', async () => {
      const event = await gateway.parseWebhookEvent({
        eventType: 'SUCCESSFUL_TRANSACTION',
        eventData: {
          paymentReference: 'PLAN_1_abc',
          transactionReference: 'MNFY|12|x',
          amountPaid: '5000',
          totalPayable: '5000',
          paymentStatus: 'PAID',
          paymentMethod: 'CARD',
          paidOn: '2026-07-15 10:00:00.0',
          metaData: { payment_plan_installment_id: 'i1' },
        },
      });

      expect(event.type).toBe('payment.success');
      expect(event.reference).toBe('PLAN_1_abc');
      expect(event.amountNaira).toBe(5000);
      expect(event.channel).toBe('card');
      expect(event.metadata).toEqual({ payment_plan_installment_id: 'i1' });
      expect(event.gateway).toBe('monnify');
    });

    it('maps SUCCESSFUL_TRANSACTION with PARTIALLY_PAID to payment.amount_mismatch (never silent other)', async () => {
      const event = await gateway.parseWebhookEvent({
        eventType: 'SUCCESSFUL_TRANSACTION',
        eventData: {
          paymentReference: 'RENEWAL_1_abc',
          amountPaid: 3000,
          totalPayable: 5000,
          paymentStatus: 'PARTIALLY_PAID',
          paymentMethod: 'ACCOUNT_TRANSFER',
          metaData: { renewal_invoice_id: 'r1' },
        },
      });

      expect(event.type).toBe('payment.amount_mismatch');
      expect(event.gatewayResponse).toContain('PARTIALLY_PAID');
    });

    it.each(['REJECTED_PAYMENT', 'REJECTED_PAYMENTS', 'rejected_payment'])(
      'maps %s to transfer.rejected with rejection info',
      async (eventType) => {
        const event = await gateway.parseWebhookEvent({
          eventType,
          eventData: {
            paymentReference: 'RENEWAL_1_abc',
            amountPaid: 3000,
            paymentRejectionInformation: {
              rejectionReason: 'UNDER_PAYMENT',
              expectedAmount: 5000,
            },
            metaData: { renewal_invoice_id: 'r1' },
          },
        });

        expect(event.type).toBe('transfer.rejected');
        expect(event.gatewayResponse).toContain('UNDER_PAYMENT');
        expect(event.gatewayResponse).toContain('5,000');
        expect(event.metadata).toEqual({ renewal_invoice_id: 'r1' });
      },
    );

    it('parseWebhookEvent is shape-only — does NOT hydrate (no network call before the 200)', async () => {
      mockHttpService.post.mockReturnValue(loginResponse());
      mockHttpService.get.mockReturnValue(
        axiosOk(envelope({ paymentStatus: 'FAILED' })),
      );

      const event = gateway.parseWebhookEvent({
        eventType: 'REJECTED_PAYMENT',
        eventData: {
          paymentReference: 'RENEWAL_1_abc',
          amountPaid: 3000,
          // no metaData in the webhook payload
        },
      });

      expect(event.metadata).toBeNull();
      expect(mockHttpService.get).not.toHaveBeenCalled();
    });

    it('hydrateWebhookMetadata fills missing metadata via the query API (deferred path)', async () => {
      mockHttpService.post.mockReturnValue(loginResponse());
      mockHttpService.get.mockReturnValue(
        axiosOk(
          envelope({
            paymentStatus: 'FAILED',
            paymentReference: 'RENEWAL_1_abc',
            amountPaid: 0,
            paymentMethod: null,
            paidOn: null,
            metaData: { renewal_invoice_id: 'r1' },
          }),
        ),
      );

      const parsed = gateway.parseWebhookEvent({
        eventType: 'REJECTED_PAYMENT',
        eventData: { paymentReference: 'RENEWAL_1_abc', amountPaid: 3000 },
      });
      const hydrated = await gateway.hydrateWebhookMetadata(parsed);

      expect(hydrated.metadata).toEqual({ renewal_invoice_id: 'r1' });
      expect(mockHttpService.get).toHaveBeenCalled();
    });

    it('hydrateWebhookMetadata is a no-op when metadata is already present', async () => {
      const parsed = gateway.parseWebhookEvent({
        eventType: 'SUCCESSFUL_TRANSACTION',
        eventData: {
          paymentReference: 'RENEWAL_1_abc',
          amountPaid: 1000,
          paymentStatus: 'PAID',
          metaData: { renewal_invoice_id: 'r1' },
        },
      });
      const hydrated = await gateway.hydrateWebhookMetadata(parsed);

      expect(hydrated).toBe(parsed);
      expect(mockHttpService.get).not.toHaveBeenCalled();
    });

    it('parses JSON-string metaData', () => {
      const event = gateway.parseWebhookEvent({
        eventType: 'SUCCESSFUL_TRANSACTION',
        eventData: {
          paymentReference: 'INV_1_abc',
          amountPaid: 100,
          paymentStatus: 'PAID',
          metaData: '{"ad_hoc_invoice_id":"a1"}',
        },
      });
      expect(event.metadata).toEqual({ ad_hoc_invoice_id: 'a1' });
    });

    it('maps unknown events to other without throwing', () => {
      const event = gateway.parseWebhookEvent({
        eventType: 'SETTLEMENT_COMPLETION',
        eventData: { paymentReference: 'X', amountPaid: 1 },
      });
      expect(event.type).toBe('other');
    });
  });

  it('exposes name, expiry, and source IPs', () => {
    expect(gateway.name).toBe('monnify');
    expect(gateway.checkoutExpiryMinutes).toBe(40);
    expect(gateway.allowedSourceIps()).toEqual(['35.242.133.146']);
  });
});

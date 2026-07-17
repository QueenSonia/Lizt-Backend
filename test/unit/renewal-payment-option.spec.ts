import { RenewalPaymentService } from '../../src/tenancies/renewal-payment.service';

/**
 * Regression guard for a money-losing bug: crediting a payment under the WRONG
 * payment option.
 *
 * `initializePayment` overwrites `invoice.payment_option` on EVERY attempt, and
 * the credit path used to re-read that column. So:
 *
 *   1. tenant starts a `custom` ₦500k payment on a ₦2M invoice, abandons it;
 *   2. tenant starts a `full` payment  → the column flips to 'full';
 *   3. the ₦500k bank transfer settles late.
 *
 * The late payment would then be credited while the column read 'full', and
 * markInvoiceAsPaid's `paymentOption === 'full'` short-circuit would mark a ₦2M
 * invoice PAID for ₦500k — firing rent advance, receipt and WhatsApp with it.
 * The amount guard nearby only logs; it does not stop the credit.
 *
 * The fix: callers pass the option THIS reference was initialized with (read
 * back from the gateway's round-tripped metadata). These tests pin that the
 * override wins over the column, since the sweep makes late credits routine.
 */
describe('RenewalPaymentService.processSuccessfulPayment — payment_option attribution', () => {
  const TOKEN = 'tok-1';
  const REFERENCE = 'RENEWAL_1_abc';

  let service: RenewalPaymentService;
  let markInvoiceAsPaid: jest.Mock;

  /** @param columnOption what a LATER attempt left on invoice.payment_option */
  const buildService = (columnOption: string | null) => {
    const invoice = {
      id: 'invoice-1',
      token: TOKEN,
      // Landlord-token invoice with real rent, so the outstanding-balance
      // guard (tenant token + rent 0) stays out of the way.
      token_type: 'landlord',
      rent_amount: 2_000_000,
      total_amount: 2_000_000,
      payment_option: columnOption,
      payment_history: [],
      property_id: 'property-1',
      tenant_id: 'tenant-1',
      property: { id: 'property-1', owner_id: 'owner-1' },
    };

    const renewalInvoiceRepository = {
      findOne: jest.fn().mockResolvedValue(invoice),
      update: jest.fn().mockResolvedValue(undefined),
    };

    // Stop execution right after the assertion point: everything past
    // markInvoiceAsPaid (receipts, notifications) is out of scope here.
    markInvoiceAsPaid = jest
      .fn()
      .mockRejectedValue(new Error('STOP_AFTER_ASSERT'));

    service = new RenewalPaymentService(
      renewalInvoiceRepository as any, // renewalInvoiceRepository
      {} as any, // propertyHistoryRepository
      {} as any, // propertyRepository
      {} as any, // paymentIntentRepository
      {} as any, // gateway (ACTIVE_PAYMENT_GATEWAY)
      {} as any, // gatewayRegistry
      { markInvoiceAsPaid } as any, // tenanciesService
      {} as any, // notificationService
      {} as any, // eventsGateway
      {} as any, // whatsappNotificationLog
      {} as any, // tenantBalancesService
    );
  };

  /** The 4th arg of markInvoiceAsPaid — the option the credit is attributed to. */
  const creditedOption = () => markInvoiceAsPaid.mock.calls[0][3];

  const credit = async (override?: string | null) => {
    await expect(
      service.processSuccessfulPayment(
        TOKEN,
        REFERENCE,
        500_000, // a PARTIAL amount against the 2M invoice
        undefined, // no receiptToken — skips the QueryBuilder path
        undefined, // no channel
        override,
      ),
    ).rejects.toThrow('STOP_AFTER_ASSERT');
  };

  it('credits under the option the REFERENCE carried, not the column a later attempt left behind', async () => {
    buildService('full'); // a later attempt flipped the column to 'full'

    await credit('custom'); // ...but THIS reference was a custom partial

    expect(creditedOption()).toBe('custom');
    // The bug: 'full' would make markInvoiceAsPaid flip a ₦2M invoice PAID for ₦500k.
    expect(creditedOption()).not.toBe('full');
  });

  it('still honours a matching option (no behaviour change on the happy path)', async () => {
    buildService('full');

    await credit('full');

    expect(creditedOption()).toBe('full');
  });

  it('falls back to the column when no override is given (legacy references)', async () => {
    buildService('custom');

    await credit(undefined);

    expect(creditedOption()).toBe('custom');
  });
});

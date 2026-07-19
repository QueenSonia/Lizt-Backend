import { PropertyHistory } from '../../src/property-history/entities/property-history.entity';
import {
  extractStatedAmount,
  resolveHistoryAmount,
  withAmountInTitle,
} from '../../src/property-history/history-amount.util';

const row = (
  event_type: string,
  event_description: string,
  related?: { id: string; type: string },
) =>
  ({
    event_type,
    event_description,
    related_entity_id: related?.id ?? null,
    related_entity_type: related?.type ?? null,
  }) as unknown as PropertyHistory;

describe('extractStatedAmount', () => {
  it.each([
    [
      'Renewal payment received from Fidelia Amaihwe. Amount: ₦5,000,000, Reference: T123',
      5000000,
    ],
    [
      'Payment made for tenancy renewal for property Ikeja Flat. Amount: ₦5,000,000',
      5000000,
    ],
    ['Fidelia initiated payment of ₦1,250,000 for Ikeja Flat', 1250000],
    ['Installment 1 paid — ₦5,000,000 (paystack)', 5000000],
    ['Installment 2/4 paid — ₦3,531,250 (online)', 3531250],
  ])('reads a labelled amount out of %s', (description, expected) => {
    expect(extractStatedAmount(description)).toBe(expected);
  });

  it('ignores an outstanding balance — it is not the amount paid', () => {
    // payment_completed_partial descriptions read like this. Grabbing the first
    // ₦ here would display the remaining debt as the payment.
    expect(
      extractStatedAmount(
        'Fidelia paid for Ikeja Flat. Outstanding: ₦3,000,000',
      ),
    ).toBeNull();
  });

  it('prefers the labelled amount over a trailing balance', () => {
    expect(
      extractStatedAmount(
        'Outstanding balance payment received from F. Amount: ₦900,000, Remaining: ₦100,000',
      ),
    ).toBe(900000);
  });

  it('returns null for rows written before amounts were logged', () => {
    expect(
      extractStatedAmount(
        'Renewal payment initiated by Fidelia for property Ikeja Flat.',
      ),
    ).toBeNull();
    expect(extractStatedAmount('Fidelia completed full payment')).toBeNull();
    expect(extractStatedAmount(null)).toBeNull();
  });
});

describe('resolveHistoryAmount', () => {
  const payments = new Map([['pay-1', 4200000]]);

  it('prefers the linked payments row over the description', () => {
    expect(
      resolveHistoryAmount(
        row(
          'payment_completed_partial',
          'Fidelia paid for Ikeja Flat. Outstanding: ₦3,000,000',
          { id: 'pay-1', type: 'payment' },
        ),
        payments,
      ),
    ).toBe(4200000);
  });

  it('falls back to the description when the row is not payment-linked', () => {
    expect(
      resolveHistoryAmount(
        row(
          'renewal_payment_received',
          'Renewal payment received from F. Amount: ₦5,000,000, Reference: T1',
          { id: 'inv-1', type: 'renewal_invoice' },
        ),
        payments,
      ),
    ).toBe(5000000);
  });

  it('returns null when neither source has an amount', () => {
    expect(
      resolveHistoryAmount(
        row('payment_completed_full', 'Fidelia completed full payment', {
          id: 'pay-missing',
          type: 'payment',
        }),
        payments,
      ),
    ).toBeNull();
  });
});

describe('withAmountInTitle', () => {
  it('appends the amount', () => {
    expect(withAmountInTitle('Renewal Payment Received', 5000000)).toBe(
      'Renewal Payment Received — ₦5,000,000',
    );
  });

  it('leaves titles that already carry a figure alone', () => {
    const title = 'Installment 1 paid — ₦5,000,000 (paystack)';
    expect(withAmountInTitle(title, 5000000)).toBe(title);
  });

  it('leaves the title alone when there is no amount', () => {
    expect(withAmountInTitle('Payment completed', null)).toBe(
      'Payment completed',
    );
  });
});

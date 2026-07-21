import { fetchBankTransferDetails } from '../../src/payments/gateway/bank-transfer.helper';
import {
  BankTransferDetails,
  InitializePaymentResult,
  PaymentGateway,
} from '../../src/payments/gateway/payment-gateway.interface';

const DETAILS: BankTransferDetails = {
  bankName: 'Moniepoint Microfinance Bank',
  bankCode: '50515',
  accountNumber: '6912037290',
  accountName: 'PROPERTY KRAFT-PRO',
  expiresInSeconds: 2400,
  amountNaira: 2000,
  feeNaira: 0,
};

const initResult = (
  overrides: Partial<InitializePaymentResult> = {},
): InitializePaymentResult => ({
  reference: 'INV_1_abc',
  checkoutUrl: 'https://checkout/x',
  gatewayTransactionId: 'MNFY|12|20260721|000042',
  gateway: 'monnify',
  ...overrides,
});

describe('fetchBankTransferDetails', () => {
  const logger = { warn: jest.fn() };
  beforeEach(() => jest.clearAllMocks());

  it('returns the gateway account details on success', async () => {
    const gateway = {
      initializeBankTransfer: jest.fn().mockResolvedValue(DETAILS),
    } as unknown as PaymentGateway;

    const result = await fetchBankTransferDetails(gateway, initResult(), logger);

    expect(result).toEqual(DETAILS);
    expect(gateway.initializeBankTransfer).toHaveBeenCalledWith(
      'MNFY|12|20260721|000042',
    );
  });

  it('returns null WITHOUT calling the gateway when there is no transactionReference', async () => {
    const gateway = {
      initializeBankTransfer: jest.fn(),
    } as unknown as PaymentGateway;

    const result = await fetchBankTransferDetails(
      gateway,
      initResult({ gatewayTransactionId: null }),
      logger,
    );

    expect(result).toBeNull();
    expect(gateway.initializeBankTransfer).not.toHaveBeenCalled();
  });

  it('passes through a capability-null (Paystack) untouched', async () => {
    const gateway = {
      initializeBankTransfer: jest.fn().mockResolvedValue(null),
    } as unknown as PaymentGateway;

    const result = await fetchBankTransferDetails(gateway, initResult(), logger);

    expect(result).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('NEVER throws — a gateway failure logs a warn and degrades to null (hosted fallback)', async () => {
    const gateway = {
      initializeBankTransfer: jest
        .fn()
        .mockRejectedValue(new Error('Monnify transfer-account init failed')),
    } as unknown as PaymentGateway;

    const result = await fetchBankTransferDetails(gateway, initResult(), logger);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('falling back to hosted checkout'),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('INV_1_abc'),
    );
  });
});

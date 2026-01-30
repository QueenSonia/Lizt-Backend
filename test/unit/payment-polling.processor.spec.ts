import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bull';
import { PaymentPollingProcessor } from '../../src/payments/payment-polling.processor';
import {
  PaystackService,
  PaystackVerifyResponse,
} from '../../src/payments/paystack.service';
import { PaymentService } from '../../src/payments/payment.service';
import { PaystackLogger } from '../../src/payments/paystack-logger.service';
import {
  Payment,
  PaymentStatus,
} from '../../src/payments/entities/payment.entity';

// Helper function to create complete mock Paystack verification response
function createMockVerification(
  overrides: Partial<PaystackVerifyResponse['data']> = {},
): PaystackVerifyResponse {
  return {
    status: true,
    message: 'Verification successful',
    data: {
      id: 123456789,
      domain: 'test',
      status: 'success',
      reference: 'LIZT_1234567890_abc123',
      amount: 50000000,
      message: null,
      gateway_response: 'Successful',
      paid_at: '2024-01-28T10:30:00Z',
      created_at: '2024-01-28T10:00:00Z',
      channel: 'card',
      currency: 'NGN',
      ip_address: '127.0.0.1',
      metadata: {},
      log: null,
      fees: 75000,
      fees_split: null,
      authorization: {
        authorization_code: 'AUTH_code',
        bin: '408408',
        last4: '4081',
        exp_month: '12',
        exp_year: '2030',
        channel: 'card',
        card_type: 'visa ',
        bank: 'TEST BANK',
        country_code: 'NG',
        brand: 'visa',
        reusable: true,
        signature: 'SIG_test',
        account_name: null,
      },
      customer: {
        id: 987654,
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        customer_code: 'CUS_test',
        phone: '+2348012345678',
        metadata: {},
        risk_action: 'default',
      },
      plan: null,
      order_id: null,
      paidAt: '2024-01-28T10:30:00Z',
      createdAt: '2024-01-28T10:00:00Z',
      requested_amount: 50000000,
      pos_transaction_data: null,
      source: null,
      fees_breakdown: null,
      ...overrides,
    },
  };
}

describe('PaymentPollingProcessor', () => {
  let processor: PaymentPollingProcessor;
  let paystackService: jest.Mocked<PaystackService>;
  let paymentService: jest.Mocked<PaymentService>;
  let paystackLogger: jest.Mocked<PaystackLogger>;

  const mockJob = {
    data: {
      paymentId: 'payment-123',
      reference: 'LIZT_1234567890_abc123',
    },
    attemptsMade: 0,
  } as Job;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentPollingProcessor,
        {
          provide: PaystackService,
          useValue: {
            verifyTransaction: jest.fn(),
          },
        },
        {
          provide: PaymentService,
          useValue: {
            findById: jest.fn(),
            processSuccessfulPayment: jest.fn(),
            markAsFailed: jest.fn(),
          },
        },
        {
          provide: PaystackLogger,
          useValue: {
            info: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    processor = module.get<PaymentPollingProcessor>(PaymentPollingProcessor);
    paystackService = module.get(PaystackService);
    paymentService = module.get(PaymentService);
    paystackLogger = module.get(PaystackLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handlePaymentVerification', () => {
    it('should process successful payment when status is success and payment is pending', async () => {
      // Arrange
      const mockVerification = createMockVerification();

      const mockPayment = {
        id: 'payment-123',
        status: PaymentStatus.PENDING,
      } as Payment;

      paystackService.verifyTransaction.mockResolvedValue(mockVerification);
      paymentService.findById.mockResolvedValue(mockPayment);
      paymentService.processSuccessfulPayment.mockResolvedValue(undefined);

      // Act
      const result = await processor.handlePaymentVerification(mockJob);

      // Assert
      expect(result).toEqual({ processed: true });
      expect(paystackService.verifyTransaction).toHaveBeenCalledWith(
        'LIZT_1234567890_abc123',
      );
      expect(paymentService.findById).toHaveBeenCalledWith('payment-123');
      expect(paymentService.processSuccessfulPayment).toHaveBeenCalledWith(
        mockVerification.data,
      );
      expect(paystackLogger.info).toHaveBeenCalledWith(
        'Polling verification',
        expect.objectContaining({
          reference: 'LIZT_1234567890_abc123',
          status: 'success',
        }),
      );
      expect(paystackLogger.info).toHaveBeenCalledWith(
        'Payment processed via polling',
        expect.objectContaining({
          reference: 'LIZT_1234567890_abc123',
          payment_id: 'payment-123',
        }),
      );
    });

    it('should not process payment if already completed by webhook', async () => {
      // Arrange
      const mockVerification = createMockVerification();

      const mockPayment = {
        id: 'payment-123',
        status: PaymentStatus.COMPLETED,
      } as Payment;

      paystackService.verifyTransaction.mockResolvedValue(mockVerification);
      paymentService.findById.mockResolvedValue(mockPayment);

      // Act
      const result = await processor.handlePaymentVerification(mockJob);

      // Assert
      expect(result).toEqual({ processed: true });
      expect(paymentService.processSuccessfulPayment).not.toHaveBeenCalled();
      expect(paystackLogger.info).toHaveBeenCalledWith(
        'Payment already processed by webhook',
        expect.objectContaining({
          reference: 'LIZT_1234567890_abc123',
          payment_id: 'payment-123',
          current_status: PaymentStatus.COMPLETED,
        }),
      );
    });

    it('should mark payment as failed when status is failed', async () => {
      // Arrange
      const mockVerification = createMockVerification({ status: 'failed' });

      paystackService.verifyTransaction.mockResolvedValue(mockVerification);

      // Act
      const result = await processor.handlePaymentVerification(mockJob);

      // Assert
      expect(result).toEqual({ processed: true, failed: true });
      expect(paymentService.markAsFailed).toHaveBeenCalledWith(
        'payment-123',
        mockVerification.data,
      );
      expect(paystackLogger.info).toHaveBeenCalledWith(
        'Payment marked as failed via polling',
        expect.objectContaining({
          reference: 'LIZT_1234567890_abc123',
          payment_id: 'payment-123',
        }),
      );
    });

    it('should throw error to trigger retry when payment is still pending', async () => {
      // Arrange
      const mockVerification = createMockVerification({ status: 'pending' });

      paystackService.verifyTransaction.mockResolvedValue(mockVerification);

      // Act & Assert
      await expect(
        processor.handlePaymentVerification(mockJob),
      ).rejects.toThrow('Payment still pending');

      expect(paystackLogger.info).toHaveBeenCalledWith(
        'Polling verification',
        expect.objectContaining({
          reference: 'LIZT_1234567890_abc123',
          status: 'pending',
        }),
      );
    });

    it('should log error and re-throw when verification fails', async () => {
      // Arrange
      const error = new Error('Network error');
      paystackService.verifyTransaction.mockRejectedValue(error);

      // Act & Assert
      await expect(
        processor.handlePaymentVerification(mockJob),
      ).rejects.toThrow('Network error');

      expect(paystackLogger.error).toHaveBeenCalledWith(
        'Polling error',
        expect.objectContaining({
          reference: 'LIZT_1234567890_abc123',
          payment_id: 'payment-123',
          error: 'Network error',
        }),
      );
    });
  });
});

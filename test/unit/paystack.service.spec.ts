import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { PaystackService } from '../../src/payments/paystack.service';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';

describe('PaystackService', () => {
  let service: PaystackService;
  let httpService: HttpService;

  const mockHttpService = {
    get: jest.fn(),
    post: jest.fn(),
  };

  beforeEach(async () => {
    // Set environment variable for testing
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_mock_key';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaystackService,
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
      ],
    }).compile();

    service = module.get<PaystackService>(PaystackService);
    httpService = module.get<HttpService>(HttpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeTransaction', () => {
    it('should successfully initialize a transaction', async () => {
      const mockResponse: AxiosResponse = {
        data: {
          status: true,
          message: 'Authorization URL created',
          data: {
            authorization_url: 'https://checkout.paystack.com/test',
            access_code: 'test_access_code',
            reference: 'test_reference',
          },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockHttpService.post.mockReturnValue(of(mockResponse));

      const result = await service.initializeTransaction({
        email: 'test@example.com',
        amount: 100000,
        reference: 'test_reference',
        callback_url: 'https://example.com/callback',
      });

      expect(result.status).toBe(true);
      expect(result.data.access_code).toBe('test_access_code');
      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://api.paystack.co/transaction/initialize',
        expect.objectContaining({
          email: 'test@example.com',
          amount: 100000,
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sk_test_mock_key',
          }),
        }),
      );
    });

    it('should retry on failure and eventually succeed', async () => {
      const mockError = new Error('Network error');
      const mockResponse: AxiosResponse = {
        data: {
          status: true,
          message: 'Authorization URL created',
          data: {
            authorization_url: 'https://checkout.paystack.com/test',
            access_code: 'test_access_code',
            reference: 'test_reference',
          },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      // First call fails, second succeeds
      mockHttpService.post
        .mockReturnValueOnce(throwError(() => mockError))
        .mockReturnValueOnce(of(mockResponse));

      const result = await service.initializeTransaction({
        email: 'test@example.com',
        amount: 100000,
        reference: 'test_reference',
        callback_url: 'https://example.com/callback',
      });

      expect(result.status).toBe(true);
      expect(mockHttpService.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('verifyTransaction', () => {
    it('should successfully verify a transaction', async () => {
      const mockResponse: AxiosResponse = {
        data: {
          status: true,
          message: 'Verification successful',
          data: {
            id: 123,
            status: 'success',
            reference: 'test_reference',
            amount: 100000,
            channel: 'card',
            paid_at: '2024-01-28T10:00:00Z',
            created_at: '2024-01-28T09:00:00Z',
            customer: {
              email: 'test@example.com',
            },
          },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockHttpService.get.mockReturnValue(of(mockResponse));

      const result = await service.verifyTransaction('test_reference');

      expect(result.status).toBe(true);
      expect(result.data.status).toBe('success');
      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://api.paystack.co/transaction/verify/test_reference',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sk_test_mock_key',
          }),
        }),
      );
    });
  });

  describe('error handling', () => {
    it('should throw error when PAYSTACK_SECRET_KEY is not set', () => {
      delete process.env.PAYSTACK_SECRET_KEY;

      expect(() => {
        new PaystackService(httpService);
      }).toThrow('PAYSTACK_SECRET_KEY environment variable is required');
    });
  });
});

import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { PaystackLogger } from './paystack-logger.service';

export interface PaystackInitializeTransactionDto {
  email: string;
  amount: number; // Amount in kobo (smallest currency unit)
  reference: string;
  callback_url: string;
  metadata?: any;
  channels?: string[];
}

export interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

export interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    domain: string;
    status: string;
    reference: string;
    amount: number;
    message: string | null;
    gateway_response: string;
    paid_at: string;
    created_at: string;
    channel: string;
    currency: string;
    ip_address: string;
    metadata: any;
    log: any;
    fees: number;
    fees_split: any;
    authorization: {
      authorization_code: string;
      bin: string;
      last4: string;
      exp_month: string;
      exp_year: string;
      channel: string;
      card_type: string;
      bank: string;
      country_code: string;
      brand: string;
      reusable: boolean;
      signature: string;
      account_name: string | null;
    };
    customer: {
      id: number;
      first_name: string | null;
      last_name: string | null;
      email: string;
      customer_code: string;
      phone: string | null;
      metadata: any;
      risk_action: string;
    };
    plan: any;
    order_id: any;
    paidAt: string;
    createdAt: string;
    requested_amount: number;
    pos_transaction_data: any;
    source: any;
    fees_breakdown: any;
  };
}

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly baseUrl = 'https://api.paystack.co';
  private readonly secretKey: string;
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000; // 1 second

  constructor(private readonly httpService: HttpService) {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;

    if (!secretKey) {
      this.logger.error('PAYSTACK_SECRET_KEY is not configured');
      throw new Error('PAYSTACK_SECRET_KEY environment variable is required');
    }

    this.secretKey = secretKey;
  }

  /**
   * Initialize a Paystack transaction
   * @param data Transaction initialization data
   * @returns Paystack initialization response with authorization URL and access code
   */
  async initializeTransaction(
    data: PaystackInitializeTransactionDto,
  ): Promise<PaystackInitializeResponse> {
    const url = `${this.baseUrl}/transaction/initialize`;

    this.logger.log(
      `Initializing Paystack transaction for ${data.email}, amount: ${data.amount}, reference: ${data.reference}`,
    );

    try {
      const response =
        await this.makeRequestWithRetry<PaystackInitializeResponse>(
          'POST',
          url,
          data,
        );

      this.logger.log(
        `Transaction initialized successfully: ${data.reference}`,
      );
      this.logger.debug(`Response: ${JSON.stringify(response)}`);

      return response;
    } catch (error) {
      this.logger.error(
        `Failed to initialize transaction: ${data.reference}`,
        error.stack,
      );
      throw this.handlePaystackError(error, 'initialize transaction');
    }
  }

  /**
   * Verify a Paystack transaction
   * @param reference Transaction reference to verify
   * @returns Paystack verification response with transaction details
   */
  async verifyTransaction(reference: string): Promise<PaystackVerifyResponse> {
    const url = `${this.baseUrl}/transaction/verify/${reference}`;

    this.logger.log(`Verifying Paystack transaction: ${reference}`);

    try {
      const response = await this.makeRequestWithRetry<PaystackVerifyResponse>(
        'GET',
        url,
      );

      this.logger.log(
        `Transaction verified: ${reference}, status: ${response.data.status}`,
      );
      this.logger.debug(`Response: ${JSON.stringify(response)}`);

      return response;
    } catch (error) {
      this.logger.error(
        `Failed to verify transaction: ${reference}`,
        error.stack,
      );
      throw this.handlePaystackError(error, 'verify transaction');
    }
  }

  /**
   * Make HTTP request with retry logic
   * @param method HTTP method
   * @param url Request URL
   * @param data Request body (optional)
   * @returns Response data
   */
  private async makeRequestWithRetry<T>(
    method: 'GET' | 'POST',
    url: string,
    data?: any,
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const config = {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json',
          },
        };

        const response =
          method === 'GET'
            ? await firstValueFrom(this.httpService.get(url, config))
            : await firstValueFrom(this.httpService.post(url, data, config));

        return response.data;
      } catch (error) {
        lastError = error;

        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * attempt; // Exponential backoff
          this.logger.warn(
            `Request failed (attempt ${attempt}/${this.maxRetries}), retrying in ${delay}ms...`,
          );
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Handle Paystack API errors
   * @param error Error object
   * @param operation Operation description
   * @returns HttpException
   */
  private handlePaystackError(error: any, operation: string): HttpException {
    if (error.response) {
      const axiosError = error as AxiosError;
      const status =
        axiosError.response?.status || HttpStatus.INTERNAL_SERVER_ERROR;
      const message =
        (axiosError.response?.data as any)?.message || `Failed to ${operation}`;

      this.logger.error(
        `Paystack API error (${status}): ${message}`,
        JSON.stringify(axiosError.response?.data),
      );

      return new HttpException(
        {
          statusCode: status,
          message: `Paystack error: ${message}`,
          error: 'PaystackError',
        },
        status,
      );
    }

    if (error.request) {
      this.logger.error(
        'No response received from Paystack API',
        error.message,
      );
      return new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Paystack service is currently unavailable',
          error: 'ServiceUnavailable',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    this.logger.error(`Unexpected error during ${operation}`, error.message);
    return new HttpException(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: `An unexpected error occurred while trying to ${operation}`,
        error: 'InternalServerError',
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  /**
   * Sleep utility for retry delays
   * @param ms Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

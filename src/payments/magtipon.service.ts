import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

export interface MagtiponFundsTransferDto {
  amount: number;
  requestRef: string;
  customerDetails: {
    fullname: string;
    mobilePhone: string;
    email: string;
  };
  beneficiaryDetails: {
    fullname: string;
    mobilePhone: string;
    email: string;
  };
  bankDetails: {
    bankType: string; // 'comm' for commercial banks
    bankCode: string;
    accountNumber: string;
    accountType: string;
  };
}

export interface MagtiponValidateAccountDto {
  cbnCode: string;
  accountNumber: string;
}

export interface MagtiponBillPaymentDto {
  amount: number;
  requestRef: string;
  paymentCode: string;
  customerId: string;
  customerDetails: {
    fullname: string;
    mobilePhone: string;
    email: string;
  };
}

export interface MagtiponResponse {
  responseCode: string;
  responseDescription?: string;
  transactionRef?: string;
  pin?: string;
  balance?: number;
}

export interface MagtiponBank {
  name: string;
  cbnCode: string;
}

export interface MagtiponAccountValidation {
  accountName: string;
  responseCode: string;
}

@Injectable()
export class MagtiponService {
  private readonly logger = new Logger(MagtiponService.name);
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly primaryKey: string;
  private readonly secondaryKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl =
      this.configService.get<string>('MAGTIPON_BASE_URL') ||
      'http://magtipon-sandbox.buildbankng.com/api/v1';
    this.username = this.configService.get<string>('MAGTIPON_USERNAME');
    this.primaryKey = this.configService.get<string>('MAGTIPON_PRIMARY_KEY');
    this.secondaryKey = this.configService.get<string>(
      'MAGTIPON_SECONDARY_KEY',
    );

    if (!this.username || !this.primaryKey) {
      this.logger.error('Magtipon credentials not configured');
      throw new Error(
        'MAGTIPON_USERNAME and MAGTIPON_PRIMARY_KEY are required',
      );
    }
  }

  /**
   * Generate SHA512 authentication signature
   */
  private generateAuthSignature(timestamp: number, key?: string): string {
    const keyToUse = key || this.primaryKey;
    const message = timestamp.toString() + keyToUse;
    const hash = crypto.createHash('sha512').update(message).digest('base64');
    return `magtipon ${this.username}:${hash}`;
  }

  /**
   * Generate SHA512 signature for transaction requests
   */
  private generateTransactionSignature(
    requestRef: string,
    key?: string,
  ): string {
    const keyToUse = key || this.primaryKey;
    const message = requestRef + keyToUse;
    return crypto.createHash('sha512').update(message).digest('base64');
  }

  /**
   * Create request headers with authentication
   */
  private createHeaders(includeContentType = false): Record<string, string> {
    const timestamp = Math.floor(Date.now() / 1000);
    const headers: Record<string, string> = {
      Authorization: this.generateAuthSignature(timestamp),
      timestamp: timestamp.toString(),
    };

    if (includeContentType) {
      headers['Content-Type'] = 'application/json';
    }

    return headers;
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<number> {
    try {
      const headers = this.createHeaders();

      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/account/balance`, { headers }),
      );

      const data = response.data as MagtiponResponse;

      if (data.responseCode !== '90000') {
        throw new HttpException(
          data.responseDescription || 'Failed to get balance',
          HttpStatus.BAD_REQUEST,
        );
      }

      return data.balance || 0;
    } catch (error) {
      this.logger.error('Failed to get Magtipon balance', error);
      throw new HttpException(
        'Failed to get balance',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get list of supported banks
   */
  async getBanks(): Promise<MagtiponBank[]> {
    try {
      const headers = this.createHeaders();

      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/banks`, { headers }),
      );

      const data = response.data;

      if (data.responseCode !== '90000') {
        throw new HttpException(
          data.responseDescription || 'Failed to get banks',
          HttpStatus.BAD_REQUEST,
        );
      }

      return data.banks || [];
    } catch (error) {
      this.logger.error('Failed to get banks list', error);
      throw new HttpException(
        'Failed to get banks',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Validate bank account number and get account name
   */
  async validateAccount(
    dto: MagtiponValidateAccountDto,
  ): Promise<MagtiponAccountValidation> {
    try {
      const headers = this.createHeaders();

      const response = await firstValueFrom(
        this.httpService.get(
          `${this.baseUrl}/bank/${dto.cbnCode}/account/${dto.accountNumber}`,
          { headers },
        ),
      );

      const data = response.data as MagtiponAccountValidation;

      if (data.responseCode !== '90000') {
        throw new HttpException(
          'Invalid account number or bank code',
          HttpStatus.BAD_REQUEST,
        );
      }

      return data;
    } catch (error) {
      this.logger.error('Failed to validate account', error);
      throw new HttpException(
        'Account validation failed',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Transfer funds to a bank account
   */
  async transferFunds(dto: MagtiponFundsTransferDto): Promise<string> {
    try {
      const headers = this.createHeaders(true);

      // Generate signature for the transaction
      const signature = this.generateTransactionSignature(dto.requestRef);

      const payload = {
        ...dto,
        signature,
      };

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/transaction/fundstransfer`,
          payload,
          { headers },
        ),
      );

      const data = response.data as MagtiponResponse;

      if (data.responseCode !== '90000') {
        throw new HttpException(
          data.responseDescription || 'Transfer failed',
          HttpStatus.BAD_REQUEST,
        );
      }

      return data.transactionRef || '';
    } catch (error) {
      this.logger.error('Failed to transfer funds', error);
      throw new HttpException(
        'Fund transfer failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Make bill payment (e.g., DSTV, electricity)
   */
  async makeBillPayment(dto: MagtiponBillPaymentDto): Promise<string> {
    try {
      const headers = this.createHeaders(true);

      // Generate signature for the transaction
      const signature = this.generateTransactionSignature(dto.requestRef);

      const payload = {
        amount: dto.amount,
        requestRef: dto.requestRef,
        paymentCode: dto.paymentCode,
        customerId: dto.customerId,
        customerDetails: dto.customerDetails,
        signature,
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/transaction/payment`, payload, {
          headers,
        }),
      );

      const data = response.data as MagtiponResponse;

      if (data.responseCode !== '90000') {
        throw new HttpException(
          data.responseDescription || 'Payment failed',
          HttpStatus.BAD_REQUEST,
        );
      }

      return data.transactionRef || '';
    } catch (error) {
      this.logger.error('Failed to make bill payment', error);
      throw new HttpException(
        'Bill payment failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Query transaction status
   */
  async queryTransaction(requestRef: string): Promise<MagtiponResponse> {
    try {
      const headers = this.createHeaders();

      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/transaction/${requestRef}`, {
          headers,
        }),
      );

      return response.data as MagtiponResponse;
    } catch (error) {
      this.logger.error('Failed to query transaction', error);
      throw new HttpException(
        'Transaction query failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Validate customer for bill payment
   */
  async validateCustomer(
    paymentCode: string,
    customerId: string,
    amount: number,
  ): Promise<any> {
    try {
      const headers = this.createHeaders(true);

      const payload = {
        amount,
        paymentCode,
        customerId,
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/transaction/validate`, payload, {
          headers,
        }),
      );

      const data = response.data;

      if (data.responseCode !== '90000') {
        throw new HttpException(
          data.responseDescription || 'Customer validation failed',
          HttpStatus.BAD_REQUEST,
        );
      }

      return data;
    } catch (error) {
      this.logger.error('Failed to validate customer', error);
      throw new HttpException(
        'Customer validation failed',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Generate unique request reference
   */
  generateRequestRef(prefix = 'LIZT'): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return `${prefix}_${timestamp}_${random}`;
  }
}

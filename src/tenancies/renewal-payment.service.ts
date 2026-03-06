import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  RenewalInvoice,
  RenewalPaymentStatus,
} from './entities/renewal-invoice.entity';
import { PaystackService } from '../payments/paystack.service';
import { TenanciesService } from './tenancies.service';
import { v4 as uuidv4 } from 'uuid';

export interface PaymentInitializationResult {
  accessCode: string;
  reference: string;
  authorizationUrl: string;
}

export interface PaymentVerificationResult {
  status: 'success' | 'failed' | 'pending';
  reference: string;
  amount: number;
  paidAt?: string;
  channel?: string;
}

@Injectable()
export class RenewalPaymentService {
  private readonly logger = new Logger(RenewalPaymentService.name);

  constructor(
    @InjectRepository(RenewalInvoice)
    private readonly renewalInvoiceRepository: Repository<RenewalInvoice>,
    private readonly paystackService: PaystackService,
    private readonly tenanciesService: TenanciesService,
  ) {}

  /**
   * Initialize Paystack payment for renewal invoice
   * Requirements: 5.1, 5.5
   */
  async initializePayment(
    token: string,
    email: string,
    amount: number,
  ): Promise<PaymentInitializationResult> {
    this.logger.log(`Initializing payment for renewal invoice: ${token}`);

    // Find renewal invoice by token
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { token },
      relations: ['property', 'tenant', 'tenant.user', 'propertyTenant'],
    });

    if (!invoice) {
      throw new NotFoundException('Renewal invoice not found');
    }

    // Check if invoice is already paid
    if (invoice.payment_status === RenewalPaymentStatus.PAID) {
      throw new ConflictException('This invoice has already been paid');
    }

    // Validate amount matches invoice total (Requirement 5.5)
    const invoiceTotal = Number(invoice.total_amount);
    if (Math.abs(amount - invoiceTotal) > 0.01) {
      throw new BadRequestException(
        `Payment amount (₦${amount}) does not match invoice total (₦${invoiceTotal})`,
      );
    }

    // Generate unique reference with retry logic for collision handling
    const maxRetries = 3;
    let reference = '';
    let paystackResponse: any = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      reference = `RENEWAL_${Date.now()}_${uuidv4().substring(0, 8)}`;

      try {
        // Initialize Paystack transaction
        paystackResponse = await this.paystackService.initializeTransaction({
          email,
          amount: Math.round(amount * 100), // Convert to kobo
          reference,
          callback_url: `${process.env.FRONTEND_URL}/renewal-invoice/${token}`,
          metadata: {
            renewal_invoice_id: invoice.id,
            property_id: invoice.property_id,
            tenant_id: invoice.tenant_id,
            tenant_name: `${invoice.tenant.user.first_name} ${invoice.tenant.user.last_name}`,
            property_name: invoice.property.name,
          },
          channels: ['card', 'bank_transfer'],
        });

        this.logger.log(
          `Payment initialized successfully for renewal invoice: ${token}, reference: ${reference}`,
        );

        // Success - break out of retry loop
        break;
      } catch (error) {
        // Check if it's a duplicate key error
        const isDuplicateError =
          error.code === '23505' ||
          error.message?.includes('duplicate key') ||
          error.message?.includes('unique constraint');

        if (isDuplicateError && attempt < maxRetries - 1) {
          this.logger.warn('Reference collision, retrying', {
            reference,
            attempt: attempt + 1,
          });
          continue;
        }

        // Re-throw if not a duplicate error or max retries reached
        this.logger.error(
          `Failed to initialize payment for renewal invoice: ${token}`,
          error.stack,
        );
        throw error;
      }
    }

    if (!paystackResponse) {
      throw new BadRequestException(
        'Failed to initialize payment after retries',
      );
    }

    return {
      accessCode: paystackResponse.data.access_code,
      reference,
      authorizationUrl: paystackResponse.data.authorization_url,
    };
  }

  /**
   * Verify payment with Paystack
   * Requirements: 5.3
   */
  async verifyPayment(reference: string): Promise<PaymentVerificationResult> {
    this.logger.log(`Verifying payment with reference: ${reference}`);

    try {
      const verification =
        await this.paystackService.verifyTransaction(reference);

      this.logger.log(
        `Paystack verification response for ${reference}: ${verification.data.status}`,
      );

      if (verification.data.status === 'success') {
        return {
          status: 'success',
          reference: verification.data.reference,
          amount: verification.data.amount / 100, // Convert from kobo
          paidAt: verification.data.paid_at,
          channel: verification.data.channel,
        };
      }

      return {
        status: verification.data.status as 'failed' | 'pending',
        reference: verification.data.reference,
        amount: verification.data.amount / 100,
      };
    } catch (error) {
      this.logger.error(
        `Error verifying payment with Paystack: ${reference}`,
        error.stack,
      );
      throw new BadRequestException(
        'Failed to verify payment. Please contact support if amount was deducted.',
      );
    }
  }

  /**
   * Process successful payment
   * Requirements: 5.3, 6.1-6.5, 7.1-7.4, 8.1-8.5
   */
  async processSuccessfulPayment(
    token: string,
    reference: string,
    amount: number,
  ): Promise<void> {
    this.logger.log(
      `Processing successful payment for renewal invoice: ${token}, reference: ${reference}`,
    );

    // Delegate to TenanciesService to handle invoice update, notifications, and history updates
    // This follows the separation of concerns pattern and avoids duplication
    await this.tenanciesService.markInvoiceAsPaid(token, reference, amount);

    this.logger.log(
      `Successfully processed payment for renewal invoice: ${token}`,
    );
  }
}

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
import { WhatsAppNotificationLogService } from '../whatsapp-bot/whatsapp-notification-log.service';
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
  receiptToken?: string;
  whatsappDelivery?: {
    sent: boolean;
    messageId?: string;
    error?: string;
  };
}

@Injectable()
export class RenewalPaymentService {
  private readonly logger = new Logger(RenewalPaymentService.name);

  constructor(
    @InjectRepository(RenewalInvoice)
    private readonly renewalInvoiceRepository: Repository<RenewalInvoice>,
    private readonly paystackService: PaystackService,
    private readonly tenanciesService: TenanciesService,
    private readonly whatsappNotificationLog: WhatsAppNotificationLogService,
  ) {}

  /**
   * Initialize Paystack payment for renewal invoice
   * Requirements: 5.1, 5.5
   */
  async initializePayment(
    token: string,
    email: string,
    amount: number,
    paymentOption?: string,
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

    // Validate amount is positive and does not exceed invoice total
    const invoiceTotal = Number(invoice.total_amount);
    if (amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }
    if (amount - invoiceTotal > 0.01) {
      throw new BadRequestException(
        `Payment amount (₦${amount}) exceeds invoice total (₦${invoiceTotal})`,
      );
    }

    // Store payment option on the invoice for post-payment processing
    if (paymentOption) {
      invoice.payment_option = paymentOption;
      await this.renewalInvoiceRepository.save(invoice);
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
            payment_option: paymentOption || null,
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

    // Log payment initiated event to property history
    try {
      const tenantName = `${invoice.tenant.user.first_name} ${invoice.tenant.user.last_name}`;
      await this.tenanciesService.logRenewalPaymentInitiated(
        invoice.id,
        invoice.property_id,
        invoice.tenant_id,
        tenantName,
        invoice.property.name,
      );
    } catch (error) {
      this.logger.error('Failed to log payment initiated event:', error);
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
        // Generate receipt token for successful payments
        const receiptToken = `receipt_${Date.now()}_${uuidv4().substring(0, 8)}`;

        return {
          status: 'success',
          reference: verification.data.reference,
          amount: verification.data.amount / 100, // Convert from kobo
          paidAt: verification.data.paid_at,
          channel: verification.data.channel,
          receiptToken,
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
   * Process successful payment and send WhatsApp receipt
   * Requirements: 5.3, 3.1-3.6, 6.1-6.5, 7.1-7.4, 8.1-8.5
   */
  async processSuccessfulPayment(
    token: string,
    reference: string,
    amount: number,
    receiptToken?: string,
  ): Promise<void> {
    this.logger.log(
      `Processing successful payment for renewal invoice: ${token}, reference: ${reference}`,
    );

    // Store receipt token and read payment_option from invoice
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { token },
    });

    let paymentOption: string | null = null;

    if (invoice) {
      if (receiptToken) {
        invoice.receipt_token = receiptToken;
        invoice.receipt_number = `RR-${Date.now()}`;
      }
      invoice.amount_paid = amount;
      paymentOption = invoice.payment_option;
      await this.renewalInvoiceRepository.save(invoice);
    }

    // Delegate to TenanciesService to handle invoice update, notifications, and history updates
    await this.tenanciesService.markInvoiceAsPaid(
      token,
      reference,
      amount,
      paymentOption || undefined,
    );

    this.logger.log(
      `Successfully processed payment for renewal invoice: ${token}`,
    );
  }

  /**
   * Process a successful renewal payment from Paystack webhook
   * Looks up the renewal invoice from webhook metadata and processes payment
   */
  async processWebhookPayment(data: {
    reference: string;
    amount: number;
    metadata?: { renewal_invoice_id?: string };
  }): Promise<void> {
    const { reference, amount, metadata } = data;
    const renewalInvoiceId = metadata?.renewal_invoice_id;

    if (!renewalInvoiceId) {
      this.logger.error('Webhook missing renewal_invoice_id in metadata', {
        reference,
      });
      throw new Error('Missing renewal_invoice_id in webhook metadata');
    }

    this.logger.log(
      `Processing webhook for renewal invoice: ${renewalInvoiceId}, reference: ${reference}`,
    );

    // Find invoice by ID to get the token
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { id: renewalInvoiceId },
    });

    if (!invoice) {
      this.logger.error('Renewal invoice not found for webhook', {
        renewalInvoiceId,
        reference,
      });
      throw new Error(`Renewal invoice not found: ${renewalInvoiceId}`);
    }

    // Already paid — idempotent, just return
    if (invoice.payment_status === RenewalPaymentStatus.PAID) {
      this.logger.log(
        'Renewal invoice already paid (webhook idempotency), skipping',
        { renewalInvoiceId, reference },
      );
      return;
    }

    const amountInNaira = amount / 100; // Convert from kobo
    await this.processSuccessfulPayment(
      invoice.token,
      reference,
      amountInNaira,
    );
  }

  /**
   * Find renewal invoice by payment reference
   * Helper method for WhatsApp receipt delivery
   */
  private async findInvoiceByReference(
    reference: string,
  ): Promise<RenewalInvoice | null> {
    try {
      // First, try to find by payment_reference (if already processed)
      let invoice = await this.renewalInvoiceRepository.findOne({
        where: { payment_reference: reference },
        relations: ['property', 'tenant', 'tenant.user'],
      });

      if (invoice) {
        return invoice;
      }

      // If not found, get the transaction details from Paystack to find the invoice ID
      const verification =
        await this.paystackService.verifyTransaction(reference);
      const renewalInvoiceId = verification.data.metadata?.renewal_invoice_id;

      if (renewalInvoiceId) {
        invoice = await this.renewalInvoiceRepository.findOne({
          where: { id: renewalInvoiceId },
          relations: ['property', 'tenant', 'tenant.user'],
        });
      }

      return invoice;
    } catch (error) {
      this.logger.error('Error finding invoice by reference:', error);
      return null;
    }
  }
}

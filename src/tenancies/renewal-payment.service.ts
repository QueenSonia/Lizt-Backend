import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  RenewalInvoice,
  RenewalPaymentStatus,
  RenewalLetterStatus,
} from './entities/renewal-invoice.entity';
import { PropertyHistory } from '../property-history/entities/property-history.entity';
import { Property } from '../properties/entities/property.entity';
import { PaystackService } from '../payments/paystack.service';
import { TenanciesService } from './tenancies.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/enums/notification-type';
import { EventsGateway } from '../events/events.gateway';
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
    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepository: Repository<PropertyHistory>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    private readonly paystackService: PaystackService,
    private readonly tenanciesService: TenanciesService,
    private readonly notificationService: NotificationService,
    private readonly eventsGateway: EventsGateway,
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

    // Same gating as getRenewalInvoice: only the current (non-superseded)
    // landlord-type invoice whose letter has been accepted may accept payment.
    const isLandlordInvoice = invoice.token_type === 'landlord';
    if (isLandlordInvoice && invoice.superseded_by_id) {
      throw new HttpException(
        'This invoice has been updated. Your landlord has sent you a revised offer letter — please open the latest link from your WhatsApp.',
        HttpStatus.GONE,
      );
    }
    if (
      isLandlordInvoice &&
      invoice.letter_status !== RenewalLetterStatus.ACCEPTED
    ) {
      throw new HttpException(
        "Your landlord's offer letter hasn't been accepted yet. Please open the renewal letter link sent to your WhatsApp and accept it before paying.",
        HttpStatus.FORBIDDEN,
      );
    }

    // Validate amount is positive and for custom payments, must be >= invoice total
    const invoiceTotal = Number(invoice.total_amount);
    if (amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }

    // For custom payments, amount must be >= total invoice amount
    if (paymentOption === 'custom' && amount < invoiceTotal) {
      throw new BadRequestException(
        `Custom payment amount (₦${amount}) must be at least the total invoice amount (₦${invoiceTotal})`,
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
    channel?: string,
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
      // Idempotency: if the invoice is already paid, another path (webhook
      // or frontend-verify) has already saved the authoritative receipt_token
      // and sent the WhatsApp receipt. Overwriting it now would orphan the
      // token already in the tenant's WhatsApp link.
      if (invoice.payment_status === RenewalPaymentStatus.PAID) {
        this.logger.log(
          `Renewal invoice ${token} already paid; skipping (idempotent)`,
        );
        return;
      }

      if (receiptToken) {
        invoice.receipt_token = receiptToken;
        invoice.receipt_number = `RR-${Date.now()}`;
      }
      invoice.amount_paid = amount;
      if (channel) {
        invoice.payment_method = channel;
      }
      paymentOption = invoice.payment_option;
      await this.renewalInvoiceRepository.save(invoice);
    }

    // Delegate to TenanciesService to handle invoice update, notifications, and history updates.
    // INVOICE_SUPERSEDED race: the landlord revised the letter between the
    // tenant initiating Paystack and verify/webhook landing here. The funds
    // are real — credit them to the wallet, log, and return cleanly so
    // Paystack doesn't retry-loop and the tenant doesn't see a hard error.
    try {
      await this.tenanciesService.markInvoiceAsPaid(
        token,
        reference,
        amount,
        paymentOption || undefined,
      );
    } catch (err) {
      const code = (err as { response?: { code?: string } })?.response?.code;
      const invoiceId = (err as { response?: { invoiceId?: string } })?.response
        ?.invoiceId;
      if (code === 'INVOICE_SUPERSEDED' && invoiceId) {
        this.logger.warn(
          `Renewal payment ${reference} landed on superseded invoice ${invoiceId}; crediting tenant wallet and skipping rent-advance.`,
        );
        await this.tenanciesService.creditOrphanedRenewalPayment({
          invoiceId,
          amount,
          paymentReference: reference,
          paymentMethod: channel,
        });
        return;
      }
      throw err;
    }

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
    const receiptToken = `receipt_${Date.now()}_${uuidv4().substring(0, 8)}`;
    await this.processSuccessfulPayment(
      invoice.token,
      reference,
      amountInNaira,
      receiptToken,
    );
  }

  /**
   * Process a bank.transfer.rejected webhook event for renewal invoice payments.
   * Writes to property history, tenant history, landlord livefeed notification,
   * and emits a real-time WebSocket event. Invoice stays UNPAID (no status change needed).
   */
  async processWebhookTransferRejected(data: any): Promise<void> {
    const reference = data.reference;
    const amountInNaira = data.amount / 100;
    const gatewayResponse = data.gateway_response || 'Rejected';
    const renewalInvoiceId = data.metadata?.renewal_invoice_id;

    this.logger.log(
      `Processing bank.transfer.rejected for renewal invoice: ${renewalInvoiceId}, reference: ${reference}`,
    );

    if (!renewalInvoiceId) {
      this.logger.error(
        'Missing renewal_invoice_id in bank.transfer.rejected metadata',
        { reference },
      );
      return;
    }

    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { id: renewalInvoiceId },
      relations: ['property', 'tenant', 'tenant.user'],
    });

    if (!invoice) {
      this.logger.error(
        'Renewal invoice not found for rejected bank transfer',
        {
          renewalInvoiceId,
          reference,
        },
      );
      return;
    }

    // Already fully paid — nothing to mark failed
    if (invoice.payment_status === RenewalPaymentStatus.PAID) {
      this.logger.log(
        'Renewal invoice already paid, skipping bank transfer rejection',
        { renewalInvoiceId },
      );
      return;
    }

    const propertyId = invoice.property_id;
    const propertyName = invoice.property?.name || 'Property';
    const landlordId = invoice.property?.owner_id;
    const tenantId = invoice.tenant_id;
    const tenantName = invoice.tenant?.user
      ? `${invoice.tenant.user.first_name} ${invoice.tenant.user.last_name}`
      : 'Tenant';
    const description = `Bank transfer of ₦${amountInNaira.toLocaleString()} from ${tenantName} for renewal of ${propertyName} was rejected`;

    // Property history — shows in landlord property details history tab
    try {
      const propertyEntry = this.propertyHistoryRepository.create({
        property_id: propertyId,
        event_type: 'bank_transfer_rejected',
        event_description: description,
        related_entity_id: invoice.id,
        related_entity_type: 'renewal_invoice',
      });
      await this.propertyHistoryRepository.save(propertyEntry);
    } catch (error) {
      this.logger.error(
        'Failed to create property history for rejected renewal transfer',
        { error: error.message },
      );
    }

    // Tenant history — shows in landlord tenant details history tab
    try {
      const tenantEntry = this.propertyHistoryRepository.create({
        property_id: propertyId,
        tenant_id: tenantId,
        event_type: 'bank_transfer_rejected',
        event_description: description,
        related_entity_id: invoice.id,
        related_entity_type: 'renewal_invoice',
      });
      await this.propertyHistoryRepository.save(tenantEntry);
    } catch (error) {
      this.logger.error(
        'Failed to create tenant history for rejected renewal transfer',
        { error: error.message },
      );
    }

    // Landlord livefeed notification + real-time WebSocket event
    if (landlordId) {
      this.notificationService
        .create({
          date: new Date().toISOString(),
          type: NotificationType.PAYMENT_TRANSFER_REJECTED,
          description,
          status: 'Completed',
          property_id: propertyId,
          user_id: landlordId,
        })
        .then(() => {
          this.eventsGateway.emitPaymentFailed(landlordId, {
            propertyId,
            propertyName,
            applicantName: tenantName,
            amount: amountInNaira,
            reason: gatewayResponse,
          });
        })
        .catch((error) => {
          this.logger.error(
            'Failed to create bank transfer rejection notification for renewal',
            { reference, error: error.message },
          );
        });
    }
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

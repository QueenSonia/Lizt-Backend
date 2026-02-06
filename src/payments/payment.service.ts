import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, LessThan } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { v4 as uuidv4 } from 'uuid';
import { Cron } from '@nestjs/schedule';
import { Payment, PaymentStatus, PaymentType } from './entities/payment.entity';
import { PaymentLog, PaymentLogEventType } from './entities/payment-log.entity';
import {
  OfferLetter,
  OfferLetterStatus,
  PaymentStatus as OfferPaymentStatus,
} from '../offer-letters/entities/offer-letter.entity';
import { Property } from '../properties/entities/property.entity';
import { Users } from '../users/entities/user.entity';
import { KYCApplication } from '../kyc-links/entities/kyc-application.entity';
import { PaystackService } from './paystack.service';
import { PaystackLogger } from './paystack-logger.service';
import { TenantAttachmentService } from '../kyc-links/tenant-attachment.service';
import { PropertyHistoryService } from '../property-history/property-history.service';
import { TemplateSenderService } from '../whatsapp-bot/template-sender/template-sender.service';
import { InitiatePaymentDto, InitiatePaymentResponseDto } from './dto';
import { InvoicesService } from '../invoices/invoices.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/enums/notification-type';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(PaymentLog)
    private readonly paymentLogRepository: Repository<PaymentLog>,
    @InjectRepository(OfferLetter)
    private readonly offerLetterRepository: Repository<OfferLetter>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepository: Repository<KYCApplication>,
    @InjectQueue('payment-polling')
    private readonly pollingQueue: Queue,
    private readonly paystackService: PaystackService,
    private readonly paystackLogger: PaystackLogger,
    private readonly tenantAttachmentService: TenantAttachmentService,
    private readonly propertyHistoryService: PropertyHistoryService,
    private readonly templateSenderService: TemplateSenderService,
    @Inject(forwardRef(() => InvoicesService))
    private readonly invoicesService: InvoicesService,
    private readonly notificationService: NotificationService,
    private readonly eventsGateway: EventsGateway,
    private readonly dataSource: DataSource,
  ) { }

  /**
   * Initiate a payment for an offer letter
   */
  async initiatePayment(
    token: string,
    dto: InitiatePaymentDto,
  ): Promise<InitiatePaymentResponseDto> {
    // Find offer letter by token
    const offerLetter = await this.offerLetterRepository.findOne({
      where: { token },
      relations: ['property', 'kyc_application'],
    });

    if (!offerLetter) {
      throw new NotFoundException('Offer letter not found');
    }

    // Validate property still available
    const property = await this.propertyRepository.findOne({
      where: { id: offerLetter.property_id },
    });

    if (!property) {
      throw new NotFoundException('Property not found');
    }

    if (property.property_status === 'occupied') {
      throw new ConflictException('Property is no longer available');
    }

    // Validate amount
    const outstandingBalance = offerLetter.outstanding_balance ?? 0;
    if (dto.amount > outstandingBalance) {
      throw new BadRequestException(
        `Amount exceeds outstanding balance of ₦${outstandingBalance}`,
      );
    }

    if (dto.amount <= 0) {
      throw new BadRequestException('Amount must be greater than zero');
    }

    // Generate unique reference with retry logic for collision handling
    const maxRetries = 3;
    let reference = '';
    let payment: Payment | null = null;
    let paystackResponse: any = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      reference = `LIZT_${Date.now()}_${uuidv4().substring(0, 8)}`;

      try {
        // Initialize Paystack transaction
        paystackResponse = await this.paystackService.initializeTransaction({
          email: dto.email,
          amount: Math.round(dto.amount * 100), // Convert to kobo
          reference,
          callback_url: dto.callbackUrl,
          metadata: {
            offer_letter_id: offerLetter.id,
            property_id: offerLetter.property_id,
            tenant_name: `${offerLetter.kyc_application.first_name} ${offerLetter.kyc_application.last_name}`,
          },
          channels: ['card', 'bank_transfer'],
        });

        // Create payment record
        payment = await this.paymentRepository.save({
          offer_letter_id: offerLetter.id,
          amount: dto.amount,
          payment_type:
            dto.amount >= (offerLetter.outstanding_balance ?? 0)
              ? PaymentType.FULL
              : PaymentType.PARTIAL,
          status: PaymentStatus.PENDING,
          paystack_reference: reference,
          paystack_access_code: paystackResponse.data.access_code,
          paystack_authorization_url: paystackResponse.data.authorization_url,
        });

        // Success - break out of retry loop
        break;
      } catch (error) {
        // Check if it's a duplicate key error (PostgreSQL error code 23505)
        const isDuplicateError =
          error.code === '23505' ||
          error.message?.includes('duplicate key') ||
          error.message?.includes('unique constraint');

        if (isDuplicateError && attempt < maxRetries - 1) {
          this.paystackLogger.warn('Reference collision, retrying', {
            reference,
            attempt: attempt + 1,
          });
          continue;
        }

        // Re-throw if not a duplicate error or max retries reached
        throw error;
      }
    }

    // This should never happen due to the throw in the catch block, but TypeScript needs assurance
    if (!payment || !paystackResponse) {
      throw new BadRequestException('Failed to create payment after retries');
    }

    // Log initiation
    void this.logPaymentEvent(payment.id, PaymentLogEventType.INITIATION, {
      offer_letter_id: offerLetter.id,
      property_id: offerLetter.property_id,
      amount: dto.amount,
      reference,
      paystack_response: paystackResponse,
    });

    // Calculate expiry (Paystack access codes expire after 30 minutes)
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    // Create property history event for payment initiation (non-blocking)
    const tenantName = `${offerLetter.kyc_application.first_name} ${offerLetter.kyc_application.last_name}`;
    const propertyName = property.name;
    void this.createPaymentHistoryEvent(
      offerLetter.property_id,
      'payment_initiated',
      `${tenantName} initiated payment of ₦${dto.amount.toLocaleString()} for ${propertyName}`,
      payment.id,
      'payment',
    ).catch((err) => {
      this.paystackLogger.error('Failed to create payment history event', {
        error: err.message,
        payment_id: payment.id,
      });
    });

    // Queue polling job - start after 30 seconds, retry 10 times every 30 seconds (non-blocking)
    void this.pollingQueue
      .add(
        'verify-payment',
        {
          paymentId: payment.id,
          reference,
        },
        {
          delay: 30000, // Start after 30 seconds
          attempts: 60, // Poll 60 times (30 minutes total)
          backoff: {
            type: 'fixed',
            delay: 30000, // Every 30 seconds
          },
        },
      )
      .then(() => {
        this.paystackLogger.info('Polling job queued', {
          payment_id: payment.id,
          reference,
          attempts: 10,
          interval: '30s',
        });
      })
      .catch((err) => {
        this.paystackLogger.error('Failed to queue polling job', {
          error: err.message,
          payment_id: payment.id,
        });
      });

    return {
      paymentId: payment.id,
      paystackReference: reference,
      accessCode: paystackResponse.data.access_code,
      authorizationUrl: paystackResponse.data.authorization_url,
      expiresAt,
    };
  }

  /**
   * Process a successful payment (called by webhook or polling)
   * Uses pessimistic locking to prevent double processing from concurrent webhook/polling
   */
  async processSuccessfulPayment(data: any): Promise<void> {
    this.paystackLogger.info('Starting processSuccessfulPayment', { reference: data.reference });

    let processedPaymentId: string | null = null;
    let processedOfferLetterId: string | null = null;
    let processedAmount: number | null = null;
    let processedAmountPaid: number | null = null;
    let processedTotalAmount: number | null = null;

    try {
      await this.dataSource.transaction(async (manager) => {
        this.paystackLogger.debug('Transaction started', { reference: data.reference });

        // 1. Lock the payment row first (no joins to avoid "outer join" locking error)
        const payment = await manager
          .getRepository(Payment)
          .createQueryBuilder('payment')
          .where('payment.paystack_reference = :reference', {
            reference: data.reference,
          })
          .setLock('pessimistic_write')
          .getOne();

        if (!payment) {
          throw new Error(`Payment not found for reference: ${data.reference}`);
        }

        if (payment.status === PaymentStatus.COMPLETED) {
          this.paystackLogger.info('Payment already completed, skipping', { payment_id: payment.id });
          return;
        }

        // 2. Load the offer letter and property relations
        const offerLetter = await manager.getRepository(OfferLetter).findOne({
          where: { id: payment.offer_letter_id },
          relations: ['property'],
        });

        if (!offerLetter) {
          throw new Error(`Offer letter ${payment.offer_letter_id} not found for payment ${payment.id}`);
        }

        // 3. Lock the property row to prevent race conditions
        const property = await manager
          .getRepository(Property)
          .createQueryBuilder('property')
          .where('property.id = :id', { id: offerLetter.property_id })
          .setLock('pessimistic_write')
          .getOne();

        if (!property) {
          throw new Error(`Property ${offerLetter.property_id} not found`);
        }

        // Update payment status
        await manager.update(Payment, payment.id, {
          status: PaymentStatus.COMPLETED,
          payment_method: data.channel,
          paid_at: new Date(data.paid_at || data.paidAt || Date.now()),
          metadata: data,
        });
        this.paystackLogger.debug('Payment status updated to COMPLETED', { payment_id: payment.id });

        // Update offer letter amounts
        const amountToAdd = Number(payment.amount);
        const currentAmountPaid = Number(offerLetter.amount_paid || 0);
        const totalAmount = Number(offerLetter.total_amount);

        const newAmountPaid = currentAmountPaid + amountToAdd;
        const newOutstandingBalance = Math.max(0, totalAmount - newAmountPaid);

        // Use a small epsilon for zero-check to handle floating point
        const isFullyPaid = newOutstandingBalance < 0.01;

        await manager.update(OfferLetter, offerLetter.id, {
          amount_paid: newAmountPaid,
          outstanding_balance: isFullyPaid ? 0 : newOutstandingBalance,
          payment_status: isFullyPaid
            ? OfferPaymentStatus.FULLY_PAID
            : OfferPaymentStatus.PARTIAL,
        });
        this.paystackLogger.debug('Offer letter amounts updated', {
          offer_id: offerLetter.id,
          newAmountPaid,
          newOutstandingBalance,
          isFullyPaid
        });

        // Get tenant name for history
        const kycApplication = await manager.findOne(KYCApplication, {
          where: { id: offerLetter.kyc_application_id },
        });
        const tenantName = kycApplication
          ? `${kycApplication.first_name} ${kycApplication.last_name}`
          : 'Tenant';

        if (isFullyPaid && property.property_status !== 'occupied') {
          this.paystackLogger.info('Securing property for tenant', {
            property_id: property.id,
            tenant: tenantName
          });

          await this.attachTenantAndRejectOthers(
            manager,
            offerLetter,
            property,
          );

          await this.createPaymentHistoryEvent(
            property.id,
            'payment_completed_full',
            `${tenantName} completed full payment and secured ${property.name}`,
            payment.id,
            'payment',
          );
        } else if (isFullyPaid && property.property_status === 'occupied') {
          this.paystackLogger.warn('Race condition: Property already occupied', { property_id: property.id });
          await this.handleRaceCondition(manager, offerLetter);
        } else {
          this.paystackLogger.info('Partial payment processed', { outstanding: newOutstandingBalance });
          await this.createPaymentHistoryEvent(
            property.id,
            'payment_completed_partial',
            `${tenantName} paid for ${property.name}. Outstanding: ₦${newOutstandingBalance.toLocaleString()}`,
            payment.id,
            'payment',
          );
        }

        // Notify landlord (wrapped in try/catch to ensure it doesn't fail transaction)
        try {
          await this.notifyLandlordPaymentReceived(
            offerLetter,
            payment,
            isFullyPaid ? 0 : newOutstandingBalance,
          );
        } catch (notifErr) {
          this.paystackLogger.error('Notification failed but proceeding', { error: notifErr.message });
        }

        // Create notification for live feed (wrapped in try/catch to ensure it doesn't fail transaction)
        try {
          await this.notificationService.create({
            date: new Date().toISOString(),
            type: NotificationType.PAYMENT_RECEIVED,
            description: isFullyPaid
              ? `${tenantName} completed full payment of ₦${amountToAdd.toLocaleString()} for ${property.name}`
              : `${tenantName} paid ₦${amountToAdd.toLocaleString()} for ${property.name}. Outstanding: ₦${newOutstandingBalance.toLocaleString()}`,
            status: 'Completed',
            property_id: property.id,
            user_id: offerLetter.landlord_id,
          });

          // Emit WebSocket event for real-time notification
          this.eventsGateway.emitPaymentReceived(offerLetter.landlord_id, {
            propertyId: property.id,
            propertyName: property.name,
            applicantName: tenantName,
            amount: amountToAdd,
            isFullyPaid,
          });
        } catch (notifErr) {
          this.paystackLogger.error('Failed to create live feed notification', { error: notifErr.message });
        }

        processedPaymentId = payment.id;
        processedOfferLetterId = offerLetter.id;
        processedAmount = amountToAdd;
        processedAmountPaid = newAmountPaid;
        processedTotalAmount = totalAmount;
      });

      this.paystackLogger.info('Transaction committed successfully', { reference: data.reference });

      if (processedOfferLetterId && processedPaymentId) {
        try {
          await this.invoicesService.recordPaymentFromOfferLetter(
            processedOfferLetterId,
            processedAmount!,
            data.reference,
            data.channel || 'card',
            processedPaymentId,
          );
          this.paystackLogger.info('Invoice payment recorded');
        } catch (invErr) {
          this.paystackLogger.error('Invoice recording failed', { error: invErr.message });
        }

        await this.logPaymentEvent(processedPaymentId, PaymentLogEventType.VERIFICATION, {
          event: 'charge.success',
          processed: true,
          amount: processedAmount,
        });
      }
    } catch (error) {
      this.paystackLogger.error('processSuccessfulPayment failed', {
        reference: data.reference,
        error: error.message,
        stack: error.stack,
      });
      throw error; // Rethrow to trigger Bull retry if it was a job
    }
  }

  /**
   * Attach winning tenant and reject other offers
   */
  private async attachTenantAndRejectOthers(
    manager: EntityManager,
    winningOffer: OfferLetter,
    property: Property,
  ): Promise<void> {
    // Update property to occupied
    await manager.update(Property, property.id, {
      property_status: 'occupied',
    });

    // Update winning offer
    await manager.update(OfferLetter, winningOffer.id, {
      status: OfferLetterStatus.SELECTED,
      selected_at: new Date(),
    });

    // Attach tenant to property
    await this.tenantAttachmentService.attachTenantFromOffer(
      manager,
      winningOffer,
    );

    // Get tenant name for history events
    const kycApplication = await manager.findOne(KYCApplication, {
      where: { id: winningOffer.kyc_application_id },
    });
    const tenantName = kycApplication
      ? `${kycApplication.first_name} ${kycApplication.last_name}`
      : 'Tenant';

    // Create property history event for tenant attachment
    await this.createPaymentHistoryEvent(
      property.id,
      'tenant_attached_payment',
      `${tenantName} was attached to ${property.name} after completing payment`,
      winningOffer.id,
      'offer_letter',
    );

    // Find all other offers with payments for this property
    const losingOffers = await manager
      .getRepository(OfferLetter)
      .createQueryBuilder('offer')
      .where('offer.property_id = :propertyId', { propertyId: property.id })
      .andWhere('offer.id != :winnerId', { winnerId: winningOffer.id })
      .andWhere('offer.amount_paid > 0')
      .getMany();

    // Update losing offers
    for (const losingOffer of losingOffers) {
      await manager.update(OfferLetter, losingOffer.id, {
        status: OfferLetterStatus.REJECTED_BY_PAYMENT,
      });

      // Get losing tenant name
      const losingKyc = await manager.findOne(KYCApplication, {
        where: { id: losingOffer.kyc_application_id },
      });
      const losingTenantName = losingKyc
        ? `${losingKyc.first_name} ${losingKyc.last_name}`
        : 'Tenant';

      // Create property history event for rejected offer
      await this.createPaymentHistoryEvent(
        property.id,
        'offer_rejected_payment',
        `Offer for ${losingTenantName} rejected - property secured by another applicant`,
        losingOffer.id,
        'offer_letter',
      );

      // Send WhatsApp notification to losing tenant
      await this.notifyLosingTenant(losingOffer, property);
    }

    // Send success notifications
    await this.notifyWinningTenant(winningOffer, property);

    this.paystackLogger.info('Tenant attached and others rejected', {
      winning_offer_id: winningOffer.id,
      property_id: property.id,
      losing_offers_count: losingOffers.length,
    });
  }

  /**
   * Handle race condition when property is already occupied
   */
  private async handleRaceCondition(
    manager: EntityManager,
    offerLetter: OfferLetter,
  ): Promise<void> {
    // Update offer status
    await manager.update(OfferLetter, offerLetter.id, {
      status: OfferLetterStatus.PAYMENT_HELD_RACE_CONDITION,
    });

    // Get tenant name for history event
    const kycApplication = await manager.findOne(KYCApplication, {
      where: { id: offerLetter.kyc_application_id },
    });
    const tenantName = kycApplication
      ? `${kycApplication.first_name} ${kycApplication.last_name}`
      : 'Tenant';

    // Get property for name
    const property = await manager.findOne(Property, {
      where: { id: offerLetter.property_id },
    });
    const propertyName = property?.name || 'Property';

    // Create property history event for race condition
    await this.createPaymentHistoryEvent(
      offerLetter.property_id,
      'payment_race_condition',
      `Payment of ₦${Number(offerLetter.amount_paid).toLocaleString()} received from ${tenantName} after property was occupied. Refund required.`,
      offerLetter.id,
      'offer_letter',
    );

    // Notify landlord and tenant
    await this.notifyLandlordRaceCondition(offerLetter);
    await this.notifyTenantRaceCondition(offerLetter);

    // Log race condition
    this.paystackLogger.error('Race condition detected', {
      offer_id: offerLetter.id,
      property_id: offerLetter.property_id,
      amount_paid: offerLetter.amount_paid,
    });
  }

  /**
   * Get payment status for an offer letter
   */
  async getPaymentStatus(token: string): Promise<any> {
    const offerLetter = await this.offerLetterRepository.findOne({
      where: { token },
      relations: ['property'],
    });

    if (!offerLetter) {
      throw new NotFoundException('Offer letter not found');
    }

    // Get payment history
    const payments = await this.paymentRepository.find({
      where: { offer_letter_id: offerLetter.id },
      order: { created_at: 'DESC' },
    });

    const paymentHistory = payments.map((payment) => ({
      id: payment.id,
      amount: Number(payment.amount),
      status: payment.status,
      paymentMethod: payment.payment_method,
      paidAt: payment.paid_at,
      reference: payment.paystack_reference,
      date: payment.paid_at
        ? payment.paid_at.toISOString().split('T')[0]
        : payment.created_at.toISOString().split('T')[0],
    }));

    return {
      totalAmount: Number(offerLetter.total_amount),
      amountPaid: Number(offerLetter.amount_paid),
      outstandingBalance: Number(offerLetter.outstanding_balance),
      paymentStatus: offerLetter.payment_status,
      paymentHistory,
      propertyStatus: offerLetter.property.property_status,
      isPropertyAvailable: offerLetter.property.property_status !== 'occupied',
    };
  }

  /**
   * Get all payments for landlord's properties
   */
  async getLandlordPayments(
    landlordId: string,
    filters: {
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<any> {
    const { status = 'all', search = '', page = 1, limit = 20 } = filters;

    // Build query
    const query = this.offerLetterRepository
      .createQueryBuilder('offer')
      .leftJoinAndSelect('offer.property', 'property')
      .leftJoinAndSelect('offer.kyc_application', 'kyc')
      .where('offer.landlord_id = :landlordId', { landlordId })
      .andWhere('offer.amount_paid > 0');

    // Apply status filter
    // Valid payment_status values: 'unpaid', 'partial', 'fully_paid'
    // Special cases: 'all' (no filter), 'refund_required' (uses offer status), 'pending' (maps to unpaid/partial)
    if (status !== 'all') {
      if (status === 'refund_required') {
        query.andWhere('offer.status = :status', {
          status: OfferLetterStatus.REJECTED_BY_PAYMENT,
        });
      } else if (status === 'pending') {
        // 'pending' means payments that are not fully paid yet (unpaid or partial)
        query.andWhere('offer.payment_status IN (:...pendingStatuses)', {
          pendingStatuses: [
            OfferPaymentStatus.UNPAID,
            OfferPaymentStatus.PARTIAL,
          ],
        });
      } else if (
        Object.values(OfferPaymentStatus).includes(status as OfferPaymentStatus)
      ) {
        // Only apply filter if it's a valid PaymentStatus enum value
        query.andWhere('offer.payment_status = :paymentStatus', {
          paymentStatus: status,
        });
      }
      // If status is not recognized, don't apply any filter (treat as 'all')
    }

    // Apply search filter
    if (search) {
      query.andWhere(
        '(kyc.first_name ILIKE :search OR kyc.last_name ILIKE :search OR property.property_name ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    // Get total count
    const total = await query.getCount();

    // Apply pagination
    const offers = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    // Get payment history for each offer
    const payments = await Promise.all(
      offers.map(async (offer) => {
        const paymentHistory = await this.paymentRepository.find({
          where: { offer_letter_id: offer.id },
          order: { created_at: 'DESC' },
        });

        return {
          id: offer.id,
          offerLetterId: offer.id,
          tenantName: `${offer.kyc_application.first_name} ${offer.kyc_application.last_name}`,
          tenantEmail: offer.kyc_application.email,
          tenantPhone: offer.kyc_application.phone_number,
          propertyName: offer.property.name,
          propertyId: offer.property_id,
          totalAmount: Number(offer.total_amount),
          amountPaid: Number(offer.amount_paid),
          outstandingBalance: Number(offer.outstanding_balance),
          paymentStatus: offer.payment_status,
          offerStatus: offer.status,
          requiresRefund:
            offer.status === OfferLetterStatus.REJECTED_BY_PAYMENT ||
            offer.status === OfferLetterStatus.PAYMENT_HELD_RACE_CONDITION,
          lastPaymentDate:
            paymentHistory.length > 0 ? paymentHistory[0].paid_at : null,
          paymentHistory: paymentHistory.map((p) => ({
            id: p.id,
            amount: Number(p.amount),
            status: p.status,
            paymentMethod: p.payment_method,
            paidAt: p.paid_at,
            reference: p.paystack_reference,
            date: p.paid_at
              ? p.paid_at.toISOString().split('T')[0]
              : p.created_at.toISOString().split('T')[0],
          })),
        };
      }),
    );

    // Separate refunds required
    const refundsRequired = payments
      .filter((p) => p.requiresRefund)
      .map((p) => ({
        id: p.id,
        tenantName: p.tenantName,
        propertyName: p.propertyName,
        amountPaid: p.amountPaid,
        reason:
          p.offerStatus === OfferLetterStatus.REJECTED_BY_PAYMENT
            ? 'Property secured by another applicant'
            : 'Payment received after property was occupied',
        offerStatus: p.offerStatus,
        tenantContact: p.tenantPhone,
      }));

    return {
      payments: payments.filter((p) => !p.requiresRefund),
      refundsRequired,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find payment by ID
   */
  async findById(paymentId: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: { id: paymentId },
      relations: ['offerLetter'],
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return payment;
  }

  /**
   * Mark payment as failed
   */
  async markAsFailed(paymentId: string, data: any): Promise<void> {
    // Get payment with offer letter details
    const payment = await this.paymentRepository.findOne({
      where: { id: paymentId },
      relations: [
        'offerLetter',
        'offerLetter.property',
        'offerLetter.kyc_application',
      ],
    });

    await this.paymentRepository.update(paymentId, {
      status: PaymentStatus.FAILED,
      metadata: data,
    });

    await this.logPaymentEvent(paymentId, PaymentLogEventType.ERROR, {
      reason: 'Payment failed',
      paystack_data: data,
    });

    // Create property history event for failed payment
    if (payment?.offerLetter) {
      const kycApplication = payment.offerLetter.kyc_application;
      const tenantName = kycApplication
        ? `${kycApplication.first_name} ${kycApplication.last_name}`
        : 'Tenant';

      await this.createPaymentHistoryEvent(
        payment.offerLetter.property_id,
        'payment_failed',
        `Payment of ₦${Number(payment.amount).toLocaleString()} from ${tenantName} failed or timed out`,
        payment.id,
        'payment',
      );
    }
  }

  /**
   * Log payment event
   */
  private async logPaymentEvent(
    paymentId: string,
    eventType: PaymentLogEventType,
    eventData: any,
  ): Promise<void> {
    await this.paymentLogRepository.save({
      payment_id: paymentId,
      event_type: eventType,
      event_data: eventData,
    });
  }

  /**
   * Create property history event for livefeed
   * Helper method for all payment-related property history events
   */
  private async createPaymentHistoryEvent(
    propertyId: string,
    eventType: string,
    description: string,
    relatedEntityId: string,
    relatedEntityType: 'payment' | 'offer_letter',
    tenantId?: string | null,
  ): Promise<void> {
    try {
      await this.propertyHistoryService.createPropertyHistory({
        property_id: propertyId,
        tenant_id: tenantId ?? null,
        event_type: eventType,
        event_description: description,
        related_entity_id: relatedEntityId,
        related_entity_type: relatedEntityType,
      });

      this.paystackLogger.info('Property history event created', {
        property_id: propertyId,
        event_type: eventType,
        related_entity_id: relatedEntityId,
      });
    } catch (error) {
      this.paystackLogger.error('Failed to create property history event', {
        property_id: propertyId,
        event_type: eventType,
        error: error.message,
      });
    }
  }

  /**
   * Notify landlord of ANY payment (partial or full)
   * Called after every successful payment
   * Uses the same template for consistency
   * Requirements: Phase 5 - Task 19.3
   */
  private async notifyLandlordPaymentReceived(
    offerLetter: OfferLetter,
    payment: Payment,
    newOutstandingBalance: number,
  ): Promise<void> {
    try {
      const landlord = await this.usersRepository.findOne({
        where: { id: offerLetter.property.owner_id },
      });

      const kycApplication = await this.kycApplicationRepository.findOne({
        where: { id: offerLetter.kyc_application_id },
      });

      if (!landlord?.phone_number || !kycApplication) {
        this.paystackLogger.warn('Cannot send landlord payment notification', {
          offer_id: offerLetter.id,
          reason: 'Missing landlord phone or KYC application',
        });
        return;
      }

      await this.templateSenderService.sendLandlordPaymentReceived({
        phone_number: landlord.phone_number,
        landlord_name: `${landlord.first_name} ${landlord.last_name}`,
        tenant_name: `${kycApplication.first_name} ${kycApplication.last_name}`,
        property_name: offerLetter.property.name,
        amount: Number(payment.amount),
        outstanding_balance: newOutstandingBalance,
      });

      this.paystackLogger.info('Landlord payment notification sent', {
        offer_id: offerLetter.id,
        landlord_id: landlord.id,
        amount: payment.amount,
        outstanding_balance: newOutstandingBalance,
      });
    } catch (error) {
      this.paystackLogger.error(
        'Failed to send landlord payment notification',
        {
          offer_id: offerLetter.id,
          error: error.message,
        },
      );
    }
  }

  /**
   * Notify landlord when tenant completes 100% payment and wins property
   * DEPRECATED: Now using ll_payment_received for all payments (partial and full)
   * Keeping this method for reference but it's no longer called
   * Requirements: Phase 5 - Task 19.4
   */
  /*
  private async notifyLandlordPaymentComplete(
    offerLetter: OfferLetter,
    property: Property,
  ): Promise<void> {
    try {
      const landlord = await this.usersRepository.findOne({
        where: { id: property.owner_id },
      });

      const kycApplication = await this.kycApplicationRepository.findOne({
        where: { id: offerLetter.kyc_application_id },
      });

      if (!landlord?.phone_number || !kycApplication) {
        this.paystackLogger.warn('Cannot send landlord complete notification', {
          offer_id: offerLetter.id,
        });
        return;
      }

      await this.templateSenderService.sendLandlordPaymentComplete({
        phone_number: landlord.phone_number,
        landlord_name: `${landlord.first_name} ${landlord.last_name}`,
        tenant_name: `${kycApplication.first_name} ${kycApplication.last_name}`,
        property_name: property.name,
        total_amount: Number(offerLetter.total_amount),
        property_id: property.id,
      });

      this.paystackLogger.info('Landlord payment complete notification sent', {
        offer_id: offerLetter.id,
        landlord_id: landlord.id,
      });
    } catch (error) {
      this.paystackLogger.error(
        'Failed to send landlord complete notification',
        {
          offer_id: offerLetter.id,
          error: error.message,
        },
      );
    }
  }
  */

  /**
   * Notify winning tenant
   * Requirements: Phase 5 - Task 19.1
   */
  private async notifyWinningTenant(
    offerLetter: OfferLetter,
    property: Property,
  ): Promise<void> {
    try {
      const kycApplication = await this.kycApplicationRepository.findOne({
        where: { id: offerLetter.kyc_application_id },
      });

      if (!kycApplication?.phone_number) {
        this.paystackLogger.warn('Cannot send winning tenant notification', {
          offer_id: offerLetter.id,
        });
        return;
      }

      await this.templateSenderService.sendTenantPaymentSuccess({
        phone_number: kycApplication.phone_number,
        tenant_name: `${kycApplication.first_name} ${kycApplication.last_name}`,
        property_name: property.name,
        total_amount: Number(offerLetter.total_amount),
      });

      this.paystackLogger.info('Winning tenant notification sent', {
        offer_id: offerLetter.id,
        kyc_application_id: kycApplication.id,
      });
    } catch (error) {
      this.paystackLogger.error('Failed to send winning tenant notification', {
        offer_id: offerLetter.id,
        error: error.message,
      });
    }
  }

  /**
   * Notify losing tenant
   * Requirements: Phase 5 - Task 19.2
   */
  private async notifyLosingTenant(
    offerLetter: OfferLetter,
    property: Property,
  ): Promise<void> {
    try {
      const kycApplication = await this.kycApplicationRepository.findOne({
        where: { id: offerLetter.kyc_application_id },
      });

      if (!kycApplication?.phone_number) {
        this.paystackLogger.warn('Cannot send losing tenant notification', {
          offer_id: offerLetter.id,
        });
        return;
      }

      await this.templateSenderService.sendTenantPaymentRefund({
        phone_number: kycApplication.phone_number,
        tenant_name: `${kycApplication.first_name} ${kycApplication.last_name}`,
        property_name: property.name,
        amount_paid: Number(offerLetter.amount_paid),
      });

      this.paystackLogger.info('Losing tenant notification sent', {
        offer_id: offerLetter.id,
        kyc_application_id: kycApplication.id,
        amount_paid: offerLetter.amount_paid,
      });
    } catch (error) {
      this.paystackLogger.error('Failed to send losing tenant notification', {
        offer_id: offerLetter.id,
        error: error.message,
      });
    }
  }

  /**
   * Notify landlord of race condition
   * Requirements: Phase 5 - Task 19.5.1
   */
  private async notifyLandlordRaceCondition(
    offerLetter: OfferLetter,
  ): Promise<void> {
    try {
      const landlord = await this.usersRepository.findOne({
        where: { id: offerLetter.property.owner_id },
      });

      const kycApplication = await this.kycApplicationRepository.findOne({
        where: { id: offerLetter.kyc_application_id },
      });

      if (!landlord?.phone_number || !kycApplication) {
        this.paystackLogger.warn(
          'Cannot send landlord race condition notification',
          {
            offer_id: offerLetter.id,
          },
        );
        return;
      }

      await this.templateSenderService.sendLandlordRaceCondition({
        phone_number: landlord.phone_number,
        landlord_name: `${landlord.first_name} ${landlord.last_name}`,
        tenant_name: `${kycApplication.first_name} ${kycApplication.last_name}`,
        property_name: offerLetter.property.name,
        amount: Number(offerLetter.amount_paid),
      });

      this.paystackLogger.info('Landlord race condition notification sent', {
        offer_id: offerLetter.id,
        landlord_id: landlord.id,
      });
    } catch (error) {
      this.paystackLogger.error(
        'Failed to send landlord race condition notification',
        {
          offer_id: offerLetter.id,
          error: error.message,
        },
      );
    }
  }

  /**
   * Notify tenant of race condition
   * Requirements: Phase 5 - Task 19.5.2
   */
  private async notifyTenantRaceCondition(
    offerLetter: OfferLetter,
  ): Promise<void> {
    try {
      const kycApplication = await this.kycApplicationRepository.findOne({
        where: { id: offerLetter.kyc_application_id },
      });

      if (!kycApplication?.phone_number) {
        this.paystackLogger.warn(
          'Cannot send tenant race condition notification',
          {
            offer_id: offerLetter.id,
          },
        );
        return;
      }

      await this.templateSenderService.sendTenantRaceCondition({
        phone_number: kycApplication.phone_number,
        tenant_name: `${kycApplication.first_name} ${kycApplication.last_name}`,
        property_name: offerLetter.property.name,
        amount: Number(offerLetter.amount_paid),
      });

      this.paystackLogger.info('Tenant race condition notification sent', {
        offer_id: offerLetter.id,
        kyc_application_id: kycApplication.id,
      });
    } catch (error) {
      this.paystackLogger.error(
        'Failed to send tenant race condition notification',
        {
          offer_id: offerLetter.id,
          error: error.message,
        },
      );
    }
  }

  /**
   * Check for expired payments (runs every 5 minutes)
   */
  @Cron('*/5 * * * *')
  async checkExpiredPayments(): Promise<void> {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    const expiredPayments = await this.paymentRepository.find({
      where: {
        status: PaymentStatus.PENDING,
        created_at: LessThan(thirtyMinutesAgo),
      },
    });

    for (const payment of expiredPayments) {
      try {
        // Verify with Paystack one last time
        const verification = await this.paystackService.verifyTransaction(
          payment.paystack_reference,
        );

        if (verification.data.status !== 'success') {
          await this.markAsFailed(payment.id, {
            reason: 'timeout',
            last_check: verification.data,
          });

          this.paystackLogger.info('Payment marked as failed due to timeout', {
            payment_id: payment.id,
            reference: payment.paystack_reference,
          });
        } else {
          // Payment was successful, process it
          await this.processSuccessfulPayment(verification.data);
        }
      } catch (error) {
        this.paystackLogger.error('Error checking expired payment', {
          payment_id: payment.id,
          error: error.message,
        });
      }
    }
  }
}

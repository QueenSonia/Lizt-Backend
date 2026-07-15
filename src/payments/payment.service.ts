import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, LessThan, In } from 'typeorm';
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
import { Account } from '../users/entities/account.entity';
import { KYCApplication } from '../kyc-links/entities/kyc-application.entity';
import {
  ACTIVE_PAYMENT_GATEWAY,
  DuplicateReferenceError,
  GatewayReferenceNotFoundError,
  NormalizedPaymentEvent,
  PaymentGateway,
  VerifyPaymentResult,
} from './gateway/payment-gateway.interface';
import { GatewayRegistryService } from './gateway/gateway-registry.service';
import { PaystackLogger } from './paystack-logger.service';
import { TenantAttachmentService } from '../kyc-links/tenant-attachment.service';
import { PropertyHistoryService } from '../property-history/property-history.service';
import { TemplateSenderService } from '../whatsapp-bot/template-sender/template-sender.service';
import { WhatsAppNotificationLogService } from '../whatsapp-bot/whatsapp-notification-log.service';
import { UtilService } from '../utils/utility-service';
import { InitiatePaymentDto, InitiatePaymentResponseDto } from './dto';
import { InvoicesService } from '../invoices/invoices.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/enums/notification-type';
import { EventsGateway } from '../events/events.gateway';
import { ReceiptGeneratorService } from '../receipts/receipt-generator.service';
import { NotificationRecipientsService } from 'src/common/notify/notification-recipients.service';
import { NotificationCategory } from 'src/common/notify/notification-category.enum';

// In-memory lock to prevent concurrent processing of the same payment reference
const processingLocks = new Map<string, boolean>();

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

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
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepository: Repository<KYCApplication>,
    @Inject(ACTIVE_PAYMENT_GATEWAY)
    private readonly gateway: PaymentGateway,
    private readonly gatewayRegistry: GatewayRegistryService,
    private readonly paystackLogger: PaystackLogger,
    private readonly tenantAttachmentService: TenantAttachmentService,
    private readonly propertyHistoryService: PropertyHistoryService,
    private readonly templateSenderService: TemplateSenderService,
    @Inject(forwardRef(() => InvoicesService))
    private readonly invoicesService: InvoicesService,
    private readonly notificationService: NotificationService,
    private readonly eventsGateway: EventsGateway,
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => ReceiptGeneratorService))
    private readonly receiptGeneratorService: ReceiptGeneratorService,
    private readonly whatsappNotificationLog: WhatsAppNotificationLogService,
    private readonly notificationRecipients: NotificationRecipientsService,
    private readonly utilService: UtilService,
  ) {}

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

    // Generate unique reference with retry logic for collision handling.
    // Two duplicate sources exist here: the DB unique constraint on
    // payments.gateway_reference (23505) and the gateway's own duplicate-
    // reference rejection (typed DuplicateReferenceError from the adapter).
    const maxRetries = 3;
    let reference = '';
    let payment: Payment | null = null;
    let initResult: Awaited<
      ReturnType<PaymentGateway['initializePayment']>
    > | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      reference = `LIZT_${Date.now()}_${uuidv4().substring(0, 8)}`;

      try {
        initResult = await this.gateway.initializePayment({
          amountNaira: dto.amount,
          email: dto.email,
          customerName: `${offerLetter.kyc_application.first_name} ${offerLetter.kyc_application.last_name}`,
          reference,
          callbackUrl: dto.callbackUrl,
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
          gateway_reference: reference,
          gateway_transaction_id: initResult.gatewayTransactionId,
          gateway_checkout_url: initResult.checkoutUrl,
          // Stamp the adapter that ISSUED the reference — never the env
          // default — so row-first verification always asks the right
          // gateway, even across a cutover deploy.
          gateway: initResult.gateway,
        });

        // Success - break out of retry loop
        break;
      } catch (error) {
        // DB duplicate (PostgreSQL 23505) or gateway-side duplicate reference
        const isDuplicateError =
          error instanceof DuplicateReferenceError ||
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
    if (!payment || !initResult) {
      throw new BadRequestException('Failed to create payment after retries');
    }

    // Log initiation
    void this.logPaymentEvent(payment.id, PaymentLogEventType.INITIATION, {
      offer_letter_id: offerLetter.id,
      property_id: offerLetter.property_id,
      amount: dto.amount,
      reference,
      gateway: initResult.gateway,
      gateway_init_response: initResult,
    });

    // Calculate expiry from the gateway's checkout validity window
    // (Paystack access codes ~30 min, Monnify checkoutUrl 40 min).
    const expiresAt = new Date(
      Date.now() + this.gateway.checkoutExpiryMinutes * 60 * 1000,
    ).toISOString();

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

    // Payment verification is handled by Paystack webhooks
    // No polling needed - webhook will call processSuccessfulPayment when payment completes

    return {
      paymentId: payment.id,
      reference,
      checkoutUrl: initResult.checkoutUrl,
      expiresAt,
      // Deprecated legacy popup fields — populated only while the active
      // gateway is Paystack, dropped in the legacy-retire pass. Keeps
      // long-lived open tenant tabs (old frontend bundle) working across
      // the deploy boundary.
      ...(initResult.gateway === 'paystack'
        ? {
            paystackReference: reference,
            accessCode: initResult.gatewayTransactionId ?? undefined,
            authorizationUrl: initResult.checkoutUrl,
          }
        : {}),
    };
  }

  /**
   * Process a successful payment (called by webhook or polling)
   * Uses in-memory locking + database locks to prevent double processing
   * and avoid deadlocks from concurrent webhook/polling calls
   */
  async processSuccessfulPayment(event: NormalizedPaymentEvent): Promise<void> {
    const reference = event.reference;
    this.paystackLogger.info('Starting processSuccessfulPayment', {
      reference,
      gateway: event.gateway,
    });

    // 1. Early idempotency check BEFORE acquiring any locks
    const existingPayment = await this.paymentRepository.findOne({
      where: { gateway_reference: reference },
    });

    if (!existingPayment) {
      this.paystackLogger.error('Payment not found', { reference });
      throw new Error(`Payment not found for reference: ${reference}`);
    }

    if (existingPayment.status === PaymentStatus.COMPLETED) {
      this.paystackLogger.info(
        'Payment already completed (early check), skipping',
        {
          payment_id: existingPayment.id,
          reference,
        },
      );
      return;
    }

    // Amount sanity guard (100x unit-bug detector). This processor credits
    // the ROW amount (payment.amount) — the amount the tenant agreed to pay
    // at init — so the gateway-reported amount must match it. Receiving LESS
    // than the row amount must never grant full credit: quarantine for ops
    // instead of processing. Receiving more is logged and still credits only
    // the row amount.
    const expectedNaira = Number(existingPayment.amount);
    if (event.amountNaira + 1 < expectedNaira) {
      this.paystackLogger.error(
        'Amount mismatch — gateway reports LESS than the initialized amount; NOT crediting',
        {
          reference,
          gateway: event.gateway,
          expected: expectedNaira,
          received: event.amountNaira,
        },
      );
      await this.logPaymentEvent(
        existingPayment.id,
        PaymentLogEventType.ERROR,
        {
          reason: 'amount_mismatch_underpaid',
          expected: expectedNaira,
          received: event.amountNaira,
          gateway: event.gateway,
        },
      );
      return;
    }
    if (event.amountNaira > expectedNaira + 1) {
      this.paystackLogger.warn(
        'Amount mismatch — gateway reports MORE than the initialized amount; crediting the initialized amount, surplus needs ops reconciliation',
        {
          reference,
          gateway: event.gateway,
          expected: expectedNaira,
          received: event.amountNaira,
        },
      );
      void this.logPaymentEvent(existingPayment.id, PaymentLogEventType.ERROR, {
        reason: 'amount_mismatch_overpaid',
        expected: expectedNaira,
        received: event.amountNaira,
        gateway: event.gateway,
      }).catch(() => undefined);
    }

    // 2. In-memory lock to prevent concurrent processing of the same reference
    if (processingLocks.get(reference)) {
      this.paystackLogger.info(
        'Payment already being processed by another request, skipping',
        {
          reference,
        },
      );
      return;
    }

    // Acquire in-memory lock
    processingLocks.set(reference, true);

    // Variables to capture transaction results for post-transaction operations
    let processedPaymentId: string | null = null;
    let processedOfferLetterId: string | null = null;
    let processedAmount: number | null = null;
    let processedPropertyId: string | null = null;
    let processedPropertyName: string | null = null;
    let processedTenantName: string | null = null;
    let processedLandlordId: string | null = null;
    let processedIsFullyPaid = false;
    let processedOutstandingBalance = 0;
    let wasPropertySecured = false;
    let wasRaceCondition = false;

    try {
      // TRANSACTION: Only critical database updates
      await this.dataSource.transaction(async (manager) => {
        this.paystackLogger.debug('Transaction started', { reference });

        // 3. Lock the payment row with NOWAIT to fail fast if locked
        const payment = await manager
          .getRepository(Payment)
          .createQueryBuilder('payment')
          .where('payment.gateway_reference = :reference', { reference })
          .setLock('pessimistic_write_or_fail')
          .getOne();

        if (!payment) {
          throw new Error(`Payment not found for reference: ${reference}`);
        }

        // Double-check status after acquiring lock
        if (payment.status === PaymentStatus.COMPLETED) {
          this.paystackLogger.info(
            'Payment already completed (after lock), skipping',
            {
              payment_id: payment.id,
            },
          );
          return;
        }

        // 4. Load the offer letter (no lock needed for read)
        const offerLetter = await manager.getRepository(OfferLetter).findOne({
          where: { id: payment.offer_letter_id },
          relations: ['property'],
        });

        if (!offerLetter) {
          throw new Error(
            `Offer letter ${payment.offer_letter_id} not found for payment ${payment.id}`,
          );
        }

        // 5. Lock the property row - use NOWAIT to fail fast
        const property = await manager
          .getRepository(Property)
          .createQueryBuilder('property')
          .where('property.id = :id', { id: offerLetter.property_id })
          .setLock('pessimistic_write_or_fail')
          .getOne();

        if (!property) {
          throw new Error(`Property ${offerLetter.property_id} not found`);
        }

        // Update payment status
        await manager.update(Payment, payment.id, {
          status: PaymentStatus.COMPLETED,
          payment_method: (event.channel || null) as Payment['payment_method'],
          paid_at: event.paidAt ?? new Date(),
          metadata: event.raw ?? event,
        });
        this.paystackLogger.debug('Payment status updated to COMPLETED', {
          payment_id: payment.id,
        });

        // Update offer letter amounts
        const amountToAdd = Number(payment.amount);
        const currentAmountPaid = Number(offerLetter.amount_paid || 0);
        const totalAmount = Number(offerLetter.total_amount);

        const newAmountPaid = currentAmountPaid + amountToAdd;
        const rawOutstandingBalance = totalAmount - newAmountPaid;

        // Calculate credit balance if overpayment occurred
        let newCreditBalance = Number(offerLetter.credit_balance || 0);
        let newOutstandingBalance = 0;

        if (rawOutstandingBalance < 0) {
          // Overpayment: add excess to credit balance
          newCreditBalance += Math.abs(rawOutstandingBalance);
          newOutstandingBalance = 0;
        } else {
          newOutstandingBalance = rawOutstandingBalance;
        }

        // Use a small epsilon for zero-check to handle floating point
        const isFullyPaid = newOutstandingBalance < 0.01;

        await manager.update(OfferLetter, offerLetter.id, {
          amount_paid: newAmountPaid,
          outstanding_balance: isFullyPaid ? 0 : newOutstandingBalance,
          credit_balance: newCreditBalance,
          payment_status: isFullyPaid
            ? OfferPaymentStatus.FULLY_PAID
            : OfferPaymentStatus.PARTIAL,
        });
        this.paystackLogger.debug('Offer letter amounts updated', {
          offer_id: offerLetter.id,
          newAmountPaid,
          newOutstandingBalance,
          isFullyPaid,
        });

        // Get tenant name for history
        const kycApplication = await manager.findOne(KYCApplication, {
          where: { id: offerLetter.kyc_application_id },
        });
        const tenantName = kycApplication
          ? `${kycApplication.first_name} ${kycApplication.last_name}`
          : 'Tenant';

        // Handle property securing or race condition (critical - must be in transaction)
        if (isFullyPaid && property.property_status !== 'occupied') {
          this.paystackLogger.info('Securing property for tenant', {
            property_id: property.id,
            tenant: tenantName,
          });

          await this.attachTenantAndRejectOthers(
            manager,
            offerLetter,
            property,
          );
          wasPropertySecured = true;
        } else if (isFullyPaid && property.property_status === 'occupied') {
          this.paystackLogger.warn(
            'Race condition: Property already occupied',
            { property_id: property.id },
          );
          await this.handleRaceCondition(manager, offerLetter);
          wasRaceCondition = true;
        }

        // Capture data for post-transaction operations
        processedPaymentId = payment.id;
        processedOfferLetterId = offerLetter.id;
        processedAmount = amountToAdd;
        processedPropertyId = property.id;
        processedPropertyName = property.name;
        processedTenantName = tenantName;
        processedLandlordId = offerLetter.landlord_id;
        processedIsFullyPaid = isFullyPaid;
        processedOutstandingBalance = newOutstandingBalance;
      });

      this.paystackLogger.info('Transaction committed successfully', {
        reference,
      });

      // POST-TRANSACTION: Non-critical operations (notifications, history, etc.)
      // These run AFTER the transaction commits, so they won't cause transaction timeouts
      if (processedPaymentId && processedPropertyId) {
        // Fire-and-forget: Create history events
        this.createPaymentHistoryEvent(
          processedPropertyId,
          wasPropertySecured
            ? 'payment_completed_full'
            : wasRaceCondition
              ? 'payment_race_condition'
              : 'payment_completed_partial',
          wasPropertySecured
            ? `${processedTenantName} completed full payment and secured ${processedPropertyName}`
            : wasRaceCondition
              ? `Payment received from ${processedTenantName} after property was occupied. Refund required.`
              : `${processedTenantName} paid for ${processedPropertyName}. Outstanding: ₦${processedOutstandingBalance.toLocaleString()}`,
          processedPaymentId,
          'payment',
        ).catch((err) => {
          this.paystackLogger.error('Failed to create history event', {
            error: err.message,
          });
        });

        // Fire-and-forget: Notify landlord
        if (processedOfferLetterId) {
          this.offerLetterRepository
            .findOne({
              where: { id: processedOfferLetterId },
              relations: ['property'],
            })
            .then((offerLetter) => {
              if (offerLetter) {
                return this.paymentRepository
                  .findOne({ where: { id: processedPaymentId! } })
                  .then((payment) => {
                    if (payment) {
                      return this.notifyLandlordPaymentReceived(
                        offerLetter,
                        payment,
                        processedOutstandingBalance,
                      );
                    }
                  });
              }
            })
            .catch((err) => {
              this.paystackLogger.error('Failed to notify landlord', {
                error: err.message,
              });
            });
        }

        // Fire-and-forget: Create live feed notification
        this.notificationService
          .create({
            date: new Date().toISOString(),
            type: NotificationType.PAYMENT_RECEIVED,
            description: processedIsFullyPaid
              ? `${processedTenantName} completed full payment of ₦${processedAmount!.toLocaleString()} for ${processedPropertyName}`
              : `${processedTenantName} paid ₦${processedAmount!.toLocaleString()} for ${processedPropertyName}. Outstanding: ₦${processedOutstandingBalance.toLocaleString()}`,
            status: 'Completed',
            property_id: processedPropertyId,
            user_id: processedLandlordId!,
          })
          .then(() => {
            // Emit WebSocket event for real-time notification
            this.eventsGateway.emitPaymentReceived(processedLandlordId!, {
              propertyId: processedPropertyId!,
              propertyName: processedPropertyName!,
              applicantName: processedTenantName!,
              amount: processedAmount!,
              isFullyPaid: processedIsFullyPaid,
            });
          })
          .catch((err) => {
            this.paystackLogger.error(
              'Failed to create live feed notification',
              {
                error: err.message,
              },
            );
          });

        // Fire-and-forget: Record invoice
        this.invoicesService
          .recordPaymentFromOfferLetter(
            processedOfferLetterId!,
            processedAmount!,
            reference,
            event.channel || 'card',
            processedPaymentId,
          )
          .catch((err) => {
            this.paystackLogger.error('Invoice recording failed', {
              error: err.message,
            });
          });

        // Fire-and-forget: Generate receipt, then create receipt_sent event and notify winning tenant
        this.receiptGeneratorService
          .generateReceipt({
            paymentId: processedPaymentId,
            offerLetterId: processedOfferLetterId!,
            amount: processedAmount!,
            paymentMethod: event.channel || 'card',
            paymentReference: reference,
            paidAt: event.paidAt ?? new Date(),
          })
          .then(async (savedReceipt) => {
            // After receipt is generated and shareable link is available, create receipt_sent event
            try {
              await this.propertyHistoryService.createPropertyHistory({
                property_id: savedReceipt.property_id,
                tenant_id: savedReceipt.kyc_application_id
                  ? (
                      await this.kycApplicationRepository.findOne({
                        where: { id: savedReceipt.kyc_application_id },
                      })
                    )?.tenant_id || null
                  : null,
                event_type: 'receipt_sent',
                event_description: `Receipt sent to ${savedReceipt.tenant_name} for ${savedReceipt.property_name}`,
                related_entity_id: savedReceipt.id,
                related_entity_type: 'receipt',
              });

              await this.notificationService.create({
                date: new Date().toISOString(),
                type: NotificationType.RECEIPT_SENT,
                description: `Receipt sent to ${savedReceipt.tenant_name} for ${savedReceipt.property_name}`,
                status: 'Completed',
                property_id: savedReceipt.property_id,
                user_id: processedLandlordId!,
              });
            } catch (error) {
              this.paystackLogger.error(
                'Failed to create receipt_sent history/notification:',
                { error: error.message },
              );
            }

            // Notify winning tenant AFTER receipt is generated so receipt link is available
            if (wasPropertySecured && processedOfferLetterId) {
              try {
                const offerLetter = await this.offerLetterRepository.findOne({
                  where: { id: processedOfferLetterId },
                  relations: ['property'],
                });
                if (offerLetter?.property) {
                  await this.notifyWinningTenant(
                    offerLetter,
                    offerLetter.property,
                    savedReceipt.token,
                  );
                }
              } catch (error) {
                this.paystackLogger.error(
                  'Failed to send winning tenant notification after receipt:',
                  { error: error.message },
                );
              }
            }
          })
          .catch((err) => {
            this.paystackLogger.error('Receipt generation failed', {
              error: err.message,
            });
          });

        // Fire-and-forget: Log payment event
        this.logPaymentEvent(
          processedPaymentId,
          PaymentLogEventType.VERIFICATION,
          {
            event: 'payment.success',
            gateway: event.gateway,
            processed: true,
            amount: processedAmount,
          },
        ).catch((err) => {
          this.paystackLogger.error('Failed to log payment event', {
            error: err.message,
          });
        });
      }
    } catch (error) {
      // Handle lock acquisition failure gracefully
      if (
        error.message?.includes('could not obtain lock') ||
        error.code === '55P03' || // lock_not_available
        error.message?.includes('FOR UPDATE')
      ) {
        this.paystackLogger.info(
          'Could not acquire lock, another transaction is processing this payment',
          {
            reference,
            error: error.message,
          },
        );
        // Don't rethrow - this is expected when concurrent requests hit
        return;
      }

      this.paystackLogger.error('processSuccessfulPayment failed', {
        reference,
        error: error.message,
        stack: error.stack,
      });
      throw error; // Rethrow to allow proper error handling
    } finally {
      // Always release the in-memory lock
      processingLocks.delete(reference);
    }
  }

  /**
   * Attach winning tenant and reject other offers
   * Only performs critical database operations - notifications are handled post-transaction
   */
  private async attachTenantAndRejectOthers(
    manager: EntityManager,
    winningOffer: OfferLetter,
    property: Property,
  ): Promise<void> {
    // Update property to occupied and remove from marketing
    await manager.update(Property, property.id, {
      property_status: 'occupied',
      is_marketing_ready: false,
    });

    // Update winning offer
    await manager.update(OfferLetter, winningOffer.id, {
      status: OfferLetterStatus.SELECTED,
      selected_at: new Date(),
    });

    // Attach tenant to property (critical - must be in transaction)
    await this.tenantAttachmentService.attachTenantFromOffer(
      manager,
      winningOffer,
    );

    // Find all other offers with payments for this property
    const losingOffers = await manager
      .getRepository(OfferLetter)
      .createQueryBuilder('offer')
      .where('offer.property_id = :propertyId', { propertyId: property.id })
      .andWhere('offer.id != :winnerId', { winnerId: winningOffer.id })
      .andWhere('offer.amount_paid > 0')
      .getMany();

    // Update losing offers (critical - must be in transaction)
    for (const losingOffer of losingOffers) {
      await manager.update(OfferLetter, losingOffer.id, {
        status: OfferLetterStatus.REJECTED_BY_PAYMENT,
      });
    }

    this.paystackLogger.info('Tenant attached and others rejected', {
      winning_offer_id: winningOffer.id,
      property_id: property.id,
      losing_offers_count: losingOffers.length,
    });

    // Queue losing tenant notifications (logged to DB, sent async with retries)
    for (const losingOffer of losingOffers) {
      try {
        const kycApplication = await this.kycApplicationRepository.findOne({
          where: { id: losingOffer.kyc_application_id },
        });

        if (kycApplication?.phone_number) {
          await this.whatsappNotificationLog.queue(
            'sendTenantPaymentRefund',
            {
              phone_number: kycApplication.phone_number,
              tenant_name: this.utilService.formatPersonName(
                kycApplication.first_name,
                kycApplication.last_name,
              ),
              property_name: property.name,
              amount_paid: Number(losingOffer.amount_paid),
              landlord_id: property.owner_id,
              recipient_name: this.utilService.formatPersonName(
                kycApplication.first_name,
                kycApplication.last_name,
              ),
            },
            losingOffer.id,
          );
        }
      } catch (err) {
        this.paystackLogger.error(
          'Failed to queue losing tenant notification',
          {
            offer_id: losingOffer.id,
            error: err.message,
          },
        );
      }
    }
  }

  /**
   * Handle race condition when property is already occupied
   * Only performs critical database operations - notifications are handled post-transaction
   */
  private async handleRaceCondition(
    manager: EntityManager,
    offerLetter: OfferLetter,
  ): Promise<void> {
    // Update offer status (critical - must be in transaction)
    await manager.update(OfferLetter, offerLetter.id, {
      status: OfferLetterStatus.PAYMENT_HELD_RACE_CONDITION,
    });

    // Log race condition
    this.paystackLogger.error('Race condition detected', {
      offer_id: offerLetter.id,
      property_id: offerLetter.property_id,
      amount_paid: offerLetter.amount_paid,
    });

    // Queue race condition notifications (logged to DB, sent async with retries)
    try {
      const kycApplication = await this.kycApplicationRepository.findOne({
        where: { id: offerLetter.kyc_application_id },
      });

      if (kycApplication) {
        const recipients = await this.notificationRecipients.resolveRecipients(
          offerLetter.property.owner_id,
          NotificationCategory.PAYMENTS,
        );
        for (const [index, recipient] of recipients.entries()) {
          if (!recipient.phone) continue;
          await this.whatsappNotificationLog.queue(
            'sendLandlordRaceCondition',
            {
              phone_number: recipient.phone,
              landlord_name: recipient.name,
              tenant_name: this.utilService.formatPersonName(
                kycApplication.first_name,
                kycApplication.last_name,
              ),
              property_name: offerLetter.property.name,
              amount: Number(offerLetter.amount_paid),
              landlord_id: offerLetter.property.owner_id,
              recipient_name: recipient.name,
            },
            index === 0
              ? offerLetter.id
              : `${offerLetter.id}:${recipient.accountId}`,
          );
        }
      }

      if (kycApplication?.phone_number) {
        await this.whatsappNotificationLog.queue(
          'sendTenantRaceCondition',
          {
            phone_number: kycApplication.phone_number,
            tenant_name: this.utilService.formatPersonName(
              kycApplication.first_name,
              kycApplication.last_name,
            ),
            property_name: offerLetter.property.name,
            amount: Number(offerLetter.amount_paid),
            landlord_id: offerLetter.property.owner_id,
            recipient_name: this.utilService.formatPersonName(
              kycApplication.first_name,
              kycApplication.last_name,
            ),
          },
          offerLetter.id,
        );
      }
    } catch (err) {
      this.paystackLogger.error(
        'Failed to queue race condition notifications',
        { offer_id: offerLetter.id, error: err.message },
      );
    }
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

    // Get receipts for these payments. Guard the empty case: TypeORM expands
    // an empty array into `IN ()`, which Postgres rejects — a letter with no
    // payments yet would 500 the whole endpoint.
    const paymentIds = payments.map((p) => p.id);
    const receipts = paymentIds.length
      ? await this.dataSource
          .getRepository('receipts')
          .createQueryBuilder('receipt')
          .where('receipt.payment_id IN (:...paymentIds)', { paymentIds })
          .getMany()
      : [];

    const receiptsByPaymentId = new Map(
      receipts.map((r: any) => [r.payment_id, r.token]),
    );

    const paymentHistory = payments.map((payment) => ({
      id: payment.id,
      amount: Number(payment.amount),
      status: payment.status,
      paymentMethod: payment.payment_method,
      paidAt: payment.paid_at,
      reference: payment.gateway_reference,
      receiptToken: receiptsByPaymentId.get(payment.id) || undefined,
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
   * Verify payment with Paystack directly (Hybrid approach)
   *
   * This method provides a hybrid verification:
   * 1. First checks database (fast, webhook may have already processed)
   * 2. If still pending, verifies directly with Paystack API
   * 3. Processes payment if Paystack confirms success
   *
   * This eliminates the need to wait for cron job and provides
   * immediate confirmation even if webhook failed.
   */
  async verifyPayment(reference: string): Promise<any> {
    this.paystackLogger.info('Hybrid verification started', { reference });

    // Step 1: Find payment in database
    const payment = await this.paymentRepository.findOne({
      where: { gateway_reference: reference },
      relations: ['offerLetter', 'offerLetter.property'],
    });

    if (!payment) {
      this.paystackLogger.error('Payment not found for verification', {
        reference,
      });
      throw new NotFoundException(
        `Payment not found for reference: ${reference}`,
      );
    }

    // Step 2: If already completed, return immediately (webhook worked)
    if (payment.status === PaymentStatus.COMPLETED) {
      this.paystackLogger.info(
        'Payment already completed (webhook processed)',
        {
          payment_id: payment.id,
          reference,
        },
      );

      return {
        status: 'success',
        verified: true,
        alreadyProcessed: true,
        payment: {
          id: payment.id,
          amount: Number(payment.amount),
          paidAt: payment.paid_at,
          paymentMethod: payment.payment_method,
        },
        message: 'Payment already processed',
      };
    }

    // Step 3: Payment still pending - verify with the gateway that issued
    // the reference (row-first selection via the row's `gateway` column).
    this.paystackLogger.info('Payment pending, verifying with gateway', {
      payment_id: payment.id,
      reference,
      gateway: payment.gateway,
    });

    try {
      const verification = await this.verifyRowWithGateway(payment);

      this.paystackLogger.info('Gateway verification response', {
        reference,
        gateway: verification.gateway,
        status: verification.status,
        raw_status: verification.rawStatus,
        amount_naira: verification.amountNaira,
      });

      // Step 4: If the gateway says success, process it now
      if (verification.status === 'success') {
        this.paystackLogger.info(
          'Payment successful on gateway, processing now',
          {
            payment_id: payment.id,
            reference,
          },
        );

        // Process the payment (this updates database, generates receipt, etc.)
        await this.processSuccessfulPayment(verification);

        return {
          status: 'success',
          verified: true,
          alreadyProcessed: false,
          payment: {
            id: payment.id,
            amount: verification.amountNaira,
            paidAt: verification.paidAt,
            paymentMethod: verification.channel,
          },
          message: 'Payment verified and processed successfully',
        };
      }

      // Money-safety: pending-with-money (e.g. Monnify PARTIALLY_PAID /
      // OVERPAID) must be ops-visible, never silently reported as pending.
      if (verification.moneyReceived) {
        this.paystackLogger.error(
          'Gateway reports money received but not a clean success — needs ops reconciliation',
          {
            payment_id: payment.id,
            reference,
            raw_status: verification.rawStatus,
            amount_naira: verification.amountNaira,
          },
        );
        void this.logPaymentEvent(payment.id, PaymentLogEventType.ERROR, {
          reason: 'amount_mismatch_gateway_status',
          raw_status: verification.rawStatus,
          received: verification.amountNaira,
          gateway: verification.gateway,
        }).catch(() => undefined);
      }

      // Step 5: Payment not successful yet
      this.paystackLogger.info('Payment not yet successful on gateway', {
        payment_id: payment.id,
        reference,
        gateway_status: verification.rawStatus,
      });

      return {
        status: verification.status,
        verified: true,
        alreadyProcessed: false,
        message: `Payment status: ${verification.status}`,
      };
    } catch (error) {
      this.paystackLogger.error('Error verifying with gateway', {
        reference,
        error: error.message,
        stack: error.stack,
      });

      // Return error but don't throw - let frontend handle gracefully
      return {
        status: 'error',
        verified: false,
        message: 'Failed to verify payment with gateway',
        error: error.message,
      };
    }
  }

  /**
   * Verify a payment row against the gateway recorded on it. If that gateway
   * definitively does not know the reference, probe the other registered
   * adapters once and log the mislabel — a wrong `gateway` value must not
   * fail a genuinely-paid payment. Transient errors propagate.
   */
  private async verifyRowWithGateway(
    payment: Payment,
  ): Promise<VerifyPaymentResult> {
    const rowGateway = this.gatewayRegistry.get(payment.gateway);
    try {
      return await rowGateway.verifyPayment(payment.gateway_reference);
    } catch (error) {
      if (!(error instanceof GatewayReferenceNotFoundError)) throw error;

      for (const name of this.gatewayRegistry.names()) {
        if (name === payment.gateway) continue;
        try {
          const result = await this.gatewayRegistry
            .get(name)
            .verifyPayment(payment.gateway_reference);
          this.paystackLogger.error(
            'Payment row gateway mislabeled — reference resolved on another gateway',
            {
              payment_id: payment.id,
              reference: payment.gateway_reference,
              labeled: payment.gateway,
              actual: name,
            },
          );
          return result;
        } catch (inner) {
          if (!(inner instanceof GatewayReferenceNotFoundError)) throw inner;
        }
      }
      throw error;
    }
  }

  /**
   * Get all payments for landlord's properties
   */
  async getLandlordPayments(
    landlordId: string | string[],
    filters: {
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<any> {
    const { status = 'all', search = '', page = 1, limit = 20 } = filters;
    const landlordIds = Array.isArray(landlordId) ? landlordId : [landlordId];
    if (!landlordIds.length) {
      return {
        payments: [],
        refundsRequired: [],
        pagination: { total: 0, page, limit, totalPages: 0 },
      };
    }

    // Build query
    const query = this.offerLetterRepository
      .createQueryBuilder('offer')
      .leftJoinAndSelect('offer.property', 'property')
      .leftJoinAndSelect('offer.kyc_application', 'kyc')
      .where('offer.landlord_id IN (:...landlordIds)', { landlordIds })
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

    // Get payment history for all offers in a single query (avoid N+1)
    const offerIds = offers.map((o) => o.id);
    let allPaymentHistory: any[] = [];
    if (offerIds.length > 0) {
      allPaymentHistory = await this.paymentRepository.find({
        where: { offer_letter_id: In(offerIds) },
        order: { created_at: 'DESC' },
      });
    }

    // Group payment history by offer_letter_id
    const paymentsByOffer = new Map<string, any[]>();
    for (const payment of allPaymentHistory) {
      const existing = paymentsByOffer.get(payment.offer_letter_id) || [];
      existing.push(payment);
      paymentsByOffer.set(payment.offer_letter_id, existing);
    }

    const payments = offers.map((offer) => {
      const paymentHistory = paymentsByOffer.get(offer.id) || [];

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
          reference: p.gateway_reference,
          date: p.paid_at
            ? p.paid_at.toISOString().split('T')[0]
            : p.created_at.toISOString().split('T')[0],
        })),
      };
    });

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
   * Find payment by Paystack reference (returns null if not found)
   */
  async findByReference(reference: string): Promise<Payment | null> {
    return this.paymentRepository.findOne({
      where: { gateway_reference: reference },
    });
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
      gateway_data: data,
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
   * Process a bank.transfer.rejected webhook event for offer letter payments.
   * Marks the payment as failed, writes to property history (livefeed + history tab),
   * creates a landlord notification, and emits a real-time WebSocket event.
   */
  async processBankTransferRejected(
    event: NormalizedPaymentEvent,
  ): Promise<void> {
    const reference = event.reference;
    const amountInNaira = event.amountNaira;
    const gatewayResponse = event.gatewayResponse || 'Rejected';

    this.paystackLogger.info('Processing transfer.rejected webhook', {
      reference,
      gateway: event.gateway,
      amount_naira: amountInNaira,
      gateway_response: gatewayResponse,
    });

    const payment = await this.paymentRepository.findOne({
      where: { gateway_reference: reference },
      relations: [
        'offerLetter',
        'offerLetter.property',
        'offerLetter.kyc_application',
      ],
    });

    if (!payment) {
      this.paystackLogger.error(
        'Payment not found for rejected bank transfer',
        { reference },
      );
      return;
    }

    if (
      payment.status === PaymentStatus.FAILED ||
      payment.status === PaymentStatus.COMPLETED
    ) {
      this.paystackLogger.info(
        'Payment already in terminal state, skipping bank transfer rejection',
        { reference, status: payment.status },
      );
      return;
    }

    // Claim the row with a compare-and-swap on status — the pre-read above is
    // only a fast path. Two things this protects against:
    //  1. A redelivered rejection webhook duplicating the notification /
    //     history / WebSocket event below (affected=0 ⇒ we return early).
    //  2. A success landing between the pre-read and this write: without the
    //     status guard we would flip a COMPLETED payment to FAILED.
    // metadata is merged in SQL (jsonb ||) rather than spread from the stale
    // entity, so a concurrent writer's keys are never clobbered.
    const claim = await this.paymentRepository
      .createQueryBuilder()
      .update(Payment)
      .set({
        status: PaymentStatus.FAILED,
        metadata: () => `COALESCE(metadata, '{}'::jsonb) || :rejection::jsonb`,
      })
      .where('id = :id AND status = :pending', {
        id: payment.id,
        pending: PaymentStatus.PENDING,
      })
      .setParameter(
        'rejection',
        JSON.stringify({ rejection_data: event.raw ?? null }),
      )
      .execute();

    if (!claim.affected) {
      this.paystackLogger.info(
        'Payment no longer pending (concurrent success/rejection); skipping bank transfer rejection',
        { reference },
      );
      return;
    }

    await this.logPaymentEvent(payment.id, PaymentLogEventType.ERROR, {
      reason: 'Bank transfer rejected by gateway',
      gateway: event.gateway,
      gateway_response: gatewayResponse,
      gateway_data: event.raw,
    });

    const offerLetter = payment.offerLetter;
    if (!offerLetter) {
      this.paystackLogger.error(
        'Offer letter missing on payment for rejected bank transfer',
        { reference, payment_id: payment.id },
      );
      return;
    }

    const kycApplication = offerLetter.kyc_application;
    const tenantName = kycApplication
      ? `${kycApplication.first_name} ${kycApplication.last_name}`
      : 'Tenant';
    const propertyName = offerLetter.property?.name || 'Property';
    const propertyId = offerLetter.property_id;
    const landlordId = offerLetter.property?.owner_id;

    // Property history — shows in landlord property details history tab
    await this.createPaymentHistoryEvent(
      propertyId,
      'bank_transfer_rejected',
      `Bank transfer of ₦${amountInNaira.toLocaleString()} from ${tenantName} for ${propertyName} was rejected`,
      payment.id,
      'payment',
    );

    // Landlord livefeed notification + real-time WebSocket event
    if (landlordId) {
      this.notificationService
        .create({
          date: new Date().toISOString(),
          type: NotificationType.PAYMENT_TRANSFER_REJECTED,
          description: `Bank transfer of ₦${amountInNaira.toLocaleString()} from ${tenantName} for ${propertyName} was rejected`,
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
          this.paystackLogger.error(
            'Failed to create bank transfer rejection notification',
            { reference, error: error.message },
          );
        });
    }
  }

  /**
   * Track when a tenant cancels a payment from the Paystack popup
   */
  async trackPaymentCancelled(
    token: string,
  ): Promise<{ success: boolean; message: string }> {
    const offerLetter = await this.offerLetterRepository.findOne({
      where: { token },
      relations: ['property', 'kyc_application'],
    });

    if (!offerLetter) {
      throw new NotFoundException('Offer letter not found');
    }

    const tenantName = offerLetter.kyc_application
      ? `${offerLetter.kyc_application.first_name} ${offerLetter.kyc_application.last_name}`
      : 'Unknown';
    const propertyName = offerLetter.property?.name || 'Property';

    const formattedDate = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const formattedTime = new Date().toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    try {
      await this.propertyHistoryService.createPropertyHistory({
        property_id: offerLetter.property_id,
        tenant_id: offerLetter.kyc_application?.tenant_id || null,
        event_type: 'payment_cancelled',
        event_description: `${tenantName} cancelled payment for ${propertyName} — ${formattedDate} at ${formattedTime}`,
        related_entity_id: offerLetter.id,
        related_entity_type: 'offer_letter',
      });
    } catch (error) {
      this.paystackLogger.error('Failed to create payment_cancelled history:', {
        error: error.message,
      });
    }

    return { success: true, message: 'Payment cancellation tracked' };
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
      this.paystackLogger.info('Starting landlord payment notification', {
        offer_id: offerLetter.id,
        property_id: offerLetter.property_id,
        property_owner_id: offerLetter.property?.owner_id,
      });

      if (!offerLetter.property?.owner_id) {
        this.paystackLogger.warn('Cannot send landlord payment notification', {
          offer_id: offerLetter.id,
          reason: 'Property or owner_id not loaded on offer letter',
        });
        return;
      }

      const recipients = await this.notificationRecipients.resolveRecipients(
        offerLetter.property.owner_id,
        NotificationCategory.PAYMENTS,
      );

      const kycApplication = await this.kycApplicationRepository.findOne({
        where: { id: offerLetter.kyc_application_id },
      });

      if (!recipients.some((r) => r.phone) || !kycApplication) {
        this.paystackLogger.warn('Cannot send landlord payment notification', {
          offer_id: offerLetter.id,
          reason: 'No reachable recipient phone or missing KYC application',
          landlord_id: offerLetter.property.owner_id,
          kyc_application_id: offerLetter.kyc_application_id,
          kyc_found: !!kycApplication,
        });
        return;
      }

      for (const recipient of recipients) {
        if (!recipient.phone) continue;
        if (newOutstandingBalance === 0) {
          await this.templateSenderService.sendLandlordPaymentComplete({
            phone_number: recipient.phone,
            landlord_name: recipient.name,
            tenant_name: this.utilService.formatPersonName(
              kycApplication.first_name,
              kycApplication.last_name,
            ),
            property_name: offerLetter.property.name,
            total_amount: Number(offerLetter.total_amount),
            property_id: offerLetter.property.id,
          });
        } else {
          await this.templateSenderService.sendLandlordPaymentReceived({
            phone_number: recipient.phone,
            landlord_name: recipient.name,
            tenant_name: this.utilService.formatPersonName(
              kycApplication.first_name,
              kycApplication.last_name,
            ),
            property_name: offerLetter.property.name,
            amount: Number(payment.amount),
            outstanding_balance: newOutstandingBalance,
          });
        }
      }

      this.paystackLogger.info('Landlord payment notification sent', {
        offer_id: offerLetter.id,
        landlord_id: offerLetter.property.owner_id,
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
   * Notify winning tenant
   * Requirements: Phase 5 - Task 19.1
   */
  private async notifyWinningTenant(
    offerLetter: OfferLetter,
    property: Property,
    receiptToken: string,
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

      const landlordAccount = await this.accountRepository.findOne({
        where: { id: property.owner_id },
        relations: ['user'],
      });
      const landlordName = landlordAccount?.profile_name
        ? landlordAccount.profile_name
        : landlordAccount?.user
          ? `${landlordAccount.user.first_name} ${landlordAccount.user.last_name}`
          : 'Your Landlord';

      await this.templateSenderService.sendTenantPaymentSuccess({
        phone_number: kycApplication.phone_number,
        tenant_name: this.utilService.formatPersonName(
          kycApplication.first_name,
          kycApplication.last_name,
        ),
        property_name: property.name,
        total_amount: Number(offerLetter.total_amount),
        landlord_name: landlordName,
        receipt_token: receiptToken,
      });

      this.paystackLogger.info('Winning tenant notification sent', {
        offer_id: offerLetter.id,
        kyc_application_id: kycApplication.id,
        receipt_token: receiptToken,
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

      await this.templateSenderService.sendTenantRaceCondition({
        phone_number: kycApplication.phone_number,
        tenant_name: this.utilService.formatPersonName(
          kycApplication.first_name,
          kycApplication.last_name,
        ),
        property_name: property.name,
        amount: Number(offerLetter.amount_paid),
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
   * Check for expired payments (runs every 30 minutes)
   *
   * Reduced frequency since hybrid verification handles most cases.
   * This is now just a safety net for edge cases.
   */
  @Cron('*/30 * * * *')
  async checkExpiredPayments(): Promise<void> {
    const now = Date.now();
    const thirtyMinutesAgo = new Date(now - 30 * 60 * 1000);
    // Long-stop: no gateway may strand a PENDING row forever. Past this age
    // a still-not-successful payment is failed regardless of gateway status.
    const LONG_STOP_MS = 24 * 60 * 60 * 1000;

    const expiredPayments = await this.paymentRepository.find({
      where: {
        status: PaymentStatus.PENDING,
        created_at: LessThan(thirtyMinutesAgo),
      },
    });

    for (const payment of expiredPayments) {
      try {
        // Ask the gateway recorded on the row (with mislabel fallback).
        const verification = await this.verifyRowWithGateway(payment);
        const ageMs = now - payment.created_at.getTime();

        if (verification.status === 'success') {
          // Payment was successful, process it
          await this.processSuccessfulPayment(verification);
          continue;
        }

        // Money received but not a clean success (Monnify PARTIALLY_PAID /
        // OVERPAID): NEVER auto-fail a row with real money at the gateway.
        // Leave it PENDING and surface for ops reconciliation.
        if (verification.moneyReceived) {
          this.paystackLogger.error(
            'Expired payment holds money at the gateway without clean success — leaving PENDING for ops',
            {
              payment_id: payment.id,
              reference: payment.gateway_reference,
              raw_status: verification.rawStatus,
              amount_naira: verification.amountNaira,
            },
          );
          void this.logPaymentEvent(payment.id, PaymentLogEventType.ERROR, {
            reason: 'amount_mismatch_gateway_status',
            raw_status: verification.rawStatus,
            received: verification.amountNaira,
            gateway: verification.gateway,
          }).catch(() => undefined);
          continue;
        }

        if (verification.status === 'failed') {
          await this.markAsFailed(payment.id, {
            reason: 'timeout',
            last_check: {
              gateway: verification.gateway,
              raw_status: verification.rawStatus,
            },
          });
          this.paystackLogger.info('Payment marked as failed due to timeout', {
            payment_id: payment.id,
            reference: payment.gateway_reference,
          });
          continue;
        }

        // Still genuinely pending. A live checkout can outlast our age gate
        // (Monnify checkoutUrls stay payable for 40 min) — failing it now
        // would stamp a failure on a checkout that can still take money.
        // Skip and let the next pass converge (Monnify PENDING becomes
        // EXPIRED after its window)… unless the long-stop has passed.
        if (ageMs >= LONG_STOP_MS) {
          await this.markAsFailed(payment.id, {
            reason: 'timeout_longstop',
            note: 'Still pending after 24h — force-failed by long-stop',
            last_check: {
              gateway: verification.gateway,
              raw_status: verification.rawStatus,
            },
          });
          this.paystackLogger.info('Payment force-failed by 24h long-stop', {
            payment_id: payment.id,
            reference: payment.gateway_reference,
          });
        }
      } catch (error) {
        if (error instanceof GatewayReferenceNotFoundError) {
          // Payment was created in DB but never initiated on the gateway
          // (checkout page never opened). Paystack-era behavior; Monnify
          // creates the transaction at init so this is effectively
          // legacy-only.
          await this.markAsFailed(payment.id, {
            reason: 'never_initiated',
            error: 'Transaction not found on gateway',
            note: 'Payment record exists in database but was never initiated on the gateway checkout',
          });

          this.paystackLogger.info(
            'Payment marked as failed - never initiated on gateway',
            {
              payment_id: payment.id,
              reference: payment.gateway_reference,
            },
          );
        } else {
          // Other errors (network issues, etc.) - log but don't mark as failed yet
          this.paystackLogger.error('Error checking expired payment', {
            payment_id: payment.id,
            reference: payment.gateway_reference,
            error: error.message,
          });
        }
      }
    }
  }
}

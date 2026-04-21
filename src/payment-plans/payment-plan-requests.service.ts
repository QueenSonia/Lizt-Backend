import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  PaymentPlanRequest,
  PaymentPlanRequestSource,
  PaymentPlanRequestStatus,
} from './entities/payment-plan-request.entity';
import { CreatePaymentPlanRequestDto } from './dto/create-payment-plan-request.dto';
import { DeclinePaymentPlanRequestDto } from './dto/decline-payment-plan-request.dto';

import {
  RenewalInvoice,
  RenewalPaymentStatus,
} from '../tenancies/entities/renewal-invoice.entity';
import { Property } from '../properties/entities/property.entity';
import { PropertyHistory } from '../property-history/entities/property-history.entity';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/enums/notification-type';
import { EventsGateway } from '../events/events.gateway';
import { WhatsAppNotificationLogService } from '../whatsapp-bot/whatsapp-notification-log.service';
import { UtilService } from '../utils/utility-service';
import { Fee } from '../common/billing/fees';

@Injectable()
export class PaymentPlanRequestsService {
  private readonly logger = new Logger(PaymentPlanRequestsService.name);

  constructor(
    @InjectRepository(PaymentPlanRequest)
    private readonly requestRepository: Repository<PaymentPlanRequest>,
    @InjectRepository(RenewalInvoice)
    private readonly renewalInvoiceRepository: Repository<RenewalInvoice>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepository: Repository<PropertyHistory>,
    private readonly notificationService: NotificationService,
    private readonly eventsGateway: EventsGateway,
    private readonly whatsappNotificationLog: WhatsAppNotificationLogService,
    private readonly utilService: UtilService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────
  // Tenant submits via the public token endpoint
  // ───────────────────────────────────────────────────────────────────────

  async submitFromToken(
    token: string,
    dto: CreatePaymentPlanRequestDto,
    source: PaymentPlanRequestSource = PaymentPlanRequestSource.RENT,
  ): Promise<PaymentPlanRequest> {
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { token },
      relations: [
        'property',
        'property.owner',
        'property.owner.user',
        'tenant',
        'tenant.user',
      ],
    });

    if (!invoice) {
      throw new NotFoundException('Renewal invoice not found');
    }
    if (invoice.payment_status === RenewalPaymentStatus.PAID) {
      throw new ConflictException(
        'This invoice has already been paid in full.',
      );
    }

    const total = Number(invoice.total_amount);

    const breakdown: Fee[] = Array.isArray(invoice.fee_breakdown)
      ? invoice.fee_breakdown
      : [];

    const request = this.requestRepository.create({
      property_tenant_id: invoice.property_tenant_id,
      property_id: invoice.property_id,
      tenant_id: invoice.tenant_id,
      renewal_invoice_id: invoice.id,
      total_amount: total,
      fee_breakdown: breakdown,
      installment_amount: null,
      preferred_schedule: dto.preferredSchedule.trim(),
      tenant_note: dto.tenantNote?.trim() || null,
      source,
      status: PaymentPlanRequestStatus.PENDING,
    });
    const saved = await this.requestRepository.save(request);

    await this.dispatchSubmittedNotifications(saved, invoice);

    return saved;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Landlord-facing reads
  // ───────────────────────────────────────────────────────────────────────

  async list(
    propertyTenantId?: string,
    propertyId?: string,
    tenantId?: string,
  ): Promise<PaymentPlanRequest[]> {
    const qb = this.requestRepository
      .createQueryBuilder('req')
      .orderBy('req.created_at', 'DESC');

    if (propertyTenantId) {
      qb.andWhere('req.property_tenant_id = :propertyTenantId', {
        propertyTenantId,
      });
    }
    if (propertyId) {
      qb.andWhere('req.property_id = :propertyId', { propertyId });
    }
    if (tenantId) {
      qb.andWhere('req.tenant_id = :tenantId', { tenantId });
    }
    return qb.getMany();
  }

  async getOne(id: string): Promise<PaymentPlanRequest> {
    const req = await this.requestRepository.findOne({ where: { id } });
    if (!req) {
      throw new NotFoundException('Payment plan request not found');
    }
    return req;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Approval is handled atomically inside PaymentPlansService.createPlan
  // when a `fromRequestId` is supplied. The bridge method below performs the
  // status flip and notification dispatch for that flow.
  // ───────────────────────────────────────────────────────────────────────

  async markApproved(
    requestId: string,
    paymentPlanId: string,
    decidedByUserId: string,
  ): Promise<void> {
    const req = await this.getOne(requestId);
    if (req.status !== PaymentPlanRequestStatus.PENDING) {
      throw new ConflictException(
        `Request is already ${req.status} and cannot be approved again`,
      );
    }
    await this.requestRepository.update(requestId, {
      status: PaymentPlanRequestStatus.APPROVED,
      created_payment_plan_id: paymentPlanId,
      decided_at: new Date(),
      decided_by_user_id: decidedByUserId,
    });
    const updated = await this.getOne(requestId);
    await this.dispatchApprovedNotifications(updated);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Decline (landlord)
  // ───────────────────────────────────────────────────────────────────────

  async decline(
    id: string,
    dto: DeclinePaymentPlanRequestDto,
    decidedByUserId: string,
  ): Promise<PaymentPlanRequest> {
    const req = await this.getOne(id);
    if (req.status !== PaymentPlanRequestStatus.PENDING) {
      throw new ConflictException(
        `Request is already ${req.status} and cannot be declined`,
      );
    }
    await this.requestRepository.update(id, {
      status: PaymentPlanRequestStatus.DECLINED,
      decline_reason: dto.reason?.trim() || null,
      decided_at: new Date(),
      decided_by_user_id: decidedByUserId,
    });
    const updated = await this.getOne(id);
    await this.dispatchDeclinedNotifications(updated);
    return updated;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Notifications
  // ───────────────────────────────────────────────────────────────────────

  private async dispatchSubmittedNotifications(
    request: PaymentPlanRequest,
    invoice: RenewalInvoice,
  ): Promise<void> {
    const property = invoice.property;
    const propertyName = property?.name ?? 'your property';
    const landlordUser = property?.owner?.user;
    const tenantUser = invoice.tenant?.user;

    const tenantName =
      `${tenantUser?.first_name ?? ''} ${tenantUser?.last_name ?? ''}`.trim() ||
      'there';
    const landlordName =
      `${landlordUser?.first_name ?? ''} ${landlordUser?.last_name ?? ''}`.trim() ||
      'there';
    const tenantPhone = tenantUser?.phone_number
      ? this.utilService.normalizePhoneNumber(tenantUser.phone_number)
      : null;
    const landlordPhone = landlordUser?.phone_number
      ? this.utilService.normalizePhoneNumber(landlordUser.phone_number)
      : null;

    // Property/tenant timeline
    try {
      await this.propertyHistoryRepository.save(
        this.propertyHistoryRepository.create({
          property_id: request.property_id,
          tenant_id: request.tenant_id,
          event_type: 'payment_plan_request_submitted',
          event_description: `${tenantName} requested a payment plan for ₦${Number(
            request.total_amount,
          ).toLocaleString()}`,
          related_entity_id: request.id,
          related_entity_type: 'payment_plan_request',
        }),
      );

      // Landlord livefeed
      const landlordId = property?.owner_id;
      if (landlordId) {
        await this.notificationService.create({
          date: new Date().toISOString(),
          type: NotificationType.PAYMENT_PLAN_REQUEST_SUBMITTED,
          description: `${tenantName} requested a payment plan for ${propertyName}`,
          status: 'Completed',
          property_id: request.property_id,
          user_id: landlordId,
        });
        this.eventsGateway.emitHistoryAdded(landlordId, {
          propertyId: request.property_id,
          propertyName,
          tenantName,
          displayType: NotificationType.PAYMENT_PLAN_REQUEST_SUBMITTED,
          description: `${tenantName} requested a payment plan for ${propertyName}`,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to log submitted-history for request ${request.id}: ${(err as Error).message}`,
      );
    }

    // WhatsApp — confirmation to tenant + heads-up to landlord
    try {
      if (tenantPhone) {
        await this.whatsappNotificationLog.queue(
          'sendPaymentPlanRequestSubmittedTenant',
          {
            phone_number: tenantPhone,
            tenant_name: tenantName,
            property_name: propertyName,
            total_amount: Number(request.total_amount),
            preferred_schedule: request.preferred_schedule,
            tenant_note: request.tenant_note ?? '',
            landlord_id: property?.owner_id,
            property_id: request.property_id,
            recipient_name: tenantName,
          },
          request.id,
        );
      }
      if (landlordPhone) {
        await this.whatsappNotificationLog.queue(
          'sendPaymentPlanRequestLandlordNotify',
          {
            phone_number: landlordPhone,
            landlord_name: landlordName,
            tenant_name: tenantName,
            property_name: propertyName,
            total_amount: Number(request.total_amount),
            preferred_schedule: request.preferred_schedule,
            tenant_note: request.tenant_note ?? '',
            landlord_id: property?.owner_id,
            property_id: request.property_id,
            recipient_name: landlordName,
          },
          request.id,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to queue submission WhatsApp for request ${request.id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Approval just writes a property-history row — the plan-creation flow
   * already pushes its own `payment_plan_created` history + landlord
   * notification, and the tenant will hear about it via installment
   * reminders. No separate "approved" WhatsApp.
   */
  private async dispatchApprovedNotifications(
    request: PaymentPlanRequest,
  ): Promise<void> {
    try {
      await this.propertyHistoryRepository.save(
        this.propertyHistoryRepository.create({
          property_id: request.property_id,
          tenant_id: request.tenant_id,
          event_type: 'payment_plan_request_approved',
          event_description: 'Payment plan request approved',
          related_entity_id: request.id,
          related_entity_type: 'payment_plan_request',
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to log approved-history for request ${request.id}: ${(err as Error).message}`,
      );
    }
  }

  private async dispatchDeclinedNotifications(
    request: PaymentPlanRequest,
  ): Promise<void> {
    const property = await this.propertyRepository.findOne({
      where: { id: request.property_id },
      relations: ['owner', 'owner.user'],
    });
    const propertyName = property?.name ?? 'your property';

    const invoice = request.renewal_invoice_id
      ? await this.renewalInvoiceRepository.findOne({
          where: { id: request.renewal_invoice_id },
          relations: ['tenant', 'tenant.user'],
        })
      : null;
    const tenantUser = invoice?.tenant?.user;
    const tenantName =
      `${tenantUser?.first_name ?? ''} ${tenantUser?.last_name ?? ''}`.trim() ||
      'there';
    const tenantPhone = tenantUser?.phone_number
      ? this.utilService.normalizePhoneNumber(tenantUser.phone_number)
      : null;

    try {
      await this.propertyHistoryRepository.save(
        this.propertyHistoryRepository.create({
          property_id: request.property_id,
          tenant_id: request.tenant_id,
          event_type: 'payment_plan_request_declined',
          event_description: `Payment plan request declined${
            request.decline_reason ? ` — reason: ${request.decline_reason}` : ''
          }`,
          related_entity_id: request.id,
          related_entity_type: 'payment_plan_request',
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to log declined-history for request ${request.id}: ${(err as Error).message}`,
      );
    }

    try {
      if (tenantPhone) {
        await this.whatsappNotificationLog.queue(
          'sendPaymentPlanRequestDeclinedTenant',
          {
            phone_number: tenantPhone,
            tenant_name: tenantName,
            property_name: propertyName,
            total_amount: Number(request.total_amount),
            decline_reason: request.decline_reason ?? '',
            landlord_id: property?.owner_id,
            property_id: request.property_id,
            recipient_name: tenantName,
          },
          request.id,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to queue declined WhatsApp for request ${request.id}: ${(err as Error).message}`,
      );
    }
  }
}

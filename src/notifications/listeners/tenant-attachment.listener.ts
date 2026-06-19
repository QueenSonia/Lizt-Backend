import { OnEvent } from '@nestjs/event-emitter';
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationService } from '../notification.service';
import { NotificationType } from '../enums/notification-type';
import { Account } from 'src/users/entities/account.entity';
import { TemplateSenderService } from 'src/whatsapp-bot/template-sender';
import { UtilService } from 'src/utils/utility-service';

export interface TenantAttachedEvent {
  property_id: string;
  property_name: string;
  tenant_id: string;
  tenant_name: string;
  user_id: string; // landlord/owner id
}

export interface TenancyEndedEvent {
  property_id: string;
  property_name: string;
  tenant_id: string;
  tenant_name: string;
  user_id: string; // landlord/owner id
  move_out_date: string;
  /** Forced removals (immediate end / scheduled forced removal) notify the
   * tenant with the "terminated with immediate effect" message. A renewal lapse
   * leaves this falsy — it ended quietly after the not-renewing reminders. */
  notify_tenant_termination?: boolean;
  /** Human-readable reason shown in the termination message. */
  termination_reason?: string;
}

export interface TenancyRenewedEvent {
  property_id: string;
  property_name: string;
  tenant_id: string;
  tenant_name: string;
  user_id: string; // landlord/owner id
  rent_amount: number;
  payment_frequency: string;
  start_date: string;
  end_date: string;
}

export interface RenewalLinkSentEvent {
  property_id: string;
  property_name: string;
  tenant_id: string;
  tenant_name: string;
  user_id: string;
  amount: number;
}

export interface RenewalLetterSentEvent extends RenewalLinkSentEvent {}

export interface RenewalLetterAcceptedEvent {
  property_id: string;
  property_name: string;
  tenant_id: string;
  tenant_name: string;
  user_id: string;
}

export interface RenewalLetterDeclinedEvent extends RenewalLetterAcceptedEvent {
  /** Optional reason the tenant typed when declining; trimmed, may be ''. */
  reason?: string;
}

export interface RenewalPaymentReceivedEvent {
  property_id: string;
  property_name: string;
  tenant_id: string;
  tenant_name: string;
  user_id: string;
  amount: number;
  payment_reference: string;
}

export interface OutstandingBalanceRecordedEvent {
  property_id: string;
  property_name: string;
  tenant_id: string;
  tenant_name: string;
  user_id: string;
  amount: number;
}

export interface TenancyAmendedEvent {
  property_id: string;
  property_name: string;
  tenant_id: string;
  tenant_name: string;
  user_id: string; // landlord/owner id
  /** Plain-text diff, e.g. "start ... → ...; expiry ... → ...; rent ₦X → ₦Y". */
  summary: string;
}

@Injectable()
export class TenantAttachmentListener {
  private readonly logger = new Logger(TenantAttachmentListener.name);
  // 60s dedup so a truly-simultaneous double "End now" can't fire two notices.
  private readonly terminationSeen = new Map<string, number>();
  private readonly DEDUP_MS = 60_000;

  constructor(
    private readonly notificationService: NotificationService,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @Inject(forwardRef(() => TemplateSenderService))
    private readonly templateSenderService: TemplateSenderService,
    private readonly utilService: UtilService,
  ) {}

  @OnEvent('tenant.attached')
  async handleTenantAttached(event: TenantAttachedEvent) {
    await this.notificationService.create({
      date: new Date().toISOString(),
      type: NotificationType.TENANT_ATTACHED,
      description: `${event.tenant_name} has been attached to ${event.property_name}.`,
      status: 'Completed',
      property_id: event.property_id,
      user_id: event.user_id,
    });
  }

  @OnEvent('tenancy.ended')
  async handleTenancyEnded(event: TenancyEndedEvent) {
    // In-app notification for the landlord (its own try so a failure here can't
    // block the tenant WhatsApp below).
    try {
      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.TENANCY_ENDED,
        description: `${event.tenant_name} has moved out of ${event.property_name}.`,
        status: 'Completed',
        property_id: event.property_id,
        user_id: event.user_id,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to create tenancy-ended notification: ${
          (err as { message?: string })?.message ?? err
        }`,
      );
    }

    // Only forced removals (immediate end / scheduled forced removal) send the
    // tenant the "terminated with immediate effect" notice. A lapse is silent.
    if (!event.notify_tenant_termination) return;

    const dedupKey = `${event.tenant_id}:${event.move_out_date}`;
    const now = Date.now();
    const last = this.terminationSeen.get(dedupKey);
    if (last && now - last < this.DEDUP_MS) return;
    this.terminationSeen.set(dedupKey, now);

    try {
      const tenant = await this.accountRepository.findOne({
        where: { id: event.tenant_id },
        relations: ['user'],
      });
      const tenantPhoneRaw = tenant?.user?.phone_number;
      if (!tenantPhoneRaw) {
        this.logger.warn(
          `No tenant phone for ${event.tenant_id}; skipping termination notice.`,
        );
        return;
      }
      await this.templateSenderService.sendTenantTenancyTerminated({
        phone_number: this.utilService.normalizePhoneNumber(tenantPhoneRaw),
        tenant_name:
          tenant?.user?.first_name || event.tenant_name || 'there',
        property_name: event.property_name,
        termination_reason: event.termination_reason || 'Other',
      });
    } catch (err) {
      this.logger.warn(
        `Failed to send tenant termination notice: ${
          (err as { message?: string })?.message ?? err
        }`,
      );
    }
  }

  @OnEvent('tenancy.renewed')
  async handleTenancyRenewed(event: TenancyRenewedEvent) {
    await this.notificationService.create({
      date: new Date().toISOString(),
      type: NotificationType.TENANCY_RENEWED,
      description: `Tenancy renewed for ${event.tenant_name} at ${event.property_name}. New rent: ₦${event.rent_amount.toLocaleString()}, Period: ${event.start_date} to ${event.end_date}.`,
      status: 'Completed',
      property_id: event.property_id,
      user_id: event.user_id,
    });
  }

  @OnEvent('renewal.link.sent')
  async handleRenewalLinkSent(event: RenewalLinkSentEvent) {
    await this.notificationService.create({
      date: new Date().toISOString(),
      type: NotificationType.RENEWAL_LINK_SENT,
      description: `Tenancy renewal link sent to ${event.tenant_name} for property ${event.property_name}. Total Amount: ₦${event.amount.toLocaleString()}.`,
      status: 'Completed',
      property_id: event.property_id,
      user_id: event.user_id,
    });
  }

  @OnEvent('renewal.letter.sent')
  async handleRenewalLetterSent(event: RenewalLetterSentEvent) {
    await this.notificationService.create({
      date: new Date().toISOString(),
      type: NotificationType.RENEWAL_LETTER_SENT,
      description: `Renewal letter sent to ${event.tenant_name} for ${event.property_name} — awaiting acceptance.`,
      status: 'Completed',
      property_id: event.property_id,
      user_id: event.user_id,
    });
  }

  @OnEvent('renewal.letter.accepted')
  async handleRenewalLetterAccepted(event: RenewalLetterAcceptedEvent) {
    await this.notificationService.create({
      date: new Date().toISOString(),
      type: NotificationType.RENEWAL_LETTER_ACCEPTED,
      description: `${event.tenant_name} accepted the renewal letter for ${event.property_name}. Awaiting payment.`,
      status: 'Completed',
      property_id: event.property_id,
      user_id: event.user_id,
    });
  }

  @OnEvent('renewal.letter.declined')
  async handleRenewalLetterDeclined(event: RenewalLetterDeclinedEvent) {
    const reason = event.reason?.trim();
    const description = reason
      ? `${event.tenant_name} declined the renewal letter for ${event.property_name}. Reason: ${reason}`
      : `${event.tenant_name} declined the renewal letter for ${event.property_name}.`;
    await this.notificationService.create({
      date: new Date().toISOString(),
      type: NotificationType.RENEWAL_LETTER_DECLINED,
      description,
      status: 'Completed',
      property_id: event.property_id,
      user_id: event.user_id,
    });
  }

  @OnEvent('renewal.payment.received')
  async handleRenewalPaymentReceived(event: RenewalPaymentReceivedEvent) {
    await this.notificationService.create({
      date: new Date().toISOString(),
      type: NotificationType.RENEWAL_PAYMENT_RECEIVED,
      description: `Renewal payment received from ${event.tenant_name} for property ${event.property_name}. Amount: ₦${event.amount.toLocaleString()}, Reference: ${event.payment_reference}.`,
      status: 'Completed',
      property_id: event.property_id,
      user_id: event.user_id,
    });
  }

  @OnEvent('outstanding.balance.recorded')
  async handleOutstandingBalanceRecorded(
    event: OutstandingBalanceRecordedEvent,
  ) {
    await this.notificationService.create({
      date: new Date().toISOString(),
      type: NotificationType.OUTSTANDING_BALANCE_RECORDED,
      description: `Outstanding balance of ₦${event.amount.toLocaleString()} recorded for ${event.tenant_name} at ${event.property_name}.`,
      status: 'Completed',
      property_id: event.property_id,
      user_id: event.user_id,
    });
  }

  @OnEvent('tenancy.amended')
  async handleTenancyAmended(event: TenancyAmendedEvent) {
    const suffix = event.summary ? ` — ${event.summary}` : '';
    await this.notificationService.create({
      date: new Date().toISOString(),
      type: NotificationType.TENANCY_AMENDED,
      description: `Tenancy details updated for ${event.tenant_name} at ${event.property_name}${suffix}.`,
      status: 'Completed',
      property_id: event.property_id,
      user_id: event.user_id,
    });
  }
}

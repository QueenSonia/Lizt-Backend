import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MaintenanceRequest } from '../maintenance-requests/entities/maintenance-request.entity';
import {
  MaintenanceRequestScopeEnum,
  MaintenanceRequestStatusEnum,
} from '../maintenance-requests/dto/create-maintenance-request.dto';
import { MaintenanceRequestsService } from '../maintenance-requests/maintenance-requests.service';
import { WhatsAppNotificationLogService } from '../whatsapp-bot/whatsapp-notification-log.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/enums/notification-type';
import { UtilService } from '../utils/utility-service';

// Re-prompt cadence for "you marked it resolved — please confirm it's fixed".
// A unit-scoped request sits in RESOLVED until the tenant taps a button, so we
// nudge them again every 7 days it stays unconfirmed.
const CONFIRMATION_REMINDER_INTERVAL_DAYS = 7;

// Hard cap on the number of confirmation reminders (the initial event-driven
// send is NOT counted — see CONFIRMATION_TEMPLATE_TYPE below). After this many
// reminders go unanswered, the next weekly tick auto-closes the request instead
// of nudging again.
const MAX_CONFIRMATION_REMINDERS = 2;

// The notification-log dedup type (= TemplateSenderService method name the
// log dispatcher invokes). Reused from the initial resolved-confirmation send.
// Only the cron reminders are queued under this type; the initial send is a
// direct call, so countByReference on this type == reminders-sent count.
const CONFIRMATION_TEMPLATE_TYPE = 'sendTenantConfirmationTemplate';

// Notification-log type for the "closed — no response" tenant template, queued
// when a request is auto-closed. Same durable-queue path as the reminders.
const CLOSURE_TEMPLATE_TYPE = 'sendTenantMaintenanceAutoClosedTemplate';

// Lagos is UTC+1 year-round (WAT, no DST), so "days since resolution" is
// counted on Lagos-local calendar days: shift each instant by +1h before
// flooring to a day index. Matches the 8 AM Lagos cron schedule.
const LAGOS_UTC_OFFSET_MS = 60 * 60 * 1000;

/** Lagos-local day index (days since epoch in WAT) for an instant. */
function lagosDayNumber(d: Date): number {
  return Math.floor((d.getTime() + LAGOS_UTC_OFFSET_MS) / 86_400_000);
}

/**
 * Daily lifecycle tick for unit-scoped maintenance requests an FM has marked
 * RESOLVED but the tenant hasn't confirmed yet (still RESOLVED, not CLOSED /
 * REOPENED). For each such request, once a full 7-day window has elapsed since
 * the last action:
 *
 *   - fewer than MAX_CONFIRMATION_REMINDERS reminders sent → send another
 *     "Can you confirm everything is fixed?" reminder (and log it to the
 *     landlord Live Feed);
 *   - MAX_CONFIRMATION_REMINDERS already sent → auto-close the request (status
 *     RESOLVED → CLOSED, attempt outcome EXPIRED, `auto_closed` set), send the
 *     tenant a "closed — no response" WhatsApp template, and log the closure to
 *     the Live Feed.
 *
 * Timeline for a silent tenant: day 0 resolved (+ initial event-driven confirm
 * prompt) → day 7 reminder 1 → day 14 reminder 2 → day 21 (a full week after
 * reminder 2, still no response) auto-close. The tenant tapping "Yes, it's
 * fixed" (→ CLOSED) or "No, not yet" (→ REOPENED) at any point removes the row
 * from the query.
 *
 * The initial confirmation template is sent once, event-driven, on the RESOLVED
 * transition (MaintenanceRequestListener.notifyTenantOnResolved) via a direct
 * send that does NOT go through the notification-log queue — so it is not
 * counted against the reminder cap.
 *
 * Cadence anchors to the last actual reminder (existsWithinLastDays), not an
 * exact day-N multiple of the resolution date. So a backlog of requests already
 * resolved for >7 days settles into the weekly rhythm on the first runs.
 *
 * Common-area requests are excluded: they have no tenant to confirm and
 * auto-close on resolve, so they never linger in RESOLVED.
 *
 * Idempotency: reminder sends go through WhatsAppNotificationLogService.queue
 * (durable + retried) and the 7-day-window check doubles as the cross-instance
 * guard. The auto-close is a conditional status flip (autoCloseUnitForNoResponse)
 * that only one cron instance can win, so the closure template + Live Feed row
 * are emitted exactly once.
 */
@Injectable()
export class MaintenanceReminderService {
  private readonly logger = new Logger(MaintenanceReminderService.name);

  constructor(
    @InjectRepository(MaintenanceRequest)
    private readonly maintenanceRequestRepository: Repository<MaintenanceRequest>,
    private readonly maintenanceRequestsService: MaintenanceRequestsService,
    private readonly whatsAppNotificationLogService: WhatsAppNotificationLogService,
    private readonly notificationService: NotificationService,
    private readonly utilService: UtilService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: 'Africa/Lagos' })
  async runDailyConfirmationReminderCheck(): Promise<void> {
    this.logger.log(
      'Starting daily maintenance confirmation reminder check...',
    );
    try {
      const now = new Date();

      // Unit-scoped requests still awaiting tenant confirmation, with a tenant
      // (and phone) to reach. resolution_date is set on the RESOLVED transition.
      // Join the property to resolve the landlord (owner_id) for Live Feed rows.
      const requests = await this.maintenanceRequestRepository
        .createQueryBuilder('sr')
        .leftJoinAndSelect('sr.tenant', 'tenant')
        .leftJoinAndSelect('tenant.user', 'tenantUser')
        .leftJoinAndSelect('sr.property', 'property')
        .where('sr.status = :status', {
          status: MaintenanceRequestStatusEnum.RESOLVED,
        })
        .andWhere('sr.scope = :scope', {
          scope: MaintenanceRequestScopeEnum.UNIT,
        })
        .andWhere('sr.tenant_id IS NOT NULL')
        .andWhere('sr.resolution_date IS NOT NULL')
        .getMany();

      let reminded = 0;
      let closed = 0;
      for (const sr of requests) {
        try {
          const outcome = await this.processRequest(sr, now);
          if (outcome === 'reminded') reminded++;
          else if (outcome === 'closed') closed++;
        } catch (err) {
          this.logger.warn(
            `Failed to process maintenance confirmation for request ${sr.id}: ${
              (err as Error)?.message ?? err
            }`,
          );
        }
      }

      this.logger.log(
        `Completed maintenance confirmation check — ${reminded} reminder(s) queued, ${closed} request(s) auto-closed.`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to process daily maintenance confirmation reminders',
        error,
      );
    }
  }

  /**
   * Decide and perform the weekly action for one request: send a reminder,
   * auto-close, or skip. Returns which action was taken.
   */
  private async processRequest(
    sr: MaintenanceRequest,
    now: Date,
  ): Promise<'reminded' | 'closed' | 'skipped'> {
    if (!sr.resolution_date) return 'skipped';

    // Whole Lagos-local calendar days between resolution and today.
    const daysSinceResolved =
      lagosDayNumber(now) - lagosDayNumber(new Date(sr.resolution_date));

    // Don't act until the request has gone a full week unconfirmed.
    if (daysSinceResolved < CONFIRMATION_REMINDER_INTERVAL_DAYS) return 'skipped';

    const tenantUser = sr.tenant?.user;
    if (!tenantUser?.phone_number) return 'skipped';

    // Rolling-cadence + cross-instance guard: only act once per 7-day window,
    // anchored to the last reminder actually sent. This also enforces the
    // final 7-day grace between reminder 2 and the auto-close.
    const remindedRecently =
      await this.whatsAppNotificationLogService.existsWithinLastDays(
        sr.id,
        CONFIRMATION_TEMPLATE_TYPE,
        CONFIRMATION_REMINDER_INTERVAL_DAYS,
      );
    if (remindedRecently) return 'skipped';

    const remindersSent =
      await this.whatsAppNotificationLogService.countByReference(
        sr.id,
        CONFIRMATION_TEMPLATE_TYPE,
      );

    if (remindersSent >= MAX_CONFIRMATION_REMINDERS) {
      const didClose = await this.autoCloseForNoResponse(sr, tenantUser);
      return didClose ? 'closed' : 'skipped';
    }

    await this.sendReminder(sr, tenantUser, remindersSent);
    return 'reminded';
  }

  /**
   * Queue the confirmation reminder template and log it to the landlord Live
   * Feed. `remindersSent` is the count BEFORE this send, so this is reminder
   * number `remindersSent + 1`.
   */
  private async sendReminder(
    sr: MaintenanceRequest,
    tenantUser: NonNullable<NonNullable<MaintenanceRequest['tenant']>['user']>,
    remindersSent: number,
  ): Promise<void> {
    const phone = this.utilService.normalizePhoneNumber(
      tenantUser.phone_number,
    );
    const tenantFirstName = this.utilService.toSentenceCase(
      tenantUser.first_name ?? '',
    );
    const sanitizedDescription = this.utilService.sanitizeTemplateParam(
      sr.description ?? '',
    );

    // Same template + params as the initial resolved-confirmation send.
    await this.whatsAppNotificationLogService.queue(
      CONFIRMATION_TEMPLATE_TYPE,
      {
        phone_number: phone,
        tenant_name: tenantFirstName,
        request_description: sanitizedDescription,
        request_id: sr.request_id,
      },
      sr.id,
    );

    const reminderNumber = remindersSent + 1;
    await this.logToLiveFeed(
      sr,
      NotificationType.MAINTENANCE_CONFIRMATION_REMINDER,
      `Reminder ${reminderNumber} of ${MAX_CONFIRMATION_REMINDERS} sent to ${this.tenantDisplayName(
        tenantUser,
      )} to confirm the resolved maintenance request "${this.issueSnippet(
        sr,
      )}" at ${this.propertyLabel(sr)}.`,
    );
  }

  /**
   * Auto-close a request whose tenant never responded, then (only if this
   * instance won the close) queue the tenant "closed — no response" template
   * and log the closure to the Live Feed. Returns true when this call closed it.
   */
  private async autoCloseForNoResponse(
    sr: MaintenanceRequest,
    tenantUser: NonNullable<NonNullable<MaintenanceRequest['tenant']>['user']>,
  ): Promise<boolean> {
    const didClose =
      await this.maintenanceRequestsService.autoCloseUnitForNoResponse(sr.id);
    if (!didClose) return false;

    const phone = this.utilService.normalizePhoneNumber(
      tenantUser.phone_number,
    );
    const tenantFirstName = this.utilService.toSentenceCase(
      tenantUser.first_name ?? '',
    );
    const sanitizedTitle = this.utilService.sanitizeTemplateParam(
      sr.description ?? '',
    );

    await this.whatsAppNotificationLogService.queue(
      CLOSURE_TEMPLATE_TYPE,
      {
        phone_number: phone,
        tenant_name: tenantFirstName,
        maintenance_title: sanitizedTitle,
      },
      sr.id,
    );

    await this.logToLiveFeed(
      sr,
      NotificationType.MAINTENANCE_AUTO_CLOSED,
      `Maintenance request "${this.issueSnippet(
        sr,
      )}" at ${this.propertyLabel(
        sr,
      )} was automatically closed after ${this.tenantDisplayName(
        tenantUser,
      )} did not respond to ${MAX_CONFIRMATION_REMINDERS} confirmation reminders.`,
    );

    return true;
  }

  /**
   * Write a landlord Live Feed row (the feed reads the `notifications` table,
   * not property_history). Best-effort: kept in its own try/catch so a
   * notification failure (e.g. the enum migration not yet run, or a
   * property/owner we can't resolve) never loses the WhatsApp send or the
   * status change. Skipped silently when there's no landlord to attribute to.
   */
  private async logToLiveFeed(
    sr: MaintenanceRequest,
    type: NotificationType,
    description: string,
  ): Promise<void> {
    const landlordId = sr.property?.owner_id ?? null;
    if (!landlordId) return;
    try {
      await this.notificationService.create({
        date: new Date().toISOString(),
        type,
        description,
        status: 'Completed',
        property_id: sr.property_id,
        user_id: landlordId,
        maintenance_request_id: sr.id,
      });
    } catch (error) {
      this.logger.error(
        `Failed to create Live Feed notification (${type}) for request ${sr.id}`,
        error,
      );
    }
  }

  private tenantDisplayName(
    tenantUser: NonNullable<NonNullable<MaintenanceRequest['tenant']>['user']>,
  ): string {
    const first = this.utilService.toSentenceCase(tenantUser.first_name ?? '');
    const last = this.utilService.toSentenceCase(tenantUser.last_name ?? '');
    return `${first} ${last}`.trim() || 'the tenant';
  }

  private propertyLabel(sr: MaintenanceRequest): string {
    return sr.property?.name ?? sr.property_name ?? 'their unit';
  }

  private issueSnippet(sr: MaintenanceRequest): string {
    const text = (sr.description ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return 'the reported issue';
    return text.length > 80 ? `${text.slice(0, 77)}…` : text;
  }
}

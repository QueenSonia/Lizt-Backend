import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MaintenanceRequest } from '../maintenance-requests/entities/maintenance-request.entity';
import {
  MaintenanceRequestScopeEnum,
  MaintenanceRequestStatusEnum,
} from '../maintenance-requests/dto/create-maintenance-request.dto';
import { WhatsAppNotificationLogService } from '../whatsapp-bot/whatsapp-notification-log.service';
import { UtilService } from '../utils/utility-service';

// Re-prompt cadence for "you marked it resolved — please confirm it's fixed".
// A unit-scoped request sits in RESOLVED until the tenant taps a button, so we
// nudge them again every 7 days it stays unconfirmed.
const CONFIRMATION_REMINDER_INTERVAL_DAYS = 7;

// The notification-log dedup type (= TemplateSenderService method name the
// log dispatcher invokes). Reused from the initial resolved-confirmation send.
const CONFIRMATION_TEMPLATE_TYPE = 'sendTenantConfirmationTemplate';

// Lagos is UTC+1 year-round (WAT, no DST), so "days since resolution" is
// counted on Lagos-local calendar days: shift each instant by +1h before
// flooring to a day index. Matches the 8 AM Lagos cron schedule.
const LAGOS_UTC_OFFSET_MS = 60 * 60 * 1000;

/** Lagos-local day index (days since epoch in WAT) for an instant. */
function lagosDayNumber(d: Date): number {
  return Math.floor((d.getTime() + LAGOS_UTC_OFFSET_MS) / 86_400_000);
}

/**
 * Daily nudge for unit-scoped maintenance requests that an FM has marked
 * RESOLVED but the tenant hasn't confirmed yet (still RESOLVED, not CLOSED /
 * REOPENED).
 *
 * The initial "Can you confirm if everything is fixed?" template
 * (maintenance_request_confirmation) is sent once, event-driven, when the
 * request flips to RESOLVED (MaintenanceRequestListener.notifyTenantOnResolved).
 * If the tenant never answers, the request would sit silent forever. This cron
 * re-sends the exact same template on a rolling weekly cadence — once the
 * request has been resolved for at least 7 days and no reminder has gone out in
 * the last 7 days — until the tenant taps "Yes, it's fixed" (→ CLOSED) or "No,
 * not yet" (→ REOPENED), at which point the row no longer matches the query.
 *
 * The cadence anchors to the last actual send (existsWithinLastDays), not to an
 * exact day-N multiple of the resolution date. So a backlog of requests already
 * resolved for >7 days all get nudged on the first run after deploy, regardless
 * of their exact day count, then settle into the weekly rhythm.
 *
 * Common-area requests are excluded: they have no tenant to confirm and
 * auto-close on resolve (see autoCloseResolvedCommonArea), so they never linger
 * in RESOLVED.
 *
 * Idempotency: sends go through WhatsAppNotificationLogService.queue (durable +
 * retried), and the 7-day-window check doubles as the cross-instance guard —
 * once either cron instance has queued a reminder, the other sees it in the
 * window and skips.
 */
@Injectable()
export class MaintenanceReminderService {
  private readonly logger = new Logger(MaintenanceReminderService.name);

  constructor(
    @InjectRepository(MaintenanceRequest)
    private readonly maintenanceRequestRepository: Repository<MaintenanceRequest>,
    private readonly whatsAppNotificationLogService: WhatsAppNotificationLogService,
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
      const requests = await this.maintenanceRequestRepository
        .createQueryBuilder('sr')
        .leftJoinAndSelect('sr.tenant', 'tenant')
        .leftJoinAndSelect('tenant.user', 'tenantUser')
        .where('sr.status = :status', {
          status: MaintenanceRequestStatusEnum.RESOLVED,
        })
        .andWhere('sr.scope = :scope', {
          scope: MaintenanceRequestScopeEnum.UNIT,
        })
        .andWhere('sr.tenant_id IS NOT NULL')
        .andWhere('sr.resolution_date IS NOT NULL')
        .getMany();

      let sent = 0;
      for (const sr of requests) {
        try {
          if (await this.maybeSendReminder(sr, now)) sent++;
        } catch (err) {
          this.logger.warn(
            `Failed to send maintenance confirmation reminder for request ${sr.id}: ${
              (err as Error)?.message ?? err
            }`,
          );
        }
      }

      this.logger.log(
        `Completed maintenance confirmation reminder check — ${sent} reminder(s) queued.`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to process daily maintenance confirmation reminders',
        error,
      );
    }
  }

  /**
   * Queue the confirmation template for one request if it's been resolved for
   * at least 7 days and no reminder has gone out in the last 7 days. Returns
   * true when a reminder was queued.
   */
  private async maybeSendReminder(
    sr: MaintenanceRequest,
    now: Date,
  ): Promise<boolean> {
    if (!sr.resolution_date) return false;

    // Whole Lagos-local calendar days between resolution and today.
    const daysSinceResolved =
      lagosDayNumber(now) - lagosDayNumber(new Date(sr.resolution_date));

    // Don't nudge until the request has gone a full week unconfirmed.
    if (daysSinceResolved < CONFIRMATION_REMINDER_INTERVAL_DAYS) return false;

    const tenantUser = sr.tenant?.user;
    if (!tenantUser?.phone_number) return false;

    // Rolling-cadence + cross-instance guard: skip if a reminder already went
    // out in the last 7 days (covers same-day double-send by the two cron
    // instances and keeps the cadence weekly, anchored to the last send).
    const remindedRecently =
      await this.whatsAppNotificationLogService.existsWithinLastDays(
        sr.id,
        CONFIRMATION_TEMPLATE_TYPE,
        CONFIRMATION_REMINDER_INTERVAL_DAYS,
      );
    if (remindedRecently) return false;

    const phone = this.utilService.normalizePhoneNumber(
      tenantUser.phone_number,
    );
    const tenantFirstName = this.utilService.toSentenceCase(
      tenantUser.first_name ?? '',
    );

    // Same template + params as the initial resolved-confirmation send.
    await this.whatsAppNotificationLogService.queue(
      CONFIRMATION_TEMPLATE_TYPE,
      {
        phone_number: phone,
        tenant_name: tenantFirstName,
        request_description: this.utilService.sanitizeTemplateParam(
          sr.description ?? '',
        ),
        request_id: sr.request_id,
      },
      sr.id,
    );

    return true;
  }
}

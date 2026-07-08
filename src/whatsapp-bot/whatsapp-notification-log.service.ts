import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, IsNull, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import {
  WhatsAppNotificationLog,
  WhatsAppNotificationStatus,
} from './entities/whatsapp-notification-log.entity';
import { TemplateSenderService } from './template-sender/template-sender.service';
import { EventsGateway } from 'src/events/events.gateway';

const MAX_ATTEMPTS = 3;

// A PENDING notification is eligible for (re)processing only if it has never
// been attempted or its last attempt is older than this window. Used both as
// the atomic-claim gate in processNotification and the retry-cron selection, so
// the two can never both own the same row.
const RETRY_AFTER_MS = 5 * 60 * 1000;

@Injectable()
export class WhatsAppNotificationLogService {
  private readonly logger = new Logger(WhatsAppNotificationLogService.name);

  constructor(
    @InjectRepository(WhatsAppNotificationLog)
    private readonly logRepository: Repository<WhatsAppNotificationLog>,
    private readonly templateSenderService: TemplateSenderService,
    private readonly eventEmitter: EventEmitter2,
    private readonly eventsGateway: EventsGateway,
  ) {}

  /**
   * Queue a WhatsApp notification: save to DB, then emit event for immediate send.
   * Returns instantly — the actual send happens in the event listener (below).
   */
  async queue(
    type: string,
    payload: Record<string, any>,
    referenceId?: string,
  ): Promise<void> {
    const log = this.logRepository.create({
      type,
      payload,
      reference_id: referenceId ?? null,
      status: WhatsAppNotificationStatus.PENDING,
      attempts: 0,
      last_attempted_at: null,
      last_error: null,
    });

    const saved = await this.logRepository.save(log);

    // Emit event for immediate processing — don't await
    this.eventEmitter.emit('whatsapp.notification.queued', { logId: saved.id });
  }

  /**
   * Called by the event listener to process a single notification.
   *
   * The immediate event listener and the 5-minute retry cron can both target
   * the same row at the same instant (a row queued just before a cron tick is
   * still PENDING with last_attempted_at = NULL, so the cron's selection picks
   * it up while the listener is mid-send). To make the WhatsApp send happen at
   * most once we ATOMICALLY CLAIM the row before dispatching: a single
   * conditional UPDATE bumps attempts + stamps last_attempted_at, gated on the
   * row still being PENDING and outside the retry window. Postgres serialises
   * the two UPDATEs on the row; the loser matches zero rows and bails out, so
   * only the winner ever calls Meta.
   */
  async processNotification(logId: string): Promise<void> {
    const staleBefore = new Date(Date.now() - RETRY_AFTER_MS);

    const claim = await this.logRepository
      .createQueryBuilder()
      .update(WhatsAppNotificationLog)
      .set({
        attempts: () => '"attempts" + 1',
        last_attempted_at: new Date(),
      })
      .where('id = :id', { id: logId })
      .andWhere('status = :pending', {
        pending: WhatsAppNotificationStatus.PENDING,
      })
      .andWhere(
        '(last_attempted_at IS NULL OR last_attempted_at < :staleBefore)',
        { staleBefore },
      )
      .returning('*')
      .execute();

    // Zero rows affected → another runner already claimed it, it's already
    // SENT/FAILED/CANCELLED, or a prior attempt is still inside the retry
    // window. Either way there is nothing for this invocation to do.
    if (!claim.affected) {
      return;
    }

    const log = claim.raw[0] as WhatsAppNotificationLog;
    const attempts = log.attempts; // already incremented by the claim above

    try {
      const dispatchResult = await this.dispatch(log.type, log.payload);

      await this.logRepository.update(logId, {
        status: WhatsAppNotificationStatus.SENT,
        last_error: null,
        whatsapp_message_id: dispatchResult?.wamid ?? null,
      });

      if (log.payload.landlord_id && log.payload.recipient_name) {
        this.eventsGateway.emitWhatsAppNotification(log.payload.landlord_id, {
          type: log.type,
          recipientName: log.payload.recipient_name,
          success: true,
          attempts,
          isRetry: attempts > 1,
          propertyId: log.payload.property_id,
        });
      }
    } catch (error) {
      const isFinal = attempts >= MAX_ATTEMPTS;

      await this.logRepository.update(logId, {
        status: isFinal
          ? WhatsAppNotificationStatus.FAILED
          : WhatsAppNotificationStatus.PENDING,
        last_error: error.message?.substring(0, 500) ?? 'Unknown error',
      });

      if (log.payload.landlord_id && log.payload.recipient_name) {
        this.eventsGateway.emitWhatsAppNotification(log.payload.landlord_id, {
          type: log.type,
          recipientName: log.payload.recipient_name,
          success: false,
          error: error.message?.substring(0, 200) ?? 'Unknown error',
          attempts,
          isRetry: attempts > 1,
          propertyId: log.payload.property_id,
        });
      }

      this.logger.error(
        `WhatsApp notification failed (attempt ${attempts}/${MAX_ATTEMPTS}): ${log.type}`,
        error.message,
      );
    }
  }

  /**
   * Retry failed/pending notifications every 5 minutes.
   * Picks up anything that failed on the first attempt or was missed.
   */
  @Cron('*/5 * * * *')
  async retryFailedNotifications(): Promise<void> {
    const staleBefore = new Date(Date.now() - RETRY_AFTER_MS);

    const pending = await this.logRepository.find({
      where: [
        // Previously attempted but left PENDING (a failed send) — retry once
        // the window has elapsed.
        {
          status: WhatsAppNotificationStatus.PENDING,
          last_attempted_at: LessThan(staleBefore),
        },
        // Never attempted — only sweep these in once they're old enough that
        // the immediate event listener cannot still be mid-send, so the cron
        // never races the listener for a freshly queued row (the atomic claim
        // in processNotification would reject the loser anyway, but this avoids
        // the redundant work). Covers rows whose queued event was dropped
        // (e.g. an app restart between insert and emit).
        {
          status: WhatsAppNotificationStatus.PENDING,
          last_attempted_at: IsNull(),
          created_at: LessThan(staleBefore),
        },
      ],
      order: { created_at: 'ASC' },
      take: 50,
    });

    if (pending.length === 0) {
      return;
    }

    this.logger.log(
      `Retrying ${pending.length} pending WhatsApp notifications`,
    );

    for (const log of pending) {
      await this.processNotification(log.id);
    }
  }

  /**
   * Call the correct TemplateSenderService method based on the notification type.
   * Senders may return `{ wamid }` so the queue can persist it for later
   * correlation with chat_logs (delivery / read / failed status from webhook).
   */
  private async dispatch(
    type: string,
    payload: Record<string, any>,
  ): Promise<{ wamid?: string } | void> {
    const method = (this.templateSenderService as any)[type];

    if (typeof method !== 'function') {
      throw new Error(`Unknown WhatsApp notification type: ${type}`);
    }

    const result = await method.call(this.templateSenderService, payload);
    if (result && typeof result === 'object' && 'wamid' in result) {
      return { wamid: (result as { wamid?: string }).wamid };
    }
    return;
  }

  /**
   * Check if a specific reminder type was already sent for a given reference (rent ID) and days difference (for early reminders).
   */
  async existsForDaysBeforeExpiry(
    referenceId: string,
    type: string,
    daysBeforeExpiry: number,
  ): Promise<boolean> {
    const count = await this.logRepository
      .createQueryBuilder('log')
      .where('log.reference_id = :referenceId', { referenceId })
      .andWhere('log.type = :type', { type })
      .andWhere('log.status IN (:...statuses)', {
        statuses: [
          WhatsAppNotificationStatus.PENDING,
          WhatsAppNotificationStatus.SENT,
        ],
      })
      .andWhere("log.payload->>'days_before_expiry' = :daysBeforeExpiry", {
        daysBeforeExpiry: String(daysBeforeExpiry),
      })
      .getCount();
    return count > 0;
  }

  /**
   * Mark every PENDING log whose reference_id is in the given list as
   * CANCELLED. Used when the source entity (e.g. a payment-plan installment)
   * is invalidated and should no longer be reminded on.
   */
  async cancelPendingByReferenceIds(referenceIds: string[]): Promise<number> {
    if (referenceIds.length === 0) return 0;
    const result = await this.logRepository.update(
      {
        reference_id: In(referenceIds),
        status: WhatsAppNotificationStatus.PENDING,
      },
      { status: WhatsAppNotificationStatus.CANCELLED },
    );
    return result.affected ?? 0;
  }

  /**
   * Check if a specific reminder type was sent for a given reference within the
   * last `days` calendar days (today + the previous `days - 1` days). Used for
   * rolling-cadence reminders that should fire at most once per window — e.g.
   * the weekly "confirm your resolved request is fixed" nudge. Anchoring to the
   * last actual send (rather than an exact day-N multiple) means a backlog of
   * already-overdue references all fire on the first run, then settle into the
   * cadence.
   */
  async existsWithinLastDays(
    referenceId: string,
    type: string,
    days: number,
  ): Promise<boolean> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));

    const count = await this.logRepository
      .createQueryBuilder('log')
      .where('log.reference_id = :referenceId', { referenceId })
      .andWhere('log.type = :type', { type })
      .andWhere('log.status IN (:...statuses)', {
        statuses: [
          WhatsAppNotificationStatus.PENDING,
          WhatsAppNotificationStatus.SENT,
        ],
      })
      .andWhere('log.created_at >= :since', { since })
      .getCount();

    return count > 0;
  }

  /**
   * Count how many notifications of a given type were queued for a reference
   * (PENDING or SENT — i.e. everything that reached the send path, excluding
   * CANCELLED and FAILED). Used to cap the maintenance resolved-confirmation
   * reminders at a fixed number: each cron reminder queues one row with the
   * same (reference_id, type), so the row count is the reminders-sent count.
   * The initial event-driven confirmation send does NOT go through the queue,
   * so it is correctly excluded from this count.
   */
  async countByReference(referenceId: string, type: string): Promise<number> {
    return this.logRepository
      .createQueryBuilder('log')
      .where('log.reference_id = :referenceId', { referenceId })
      .andWhere('log.type = :type', { type })
      .andWhere('log.status IN (:...statuses)', {
        statuses: [
          WhatsAppNotificationStatus.PENDING,
          WhatsAppNotificationStatus.SENT,
        ],
      })
      .getCount();
  }

  /**
   * Check if a specific reminder type was already sent for a given reference (rent ID) today (for overdue reminders).
   */
  async existsToday(referenceId: string, type: string): Promise<boolean> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const count = await this.logRepository
      .createQueryBuilder('log')
      .where('log.reference_id = :referenceId', { referenceId })
      .andWhere('log.type = :type', { type })
      .andWhere('log.status IN (:...statuses)', {
        statuses: [
          WhatsAppNotificationStatus.PENDING,
          WhatsAppNotificationStatus.SENT,
        ],
      })
      .andWhere('log.created_at >= :today', { today })
      .andWhere('log.created_at < :tomorrow', { tomorrow })
      .getCount();

    return count > 0;
  }
}

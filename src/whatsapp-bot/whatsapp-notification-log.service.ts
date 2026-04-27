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
   */
  async processNotification(logId: string): Promise<void> {
    const log = await this.logRepository.findOne({ where: { id: logId } });

    if (!log || log.status === WhatsAppNotificationStatus.SENT) {
      return;
    }

    try {
      const dispatchResult = await this.dispatch(log.type, log.payload);

      const attempts = log.attempts + 1;
      await this.logRepository.update(logId, {
        status: WhatsAppNotificationStatus.SENT,
        attempts,
        last_attempted_at: new Date(),
        last_error: null,
        whatsapp_message_id: dispatchResult?.wamid ?? null,
      });

      if (log.payload.landlord_id && log.payload.recipient_name) {
        this.eventsGateway.emitWhatsAppNotification(log.payload.landlord_id, {
          type: log.type,
          recipientName: log.payload.recipient_name,
          success: true,
          attempts,
          isRetry: log.attempts > 0,
          propertyId: log.payload.property_id,
        });
      }
    } catch (error) {
      const attempts = log.attempts + 1;
      const isFinal = attempts >= MAX_ATTEMPTS;

      await this.logRepository.update(logId, {
        status: isFinal
          ? WhatsAppNotificationStatus.FAILED
          : WhatsAppNotificationStatus.PENDING,
        attempts,
        last_attempted_at: new Date(),
        last_error: error.message?.substring(0, 500) ?? 'Unknown error',
      });

      if (log.payload.landlord_id && log.payload.recipient_name) {
        this.eventsGateway.emitWhatsAppNotification(log.payload.landlord_id, {
          type: log.type,
          recipientName: log.payload.recipient_name,
          success: false,
          error: error.message?.substring(0, 200) ?? 'Unknown error',
          attempts,
          isRetry: log.attempts > 0,
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
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const pending = await this.logRepository.find({
      where: [
        {
          status: WhatsAppNotificationStatus.PENDING,
          last_attempted_at: LessThan(fiveMinutesAgo),
        },
        {
          status: WhatsAppNotificationStatus.PENDING,
          last_attempted_at: IsNull(),
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

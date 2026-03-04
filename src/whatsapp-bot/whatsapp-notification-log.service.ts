import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import {
  WhatsAppNotificationLog,
  WhatsAppNotificationStatus,
} from './entities/whatsapp-notification-log.entity';
import { TemplateSenderService } from './template-sender/template-sender.service';

const MAX_ATTEMPTS = 3;

@Injectable()
export class WhatsAppNotificationLogService {
  private readonly logger = new Logger(WhatsAppNotificationLogService.name);

  constructor(
    @InjectRepository(WhatsAppNotificationLog)
    private readonly logRepository: Repository<WhatsAppNotificationLog>,
    private readonly templateSenderService: TemplateSenderService,
    private readonly eventEmitter: EventEmitter2,
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
      await this.dispatch(log.type, log.payload);

      await this.logRepository.update(logId, {
        status: WhatsAppNotificationStatus.SENT,
        attempts: log.attempts + 1,
        last_attempted_at: new Date(),
        last_error: null,
      });
    } catch (error) {
      const attempts = log.attempts + 1;

      await this.logRepository.update(logId, {
        status:
          attempts >= MAX_ATTEMPTS
            ? WhatsAppNotificationStatus.FAILED
            : WhatsAppNotificationStatus.PENDING,
        attempts,
        last_attempted_at: new Date(),
        last_error: error.message?.substring(0, 500) ?? 'Unknown error',
      });

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
      where: {
        status: WhatsAppNotificationStatus.PENDING,
        last_attempted_at: LessThan(fiveMinutesAgo),
      },
      order: { created_at: 'ASC' },
      take: 50,
    });

    if (pending.length === 0) {
      return;
    }

    this.logger.log(`Retrying ${pending.length} pending WhatsApp notifications`);

    for (const log of pending) {
      await this.processNotification(log.id);
    }
  }

  /**
   * Call the correct TemplateSenderService method based on the notification type.
   */
  private async dispatch(
    type: string,
    payload: Record<string, any>,
  ): Promise<void> {
    const method = (this.templateSenderService as any)[type];

    if (typeof method !== 'function') {
      throw new Error(`Unknown WhatsApp notification type: ${type}`);
    }

    await method.call(this.templateSenderService, payload);
  }
}

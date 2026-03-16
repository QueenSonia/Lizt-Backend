import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WhatsAppNotificationLogService } from './whatsapp-notification-log.service';

@Injectable()
export class WhatsAppNotificationListener {
  constructor(
    private readonly notificationLogService: WhatsAppNotificationLogService,
  ) {}

  @OnEvent('whatsapp.notification.queued')
  async handleQueued(event: { logId: string }): Promise<void> {
    await this.notificationLogService.processNotification(event.logId);
  }
}

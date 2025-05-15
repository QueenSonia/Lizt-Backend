import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification.service';
import { NoticeAgreementCreatedEvent } from '../events/notice-created.event';
import { NotificationType } from '../enums/notification-type';


@Injectable()
export class NoticeAgreementListener {
  constructor(private notificationService: NotificationService) {}

  @OnEvent('notice.created')
  handle(event: NoticeAgreementCreatedEvent) {
    this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.NOTICE_AGREEMENT,
        description: `You created a notice agreement for property ${event.property_name}.`,
        status: 'Completed',
        property_id: event.property_id,
        user_id:event.user_id
    });
  }
}








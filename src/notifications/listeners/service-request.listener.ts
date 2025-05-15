import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification.service';
import { NoticeAgreementCreatedEvent } from '../events/notice-created.event';
import { NotificationType } from '../enums/notification-type';


@Injectable()
export class ServiceRequestListener {
  constructor(private notificationService: NotificationService) {}

  @OnEvent('service.created')
  handle(event: NoticeAgreementCreatedEvent) {
    this.notificationService.create({
        date:  new Date().toISOString(),
        type: NotificationType.SERVICE_REQUEST,
        description: `You made a service agreement for property ${event.property_name}.`,
        status: 'Pending',
        property_id: event.property_id,
        user_id: event.user_id
    });
  }
}

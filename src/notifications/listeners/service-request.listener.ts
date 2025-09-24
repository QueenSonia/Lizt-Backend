import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification.service';
import { NoticeAgreementCreatedEvent } from '../events/notice-created.event';
import { NotificationType } from '../enums/notification-type';
import { ServiceRequestCreatedEvent } from '../events/service-request.event';


@Injectable()
export class ServiceRequestListener {
  constructor(private notificationService: NotificationService) {}

  @OnEvent('service.created')
  handle(event: ServiceRequestCreatedEvent) {
    this.notificationService.create({
        date:  new Date().toISOString(),
        type: NotificationType.SERVICE_REQUEST,
        description: `${event.tenant_name} made a service request for ${event.property_name}.`,
        status: 'Pending',
        property_id: event.property_id,
        user_id: event.user_id,
        service_request_id: event.service_request_id
    });
  }
}

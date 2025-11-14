import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification.service';

import { NotificationType } from '../enums/notification-type';
import { ServiceRequestCreatedEvent } from '../events/service-request.event';

@Injectable()
export class ServiceRequestListener {
  constructor(private notificationService: NotificationService) {}

  @OnEvent('service.created')
  async handle(event: ServiceRequestCreatedEvent) {
    console.log('Service request listener triggered:', event);
    try {
      const notification = await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.SERVICE_REQUEST,
        description: `${event.tenant_name} made a service request for ${event.property_name}.`,
        status: 'Pending',
        property_id: event.property_id,
        user_id: event.landlord_id, // Use landlord_id instead of user_id (tenant_id)
        service_request_id: event.service_request_id,
      });
      console.log('Service request notification created:', notification);
    } catch (error) {
      console.error('Failed to create service request notification:', error);
    }
  }
}

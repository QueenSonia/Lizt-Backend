import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification.service';
import { RentCreatedEvent } from '../events/rent-created.event';
import { NotificationType } from '../enums/notification-type';

@Injectable()
export class RentCreatedListener {
  constructor(private notificationService: NotificationService) {}

  @OnEvent('rent.created')
  handle(event: RentCreatedEvent) {
    this.notificationService.create({
        date: event.date,
        type: NotificationType.RENT_CREATED,
        description: `Rent of $${event.amount} created for user ${event.userId} on property ${event.property_id}.`,
        status: 'Completed',
        property_id: ''
    });
  }
}
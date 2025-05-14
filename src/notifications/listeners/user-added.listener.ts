import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification.service';
import { UserAddedToPropertyEvent } from '../events/user-added.event';
import { NotificationType } from '../enums/notification-type';

@Injectable()
export class UserAddedListener {
  constructor(private notificationService: NotificationService) {}

  @OnEvent('user.added')
  handle(event: UserAddedToPropertyEvent) {
    this.notificationService.create({
        date: event.date,
        type: NotificationType.USER_ADDED_TO_PROPERTY,
        description: `User ${event.userId} was added to property ${event.property_id} by user ${event.addedBy}.`,
        status: 'Completed',
        property_id: ''
    });
  }
}
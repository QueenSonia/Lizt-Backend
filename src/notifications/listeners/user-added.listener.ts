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
        date: new Date().toISOString(),
        type: NotificationType.USER_ADDED_TO_PROPERTY,
        description: `${event.profile_name} was added to ${event.property_name} `,
        status: 'Completed',
        property_id: event.property_id,
        user_id: event.user_id
    });
  }
}
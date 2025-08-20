import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification.service';
import { UserAddedToPropertyEvent } from '../events/user-added.event';
import { NotificationType } from '../enums/notification-type';
import { UserSignUpEvent } from '../events/user-signup.event';

@Injectable()
export class UserSignUpListener {
  constructor(private notificationService: NotificationService) {}

  @OnEvent('user.signup')
  handle(event: UserSignUpEvent) {
    this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.USER_SIGNED_UP,
        description: `${event.profile_name} was just finished signing up and now have access to the tenant dashboard`,
        status: 'Completed',
        user_id: event.user_id,
        property_id: event.property_id
    });
  }
}
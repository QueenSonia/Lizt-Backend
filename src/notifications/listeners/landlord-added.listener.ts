import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification.service';
import { LandlordAddedEvent } from '../events/landlord-added.event';
import { NotificationType } from '../enums/notification-type';

@Injectable()
export class LandlordAddedListener {
  constructor(private notificationService: NotificationService) {}

  @OnEvent('landlord.added')
  async handle(event: LandlordAddedEvent) {
    // Landlord-add has no property, so property_id is left null. user_id is the
    // new landlord's account id — that is both the feed attribution and how the
    // row lands in the managing admin's scoped feed (push is redirected to the
    // admin via accounts.creator_id inside NotificationService).
    await this.notificationService.create({
      date: event.date,
      type: NotificationType.LANDLORD_ADDED,
      description: `${event.profile_name} was added as a landlord.`,
      status: 'Completed',
      property_id: null,
      user_id: event.user_id,
    });
  }
}

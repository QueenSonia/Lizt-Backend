import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification.service';
import { OnboardingSubmittedEvent } from '../events/onboarding-submitted.event';
import { NotificationType } from '../enums/notification-type';

@Injectable()
export class OnboardingSubmittedListener {
  constructor(private notificationService: NotificationService) {}

  @OnEvent('onboarding.submitted')
  async handle(event: OnboardingSubmittedEvent) {
    // Addressed to the managing admin directly (they own the onboarding link):
    // user_id is the admin's account id, which is both the feed attribution and
    // the push target (a non-landlord recipient is never redirected).
    await this.notificationService.create({
      date: event.date,
      type: NotificationType.ONBOARDING_SUBMITTED,
      description: event.is_update
        ? `${event.landlord_name} updated their onboarding application.`
        : `${event.landlord_name} submitted an onboarding application.`,
      status: 'Completed',
      property_id: null,
      user_id: event.admin_id,
    });
  }
}

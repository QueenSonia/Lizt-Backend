import { OnEvent } from '@nestjs/event-emitter';
import { Injectable } from '@nestjs/common';
import { NotificationService } from '../notification.service';
import { NotificationType } from '../enums/notification-type';


@Injectable()
export class PropertyListener {
  constructor(private readonly notificationService: NotificationService) {}

  @OnEvent('property.created')
  async handlePropertyCreated(payload: {
    property_id: string;
    name?: string;
    creator_id?: string;
  }) {
    console.log('hello')
    await this.notificationService.create({
      date: new Date().toISOString(),
      type: NotificationType.PROPERTY_CREATED,
      description: `New property "${payload.name}" was created.`,
      status: 'Completed',
      property_id: payload.property_id,
    });
  }
}

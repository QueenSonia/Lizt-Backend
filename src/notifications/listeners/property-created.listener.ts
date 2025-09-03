import { OnEvent } from '@nestjs/event-emitter';
import { Injectable } from '@nestjs/common';
import { NotificationService } from '../notification.service';
import { NotificationType } from '../enums/notification-type';
import { PropertyCreatedEvent } from '../events/property-created.event';
import { WhatsappBotService } from 'src/whatsapp-bot/whatsapp-bot.service';
import { PropertiesService } from 'src/properties/properties.service';


@Injectable()
export class PropertyListener {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly whatsappService: WhatsappBotService,
    private readonly propertyService: PropertiesService,
  ) {}

  @OnEvent('property.created')
  async handlePropertyCreated(event:PropertyCreatedEvent) {
    await this.notificationService.create({
      date: new Date().toISOString(),
      type: NotificationType.PROPERTY_CREATED,
      description: `New property ${event.property_name} was created.`,
      status: 'Completed',
      property_id: event.property_id,
      user_id: event.user_id
    });

    const property = await this.propertyService.getPropertyById(event.property_id)
    const admin_phone_number = property.owner.user.phone_number

    await this.whatsappService.sendText(admin_phone_number, `New property ${event.property_name} was created.`)
  }
}

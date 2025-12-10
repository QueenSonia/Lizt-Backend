import { OnEvent } from '@nestjs/event-emitter';
import { Injectable } from '@nestjs/common';
import { NotificationService } from '../notification.service';
import { NotificationType } from '../enums/notification-type';

export interface TenantAttachedEvent {
  property_id: string;
  property_name: string;
  tenant_id: string;
  tenant_name: string;
  user_id: string; // landlord/owner id
}

export interface TenancyEndedEvent {
  property_id: string;
  property_name: string;
  tenant_id: string;
  tenant_name: string;
  user_id: string; // landlord/owner id
  move_out_date: string;
}

@Injectable()
export class TenantAttachmentListener {
  constructor(private readonly notificationService: NotificationService) {}

  @OnEvent('tenant.attached')
  async handleTenantAttached(event: TenantAttachedEvent) {
    await this.notificationService.create({
      date: new Date().toISOString(),
      type: NotificationType.TENANT_ATTACHED,
      description: `${event.tenant_name} has been attached to ${event.property_name}.`,
      status: 'Completed',
      property_id: event.property_id,
      user_id: event.user_id,
    });
  }

  @OnEvent('tenancy.ended')
  async handleTenancyEnded(event: TenancyEndedEvent) {
    await this.notificationService.create({
      date: new Date().toISOString(),
      type: NotificationType.TENANCY_ENDED,
      description: `${event.tenant_name} has moved out of ${event.property_name}.`,
      status: 'Completed',
      property_id: event.property_id,
      user_id: event.user_id,
    });
  }
}

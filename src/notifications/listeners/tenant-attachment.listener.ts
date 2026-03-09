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

export interface TenancyRenewedEvent {
  property_id: string;
  property_name: string;
  tenant_id: string;
  tenant_name: string;
  user_id: string; // landlord/owner id
  rent_amount: number;
  payment_frequency: string;
  start_date: string;
  end_date: string;
}

export interface RenewalLinkSentEvent {
  property_id: string;
  property_name: string;
  tenant_id: string;
  tenant_name: string;
  user_id: string;
  amount: number;
}

export interface RenewalPaymentReceivedEvent {
  property_id: string;
  property_name: string;
  tenant_id: string;
  tenant_name: string;
  user_id: string;
  amount: number;
  payment_reference: string;
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

  @OnEvent('tenancy.renewed')
  async handleTenancyRenewed(event: TenancyRenewedEvent) {
    await this.notificationService.create({
      date: new Date().toISOString(),
      type: NotificationType.TENANCY_RENEWED,
      description: `Tenancy renewed for ${event.tenant_name} at ${event.property_name}. New rent: ₦${event.rent_amount.toLocaleString()}, Period: ${event.start_date} to ${event.end_date}.`,
      status: 'Completed',
      property_id: event.property_id,
      user_id: event.user_id,
    });
  }

  @OnEvent('renewal.link.sent')
  async handleRenewalLinkSent(event: RenewalLinkSentEvent) {
    await this.notificationService.create({
      date: new Date().toISOString(),
      type: NotificationType.RENEWAL_LINK_SENT,
      description: `Tenancy renewal link sent to ${event.tenant_name} for property ${event.property_name}. Total Amount: ₦${event.amount.toLocaleString()}.`,
      status: 'Completed',
      property_id: event.property_id,
      user_id: event.user_id,
    });
  }

  @OnEvent('renewal.payment.received')
  async handleRenewalPaymentReceived(event: RenewalPaymentReceivedEvent) {
    await this.notificationService.create({
      date: new Date().toISOString(),
      type: NotificationType.RENEWAL_PAYMENT_RECEIVED,
      description: `Renewal payment received from ${event.tenant_name} for property ${event.property_name}. Amount: ₦${event.amount.toLocaleString()}, Reference: ${event.payment_reference}.`,
      status: 'Completed',
      property_id: event.property_id,
      user_id: event.user_id,
    });
  }
}

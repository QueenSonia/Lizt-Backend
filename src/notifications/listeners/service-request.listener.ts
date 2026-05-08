import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationService } from '../notification.service';

import { NotificationType } from '../enums/notification-type';
import { ServiceRequestCreatedEvent } from '../events/service-request.event';
import { Property } from 'src/properties/entities/property.entity';
import { ServiceRequestStatusEnum } from 'src/service-requests/dto/create-service-request.dto';
import { TemplateSenderService } from 'src/whatsapp-bot/template-sender';
import { UtilService } from 'src/utils/utility-service';

@Injectable()
export class ServiceRequestListener {
  private readonly logger = new Logger(ServiceRequestListener.name);

  // 60-second in-memory dedup for FM "approved" pings — defends against the
  // landlord double-clicking the approve button. Map<request_id, ts>.
  private readonly approvalPingSeen = new Map<string, number>();
  private readonly APPROVAL_PING_DEDUP_MS = 60_000;

  constructor(
    private notificationService: NotificationService,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @Inject(forwardRef(() => TemplateSenderService))
    private readonly templateSenderService: TemplateSenderService,
    private readonly utilService: UtilService,
  ) {}

  @OnEvent('service.created')
  async handle(event: ServiceRequestCreatedEvent) {
    try {
      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.SERVICE_REQUEST,
        description: `${event.tenant_name} made a service request for ${event.property_name}.
${event.description}`,
        status: 'Pending',
        property_id: event.property_id,
        user_id: event.landlord_id,
        service_request_id: event.service_request_id,
      });
    } catch (error) {
      this.logger.error('Failed to create service request notification', error);
    }
  }

  @OnEvent('service.updated')
  async handleUpdate(event: any) {
    try {
      const statusChangeText = event.previous_status
        ? `changed from ${event.previous_status} to ${event.status}`
        : `status: ${event.status}`;

      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.SERVICE_REQUEST,
        description: `Service request for ${event.property_name}.
status ${statusChangeText}`,
        status: 'Pending',
        property_id: event.property_id,
        user_id: event.landlord_id,
        service_request_id: event.request_id,
      });
    } catch (error) {
      this.logger.error(
        'Failed to create service request update notification',
        error,
      );
    }

    // FM-targeted WhatsApp ping when the landlord approves a request.
    if (
      event?.previous_status === ServiceRequestStatusEnum.NOT_APPROVED &&
      event?.status === ServiceRequestStatusEnum.APPROVED &&
      event?.property_id
    ) {
      await this.pingFacilityManagerOnApproval(event);
    }
  }

  private async pingFacilityManagerOnApproval(event: any): Promise<void> {
    const requestKey: string = event.request_id;
    const now = Date.now();
    const lastSeen = this.approvalPingSeen.get(requestKey);
    if (lastSeen && now - lastSeen < this.APPROVAL_PING_DEDUP_MS) {
      return;
    }
    this.approvalPingSeen.set(requestKey, now);

    try {
      const property = await this.propertyRepository
        .createQueryBuilder('property')
        .leftJoinAndSelect('property.facility_manager', 'fm')
        .leftJoinAndSelect('fm.account', 'fmAccount')
        .leftJoinAndSelect('fmAccount.user', 'fmUser')
        .leftJoinAndSelect(
          'property.rents',
          'rent',
          'rent.rent_status = :activeStatus AND rent.deleted_at IS NULL',
          { activeStatus: 'active' },
        )
        .leftJoinAndSelect('rent.tenant', 'tenant')
        .leftJoinAndSelect('tenant.user', 'tenantUser')
        .where('property.id = :id', { id: event.property_id })
        .getOne();

      if (!property?.facility_manager?.account?.user?.phone_number) {
        return;
      }

      const fmUser = property.facility_manager.account.user;
      const fmAccount = property.facility_manager.account;
      const phone = this.utilService.normalizePhoneNumber(fmUser.phone_number);
      const tenantPhoneRaw = property.rents?.[0]?.tenant?.user?.phone_number;
      const tenantPhone = tenantPhoneRaw ?? '';
      const managerName =
        fmAccount.profile_name ||
        [fmUser.first_name, fmUser.last_name].filter(Boolean).join(' ') ||
        'Facility Manager';

      await this.templateSenderService.sendFacilityServiceRequestApproved({
        phone_number: phone,
        manager_name: managerName,
        property_name: event.property_name,
        property_location: property.location ?? '',
        service_request: event.description,
        tenant_name: event.tenant_name,
        tenant_phone_number: tenantPhone,
        date_created:
          (event.updated_at instanceof Date
            ? event.updated_at
            : new Date(event.updated_at ?? Date.now())
          ).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }),
      });
    } catch (err) {
      this.logger.warn(
        `Failed to send FM approval template for request ${event.request_id}: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}

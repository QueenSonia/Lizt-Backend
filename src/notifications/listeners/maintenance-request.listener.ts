import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationService } from '../notification.service';

import { NotificationType } from '../enums/notification-type';
import { MaintenanceRequestCreatedEvent } from '../events/maintenance-request.event';
import { Property } from 'src/properties/entities/property.entity';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import { MaintenanceRequestStatusEnum } from 'src/maintenance-requests/dto/create-maintenance-request.dto';
import { TemplateSenderService } from 'src/whatsapp-bot/template-sender';
import { UtilService } from 'src/utils/utility-service';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { RolesEnum } from 'src/base.entity';

@Injectable()
export class MaintenanceRequestListener {
  private readonly logger = new Logger(MaintenanceRequestListener.name);

  // 60-second in-memory dedup for FM "approved" pings — defends against the
  // landlord double-clicking the approve button. Map<request_id, ts>.
  private readonly approvalPingSeen = new Map<string, number>();
  private readonly APPROVAL_PING_DEDUP_MS = 60_000;

  constructor(
    private notificationService: NotificationService,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(MaintenanceRequest)
    private readonly maintenanceRequestRepository: Repository<MaintenanceRequest>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepository: Repository<TeamMember>,
    @Inject(forwardRef(() => TemplateSenderService))
    private readonly templateSenderService: TemplateSenderService,
    private readonly utilService: UtilService,
  ) {}

  @OnEvent('maintenance.created')
  async handle(event: MaintenanceRequestCreatedEvent) {
    try {
      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.MAINTENANCE_REQUEST,
        description: `${event.tenant_name} made a maintenance request for ${event.property_name}.
${event.description}`,
        status: 'Pending',
        property_id: event.property_id,
        user_id: event.landlord_id,
        maintenance_request_id: event.maintenance_request_id,
      });
    } catch (error) {
      this.logger.error('Failed to create maintenance request notification', error);
    }
  }

  @OnEvent('maintenance.assigned')
  async handleAssigned(event: {
    maintenance_request_id: string;
    request_id: string;
    previous_assignee: string | null;
    new_assignee: string | null;
    landlord_id: string;
    property_id: string | null;
    common_area_id: string | null;
  }): Promise<void> {
    if (!event?.new_assignee) {
      // Unassignment — nothing to ping.
      return;
    }

    try {
      const sr = await this.maintenanceRequestRepository
        .createQueryBuilder('sr')
        .leftJoinAndSelect('sr.facilityManager', 'fm')
        .leftJoinAndSelect('fm.account', 'fmAccount')
        .leftJoinAndSelect('fmAccount.user', 'fmUser')
        .leftJoinAndSelect('sr.property', 'property')
        .leftJoinAndSelect('sr.common_area', 'commonArea')
        .leftJoinAndSelect('sr.tenant', 'tenant')
        .leftJoinAndSelect('tenant.user', 'tenantUser')
        .where('sr.id = :id', { id: event.maintenance_request_id })
        .getOne();

      if (!sr) return;

      // Resolve the assignee's display name once — every FM on the team
      // sees the same body referencing the same assignee.
      const assigneeUser = sr.facilityManager?.account?.user;
      const assigneeName =
        sr.facilityManager?.account?.profile_name ||
        [assigneeUser?.first_name, assigneeUser?.last_name]
          .filter(Boolean)
          .join(' ') ||
        'a facility manager';

      const propertyName =
        sr.property?.name ?? sr.common_area?.name ?? sr.property_name ?? '';
      const tenantName = sr.tenant_name ?? '—';
      const description = sr.description ?? '';
      // Render tenant phone in Nigerian local format (0xxx) to match the
      // existing fm_maintenance_request_notification precedent.
      const tenantPhoneRaw = sr.tenant?.user?.phone_number ?? '';
      const tenantPhoneLocal = tenantPhoneRaw
        ? tenantPhoneRaw.startsWith('234')
          ? '0' + tenantPhoneRaw.slice(3)
          : tenantPhoneRaw.replace(/^\+234/, '0')
        : '—';

      // Fan out to every FM on the landlord's team (including the assignee
      // — see template doc comment for the redundancy tradeoff).
      const teamFms = await this.teamMemberRepository
        .createQueryBuilder('tm')
        .leftJoinAndSelect('tm.account', 'account')
        .leftJoinAndSelect('account.user', 'user')
        .innerJoin('tm.team', 'team')
        .where('team.creatorId = :landlordAccountId', {
          landlordAccountId: event.landlord_id,
        })
        .andWhere('tm.role = :role', { role: RolesEnum.FACILITY_MANAGER })
        .getMany();

      for (const fm of teamFms) {
        const phoneRaw = fm.account?.user?.phone_number;
        if (!phoneRaw) continue;
        try {
          const phone = this.utilService.normalizePhoneNumber(phoneRaw);
          await this.templateSenderService.sendFmAssignmentNotification({
            phone_number: phone,
            manager_name: assigneeName,
            tenant_name: tenantName,
            tenant_phone_number: tenantPhoneLocal,
            property_name: propertyName,
            maintenance_request: description,
          });
        } catch (err) {
          this.logger.warn(
            `Failed to send fm_assignment_notification to FM ${fm.id} for request ${event.request_id}: ${(err as Error)?.message ?? err}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `Failed to fan out assignment notifications for request ${event.request_id}: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  @OnEvent('maintenance.updated')
  async handleUpdate(event: any) {
    try {
      const statusChangeText = event.previous_status
        ? `changed from ${event.previous_status} to ${event.status}`
        : `status: ${event.status}`;

      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.MAINTENANCE_REQUEST,
        description: `Maintenance request for ${event.property_name}.
status ${statusChangeText}`,
        status: 'Pending',
        property_id: event.property_id,
        user_id: event.landlord_id,
        maintenance_request_id: event.request_id,
      });
    } catch (error) {
      this.logger.error(
        'Failed to create maintenance request update notification',
        error,
      );
    }

    // FM-targeted WhatsApp ping when the landlord approves a request.
    // Skipped when the source operation is also emitting maintenance.assigned
    // for the same transaction — the assignment fan-out already covers the
    // assigned FM, and double-pinging would be noisy.
    if (
      event?.previous_status === MaintenanceRequestStatusEnum.NOT_APPROVED &&
      event?.status === MaintenanceRequestStatusEnum.APPROVED &&
      event?.property_id &&
      !event?.skip_approval_ping
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
      // Resolve the assigned FM (if any) via maintenance_requests.assigned_to,
      // not via property.facility_manager — facility managers are now
      // pinned to maintenance requests, not properties.
      const sr = await this.maintenanceRequestRepository
        .createQueryBuilder('sr')
        .leftJoinAndSelect('sr.facilityManager', 'fm')
        .leftJoinAndSelect('fm.account', 'fmAccount')
        .leftJoinAndSelect('fmAccount.user', 'fmUser')
        .where('sr.id = :id', { id: event.request_id })
        .getOne();

      if (!sr?.facilityManager?.account?.user?.phone_number) {
        // No assigned FM yet, or the assignee lacks a phone — nothing to ping.
        return;
      }

      const property = await this.propertyRepository
        .createQueryBuilder('property')
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

      const fmUser = sr.facilityManager.account.user;
      const fmAccount = sr.facilityManager.account;
      const phone = this.utilService.normalizePhoneNumber(fmUser.phone_number);
      const tenantPhoneRaw = property?.rents?.[0]?.tenant?.user?.phone_number;
      const tenantPhone = tenantPhoneRaw ?? '';
      const managerName =
        fmAccount.profile_name ||
        [fmUser.first_name, fmUser.last_name].filter(Boolean).join(' ') ||
        'Facility Manager';

      await this.templateSenderService.sendFacilityMaintenanceRequestApproved({
        phone_number: phone,
        manager_name: managerName,
        property_name: event.property_name,
        property_location: property?.location ?? '',
        maintenance_request: event.description,
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

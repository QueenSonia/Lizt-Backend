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

  // Same dedup for the tenant "request resolved — confirm fix?" template.
  private readonly resolvedPingSeen = new Map<string, number>();
  private readonly RESOLVED_PING_DEDUP_MS = 60_000;

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

  // Builds the live-feed headline for a maintenance transition. Maps each
  // (prev → new) pair to a human-readable verb instead of dumping the raw
  // status arrow into the UI.
  private buildMaintenanceHeadline(
    status: string,
    previousStatus: string | null | undefined,
    propertyName: string,
  ): string {
    const property = propertyName || 'property';
    if (!previousStatus) {
      return `Maintenance request opened for ${property}.`;
    }
    switch (status) {
      case MaintenanceRequestStatusEnum.APPROVED:
        return `Maintenance request approved for ${property}.`;
      case MaintenanceRequestStatusEnum.RESOLVED:
        return `Maintenance request resolved for ${property}.`;
      case MaintenanceRequestStatusEnum.REOPENED:
        return `Maintenance request reopened for ${property}.`;
      case MaintenanceRequestStatusEnum.CLOSED:
        return `Maintenance request closed for ${property}.`;
      case MaintenanceRequestStatusEnum.NOT_APPROVED:
        return `Maintenance request reopened for review on ${property}.`;
      default:
        return `Maintenance request for ${property}.\nstatus changed from ${previousStatus} to ${status}`;
    }
  }

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
      const description = this.utilService.sanitizeTemplateParam(
        sr.description ?? '',
      );
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
      const headline = this.buildMaintenanceHeadline(
        event.status,
        event.previous_status,
        event.property_name,
      );
      const assigneeLine = event.assigned_to_name
        ? `\nAssigned to ${event.assigned_to_name}.`
        : '';

      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.MAINTENANCE_REQUEST,
        description: `${headline}${assigneeLine}`,
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

    // Tenant-targeted WhatsApp ping when the request is marked resolved
    // (covers approved→resolved and reopened→resolved). The WhatsApp
    // landlord-flow path already sends this template inline, so it
    // intentionally does not re-emit through here.
    if (
      event?.status === MaintenanceRequestStatusEnum.RESOLVED &&
      event?.previous_status &&
      event?.previous_status !== MaintenanceRequestStatusEnum.RESOLVED
    ) {
      await this.notifyTenantOnResolved(event);
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
        maintenance_request: this.utilService.sanitizeTemplateParam(
          event.description ?? '',
        ),
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

  private async notifyTenantOnResolved(event: any): Promise<void> {
    const requestKey: string = event.request_id;
    const now = Date.now();
    const lastSeen = this.resolvedPingSeen.get(requestKey);
    if (lastSeen && now - lastSeen < this.RESOLVED_PING_DEDUP_MS) {
      return;
    }
    this.resolvedPingSeen.set(requestKey, now);

    try {
      // event.request_id is the entity UUID; we need the human-readable
      // request_id (e.g. "SR7508697Q1") for the quick-reply button payload,
      // plus the tenant's phone and first name.
      const sr = await this.maintenanceRequestRepository
        .createQueryBuilder('sr')
        .leftJoinAndSelect('sr.tenant', 'tenant')
        .leftJoinAndSelect('tenant.user', 'tenantUser')
        .where('sr.id = :id', { id: event.request_id })
        .getOne();

      const tenantUser = sr?.tenant?.user;
      if (!sr || !tenantUser?.phone_number) {
        // No tenant attached (FM-created common-area request) or tenant has
        // no phone — nothing to ping.
        return;
      }

      const phone = this.utilService.normalizePhoneNumber(
        tenantUser.phone_number,
      );
      const tenantFirstName = this.utilService.toSentenceCase(
        tenantUser.first_name ?? '',
      );

      await this.templateSenderService.sendTenantConfirmationTemplate({
        phone_number: phone,
        tenant_name: tenantFirstName,
        request_description: this.utilService.sanitizeTemplateParam(
          sr.description ?? '',
        ),
        request_id: sr.request_id,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to send tenant resolved-confirmation template for request ${event.request_id}: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}

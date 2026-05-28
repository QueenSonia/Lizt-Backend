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
import { Account } from 'src/users/entities/account.entity';
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

  // Dedup the FM-created landlord WhatsApp ping + tenant-bound confirm prompt
  // + tenant-confirmed and tenant-denied landlord pings. Different maps so
  // the same request id can fire each kind once; identical 60s window.
  private readonly fmFiledLandlordSeen = new Map<string, number>();
  private readonly fmFiledTenantSeen = new Map<string, number>();
  private readonly tenantConfirmedLandlordSeen = new Map<string, number>();
  private readonly tenantDeniedLandlordSeen = new Map<string, number>();
  private readonly FM_FILED_PING_DEDUP_MS = 60_000;

  // Same dedup window for landlord-filed MR tenant prompts. Distinct map so
  // it doesn't share counters with the FM-filed path.
  private readonly landlordFiledTenantSeen = new Map<string, number>();

  constructor(
    private notificationService: NotificationService,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(MaintenanceRequest)
    private readonly maintenanceRequestRepository: Repository<MaintenanceRequest>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepository: Repository<TeamMember>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @Inject(forwardRef(() => TemplateSenderService))
    private readonly templateSenderService: TemplateSenderService,
    private readonly utilService: UtilService,
  ) {}

  /**
   * Resolve the landlord's normalized WhatsApp phone number from their
   * Account.id. Returns null when the account or phone is missing.
   */
  private async resolveLandlordPhone(
    landlordAccountId: string | null | undefined,
  ): Promise<string | null> {
    if (!landlordAccountId) return null;
    const account = await this.accountRepository.findOne({
      where: { id: landlordAccountId },
      relations: ['user'],
    });
    const phoneRaw = account?.user?.phone_number;
    if (!phoneRaw) return null;
    return this.utilService.normalizePhoneNumber(phoneRaw);
  }

  /**
   * Resolve the landlord's display name for use in WhatsApp template bodies.
   * Follows the project_landlord_display_name memory: prefer
   * accounts.profile_name, fall back to first+last from the joined user
   * row, fall back to 'there' if nothing is set.
   */
  private async resolveLandlordDisplayName(
    landlordAccountId: string | null | undefined,
  ): Promise<string> {
    if (!landlordAccountId) return 'there';
    const account = await this.accountRepository.findOne({
      where: { id: landlordAccountId },
      relations: ['user'],
    });
    const profile = account?.profile_name?.trim();
    if (profile) return profile;
    const first = account?.user?.first_name?.trim() ?? '';
    const last = account?.user?.last_name?.trim() ?? '';
    const combined = `${first} ${last}`.trim();
    return combined || 'there';
  }

  /**
   * Format a tenant phone (Meta-stored +234... or 234...) into Nigerian
   * local 0xxx form for display inside templates. Returns '—' when missing.
   */
  private formatTenantPhoneLocal(phoneRaw: string | null | undefined): string {
    if (!phoneRaw) return '—';
    if (phoneRaw.startsWith('234')) return '0' + phoneRaw.slice(3);
    return phoneRaw.replace(/^\+234/, '0');
  }

  /**
   * 60-second in-memory dedup gate. Returns true when the caller should
   * proceed; returns false if the key was seen within the window.
   */
  private dedup(map: Map<string, number>, key: string, ms: number): boolean {
    const now = Date.now();
    const last = map.get(key);
    if (last && now - last < ms) return false;
    map.set(key, now);
    return true;
  }

  // Trims free-text down to a single-line snippet suitable for the
  // live-feed subtitle. Collapses whitespace and caps length so a long
  // multi-paragraph note doesn't crowd the row.
  private formatIssueSnippet(
    text?: string | null,
    maxLength: number = 120,
  ): string {
    if (!text) return '';
    const collapsed = text.replace(/\s+/g, ' ').trim();
    if (!collapsed) return '';
    if (collapsed.length <= maxLength) return collapsed;
    return `${collapsed.slice(0, maxLength - 1).trimEnd()}…`;
  }

  // Picks the right per-event quote for the live-feed subtitle. Returns a
  // single line ready to drop after the headline:
  //   RESOLVED  → FM's resolution_summary, quoted ("Replaced the valve.")
  //   REOPENED  → reopen reason from whoever reopened, quoted
  //   other     → empty (no free-text note tied to the transition)
  private buildUpdateSubtitle(event: any): string {
    const status = event?.status as string | undefined;
    if (
      status === MaintenanceRequestStatusEnum.RESOLVED &&
      event?.resolution_summary
    ) {
      const note = this.formatIssueSnippet(event.resolution_summary);
      return note ? `"${note}"` : '';
    }
    if (
      status === MaintenanceRequestStatusEnum.REOPENED &&
      event?.reopen_message
    ) {
      const note = this.formatIssueSnippet(event.reopen_message);
      return note ? `"${note}"` : '';
    }
    return '';
  }

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

  /**
   * Build the landlord's in-app notification description. Branches on
   * creator type so FM-filed MRs don't render as "— made a maintenance
   * request…" (the literal tenant_name='—' placeholder bug). Tenant-filed
   * MRs keep the original "X made a maintenance request" wording.
   * Landlord-filed MRs are addressed in second person — the landlord IS the
   * recipient of this notification.
   */
  private buildCreationDescription(
    event: MaintenanceRequestCreatedEvent,
  ): string {
    const location =
      event.property_name ?? event.common_area_name ?? 'their property';
    const description = event.description ?? '';
    if (event.creator_type === 'landlord') {
      return `You filed a maintenance request for ${location}.
${description}`;
    }
    const creatorName =
      event.creator_name ?? event.tenant_name ?? 'Someone';
    const isFmFiled = event.creator_type === 'facility_manager';
    const subject = isFmFiled
      ? `Facility manager ${creatorName}`
      : (event.tenant_name ?? creatorName);
    const verb = isFmFiled ? 'filed' : 'made';
    return `${subject} ${verb} a maintenance request for ${location}.
${description}`;
  }

  @OnEvent('maintenance.created')
  async handle(event: MaintenanceRequestCreatedEvent) {
    try {
      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.MAINTENANCE_REQUEST,
        description: this.buildCreationDescription(event),
        status: 'Pending',
        property_id: event.property_id,
        user_id: event.landlord_id,
        maintenance_request_id: event.maintenance_request_id,
      });
    } catch (error) {
      this.logger.error('Failed to create maintenance request notification', error);
    }

    // FM-filed MRs that bypass the tenant gate (common-area, or vacant unit)
    // land in NOT_APPROVED directly — landlord needs the same WhatsApp
    // approve/reject template that tenant-filed MRs trigger. Previously this
    // template only fired from the WA tenant-create path, so FMs filing for
    // their landlord didn't trigger a landlord WA ping at all.
    if (event.creator_type === 'facility_manager') {
      try {
        await this.pingLandlordForFmFiledNotApproved(event);
      } catch (err) {
        this.logger.warn(
          `Failed to ping landlord WA for FM-filed not_approved MR ${event.maintenance_request_id}: ${(err as Error)?.message ?? err}`,
        );
      }
    }
  }

  private async pingLandlordForFmFiledNotApproved(
    event: MaintenanceRequestCreatedEvent,
  ): Promise<void> {
    const requestId: string = event.maintenance_request_id;
    if (
      !this.dedup(
        this.fmFiledLandlordSeen,
        requestId,
        this.FM_FILED_PING_DEDUP_MS,
      )
    ) {
      return;
    }

    const phone = await this.resolveLandlordPhone(event.landlord_id);
    if (!phone) return;

    const createdAt =
      event.created_at instanceof Date
        ? event.created_at
        : new Date(event.created_at ?? Date.now());

    await this.templateSenderService.sendFacilityMaintenanceRequest({
      phone_number: phone,
      manager_name: event.creator_name ?? 'your facility manager',
      property_name: event.property_name ?? event.common_area_name ?? '',
      property_location: event.property_location ?? '',
      maintenance_request: this.utilService.sanitizeTemplateParam(
        event.description ?? '',
      ),
      tenant_name: event.tenant_name ?? event.creator_name ?? 'Facility manager',
      tenant_phone_number: this.formatTenantPhoneLocal(
        event.tenant_phone_number,
      ),
      date_created: createdAt.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Africa/Lagos',
      }),
      is_landlord: true,
      maintenance_request_id: event.maintenance_request_id,
    });
  }

  /**
   * FM filed a unit-scoped MR with an active tenant. Fires three things:
   *   1. Landlord in-app: "FM X filed an issue at <property>. Waiting on
   *      <tenant>'s confirmation."
   *   2. Landlord WhatsApp (informational, no buttons) — template
   *      landlord_fm_filed_request_notification.
   *   3. Tenant WhatsApp (Confirm / Deny buttons) — unified template
   *      tenant_confirm_filed_request (shared with the landlord-filed path
   *      below; the filer-role discriminator is composed into the body
   *      via the `filer_label` param).
   */
  @OnEvent('maintenance.fm_filed_pending_tenant')
  async handleFmFiledPendingTenant(event: any): Promise<void> {
    const requestId: string = event.maintenance_request_id;

    try {
      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.MAINTENANCE_REQUEST,
        description: `Facility manager ${event.creator_name ?? 'unknown'} filed a maintenance request for ${event.property_name ?? event.common_area_name ?? 'their property'}. Waiting on ${event.tenant_name ?? 'tenant'}'s confirmation.
${event.description ?? ''}`,
        status: 'Pending',
        property_id: event.property_id,
        user_id: event.landlord_id,
        maintenance_request_id: event.maintenance_request_id,
      });
    } catch (error) {
      this.logger.error(
        'Failed to create FM-filed pending-tenant in-app notification',
        error,
      );
    }

    if (
      this.dedup(
        this.fmFiledLandlordSeen,
        requestId,
        this.FM_FILED_PING_DEDUP_MS,
      )
    ) {
      try {
        const landlordPhone = await this.resolveLandlordPhone(event.landlord_id);
        if (landlordPhone) {
          await this.templateSenderService.sendLandlordFmFiledRequestNotification(
            {
              phone_number: landlordPhone,
              landlord_name:
                event.landlord_first_name ?? 'there',
              fm_name: event.creator_name ?? 'your facility manager',
              property_name:
                event.property_name ?? event.common_area_name ?? '',
              maintenance_request: this.utilService.sanitizeTemplateParam(
                event.description ?? '',
              ),
            },
          );
        }
      } catch (err) {
        this.logger.warn(
          `Failed to send landlord_fm_filed_request_notification for ${requestId}: ${(err as Error)?.message ?? err}`,
        );
      }
    }

    if (
      this.dedup(this.fmFiledTenantSeen, requestId, this.FM_FILED_PING_DEDUP_MS)
    ) {
      try {
        const tenantPhoneRaw: string | undefined = event.tenant_phone_number;
        if (tenantPhoneRaw) {
          const tenantPhone = this.utilService.normalizePhoneNumber(tenantPhoneRaw);
          await this.templateSenderService.sendTenantConfirmFiledRequest({
            phone_number: tenantPhone,
            tenant_name: this.utilService.toSentenceCase(
              (event.tenant_name ?? '').split(' ')[0] ?? 'there',
            ),
            filer_label: `Your facility manager ${event.creator_name ?? 'team'}`,
            property_or_area_name:
              event.property_name ?? event.common_area_name ?? 'your residence',
            maintenance_request: this.utilService.sanitizeTemplateParam(
              event.description ?? '',
            ),
            maintenance_request_id: event.maintenance_request_id,
          });
        } else {
          this.logger.warn(
            `Cannot send tenant_confirm_filed_request: no tenant phone for request ${requestId}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Failed to send tenant_confirm_filed_request for ${requestId}: ${(err as Error)?.message ?? err}`,
        );
      }
    }
  }

  /**
   * Landlord filed a unit-scoped MR with an active tenant. Fires two things
   * (no landlord WhatsApp ping — the landlord IS the filer):
   *   1. Landlord in-app: "You filed an issue at <property>. Waiting on
   *      <tenant>'s confirmation."
   *   2. Tenant WhatsApp (Confirm / Deny buttons) via the unified
   *      `tenant_confirm_filed_request` template. The {{1}} body slot
   *      receives a composed filer label — "Your landlord <name>" here.
   *      The creator_name on the event is already the canonical landlord
   *      display name (accounts.profile_name with first+last fallback per
   *      project_landlord_display_name memory, set in the service's
   *      createMaintenanceRequestAsLandlord).
   */
  @OnEvent('maintenance.landlord_filed_pending_tenant')
  async handleLandlordFiledPendingTenant(event: any): Promise<void> {
    const requestId: string = event.maintenance_request_id;

    try {
      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.MAINTENANCE_REQUEST,
        description: `You filed a maintenance request for ${event.property_name ?? event.common_area_name ?? 'your property'}. Waiting on ${event.tenant_name ?? 'tenant'}'s confirmation.
${event.description ?? ''}`,
        status: 'Pending',
        property_id: event.property_id,
        user_id: event.landlord_id,
        maintenance_request_id: event.maintenance_request_id,
      });
    } catch (error) {
      this.logger.error(
        'Failed to create landlord-filed pending-tenant in-app notification',
        error,
      );
    }

    if (
      this.dedup(
        this.landlordFiledTenantSeen,
        requestId,
        this.FM_FILED_PING_DEDUP_MS,
      )
    ) {
      try {
        const tenantPhoneRaw: string | undefined = event.tenant_phone_number;
        if (tenantPhoneRaw) {
          const tenantPhone =
            this.utilService.normalizePhoneNumber(tenantPhoneRaw);
          await this.templateSenderService.sendTenantConfirmFiledRequest({
            phone_number: tenantPhone,
            tenant_name: this.utilService.toSentenceCase(
              (event.tenant_name ?? '').split(' ')[0] ?? 'there',
            ),
            filer_label: `Your landlord ${event.creator_name ?? 'team'}`,
            property_or_area_name:
              event.property_name ?? event.common_area_name ?? 'your residence',
            maintenance_request: this.utilService.sanitizeTemplateParam(
              event.description ?? '',
            ),
            maintenance_request_id: event.maintenance_request_id,
          });
        } else {
          this.logger.warn(
            `Cannot send tenant_confirm_filed_request: no tenant phone for landlord-filed request ${requestId}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Failed to send tenant_confirm_filed_request for landlord-filed ${requestId}: ${(err as Error)?.message ?? err}`,
        );
      }
    }
  }

  /**
   * Tenant confirmed (or landlord force-confirmed) the FM-filed request.
   * Landlord gets the existing approve/reject WhatsApp template — same one
   * tenant-filed MRs trigger — so the rest of the flow is identical. Skip
   * the WA ping when `forced_by_landlord` is true; the landlord is already
   * the actor, no point pinging themselves.
   */
  @OnEvent('maintenance.tenant_confirmed')
  async handleTenantConfirmed(event: any): Promise<void> {
    const requestId: string = event.maintenance_request_id ?? event.request_id;
    // Landlord-filed MRs auto-approve on tenant confirm — there's no further
    // approve/reject step. The in-app notification reflects that, and the
    // landlord-side approve/reject WhatsApp ping below is suppressed.
    const isLandlordFiled = event.creator_type === 'landlord';

    try {
      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.MAINTENANCE_REQUEST,
        description: isLandlordFiled
          ? event.forced_by_landlord
            ? `You confirmed on ${event.tenant_name ?? 'the tenant'}'s behalf. Your request is now approved.
${event.description ?? ''}`
            : `${event.tenant_name ?? 'The tenant'} confirmed the issue you filed. The request is now approved.
${event.description ?? ''}`
          : event.forced_by_landlord
            ? `You confirmed on ${event.tenant_name ?? 'the tenant'}'s behalf. Approve or reject to assign a facility manager.
${event.description ?? ''}`
            : `${event.tenant_name ?? 'The tenant'} confirmed the issue. Approve or reject to assign a facility manager.
${event.description ?? ''}`,
        status: 'Pending',
        property_id: event.property_id,
        user_id: event.landlord_id,
        maintenance_request_id: requestId,
      });
    } catch (error) {
      this.logger.error(
        'Failed to create tenant-confirmed in-app notification',
        error,
      );
    }

    if (event.forced_by_landlord) return;

    if (
      !this.dedup(
        this.tenantConfirmedLandlordSeen,
        requestId,
        this.FM_FILED_PING_DEDUP_MS,
      )
    ) {
      return;
    }

    // Landlord-filed → informational ping (no approve/reject buttons; the
    // request is already auto-approved). The FM ping, if any, is handled
    // by the separate maintenance.assigned emit.
    if (isLandlordFiled) {
      try {
        const landlordPhone = await this.resolveLandlordPhone(event.landlord_id);
        if (!landlordPhone) return;
        const landlordName = await this.resolveLandlordDisplayName(
          event.landlord_id,
        );
        await this.templateSenderService.sendLandlordFiledRequestConfirmedByTenant(
          {
            phone_number: landlordPhone,
            landlord_name: landlordName,
            tenant_name: event.tenant_name || 'Your tenant',
            property_name: event.property_name || 'your property',
            maintenance_request: this.utilService.sanitizeTemplateParam(
              event.description ?? '',
            ),
          },
        );
      } catch (err) {
        this.logger.warn(
          `Failed to send landlord WA after landlord-filed tenant-confirm for ${requestId}: ${(err as Error)?.message ?? err}`,
        );
      }
      return;
    }

    try {
      const sr = await this.maintenanceRequestRepository.findOne({
        where: { id: requestId },
        relations: ['property', 'tenant', 'tenant.user'],
      });
      if (!sr) return;

      const landlordPhone = await this.resolveLandlordPhone(event.landlord_id);
      if (!landlordPhone) return;

      const createdAt =
        sr.created_at instanceof Date ? sr.created_at : new Date();

      await this.templateSenderService.sendFacilityMaintenanceRequest({
        phone_number: landlordPhone,
        manager_name: 'there',
        property_name: sr.property?.name ?? sr.property_name ?? '',
        property_location: sr.property?.location ?? '',
        maintenance_request: this.utilService.sanitizeTemplateParam(
          sr.description ?? '',
        ),
        tenant_name: sr.tenant_name ?? 'The tenant',
        tenant_phone_number: this.formatTenantPhoneLocal(
          sr.tenant?.user?.phone_number ?? null,
        ),
        date_created: createdAt.toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Africa/Lagos',
        }),
        is_landlord: true,
        maintenance_request_id: sr.id,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to send landlord WA after tenant-confirm for ${requestId}: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  /**
   * Tenant denied the FM-filed request. Informational landlord WhatsApp
   * (no action buttons) + in-app notification. The denial commits on the
   * tenant's Deny tap (before they could possibly type a reason), so
   * event.denial_reason is effectively always null/empty at this point —
   * if a reason arrives later via the optional follow-up, it patches the
   * MR's rejection_reason column and surfaces in the dashboard activity
   * feed. We deliberately don't write it into the one-shot notification
   * description here.
   */
  @OnEvent('maintenance.tenant_denied')
  async handleTenantDenied(event: any): Promise<void> {
    const requestId: string = event.maintenance_request_id ?? event.request_id;
    const isLandlordFiled = event.creator_type === 'landlord';

    try {
      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.MAINTENANCE_REQUEST,
        description: isLandlordFiled
          ? `${event.tenant_name ?? 'The tenant'} denied the maintenance request you filed.
${event.description ?? ''}`
          : `${event.tenant_name ?? 'The tenant'} denied the maintenance request.
${event.description ?? ''}`,
        status: 'Pending',
        property_id: event.property_id,
        user_id: event.landlord_id,
        maintenance_request_id: requestId,
      });
    } catch (error) {
      this.logger.error(
        'Failed to create tenant-denied in-app notification',
        error,
      );
    }

    if (
      !this.dedup(
        this.tenantDeniedLandlordSeen,
        requestId,
        this.FM_FILED_PING_DEDUP_MS,
      )
    ) {
      return;
    }

    try {
      const landlordPhone = await this.resolveLandlordPhone(event.landlord_id);
      if (!landlordPhone) return;

      // Compose the {{3}} body slot so the message reads naturally after
      // "denied the maintenance request":
      //   - landlord-filed: "you filed"
      //   - FM-filed:       "filed by your facility manager <name>"
      const filedByLabel = isLandlordFiled
        ? 'you filed'
        : `filed by your facility manager ${event.creator_name ?? 'team'}`;

      await this.templateSenderService.sendLandlordRequestDeniedByTenant({
        phone_number: landlordPhone,
        landlord_name: event.landlord_first_name ?? 'there',
        tenant_name: event.tenant_name ?? 'The tenant',
        filed_by_label: filedByLabel,
        maintenance_request: this.utilService.sanitizeTemplateParam(
          event.description ?? '',
        ),
      });
    } catch (err) {
      this.logger.warn(
        `Failed to send landlord_request_denied_by_tenant for ${requestId}: ${(err as Error)?.message ?? err}`,
      );
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
        sr.property?.name ??
        (sr.common_area?.name
          ? `Common area - ${sr.common_area.name}`
          : null) ??
        sr.property_name ??
        '';
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
    // Skip in-app notification creation when the emitter already wrote a
    // more specific row (e.g. tenant_confirmed handler wrote "Miss Akpati
    // confirmed the issue you filed"). The event still propagates for
    // downstream listeners (WS gateway / cache invalidation).
    if (event?.skip_in_app_notification) return;
    try {
      const headline = this.buildMaintenanceHeadline(
        event.status,
        event.previous_status,
        event.property_name,
      );
      // Per-event subtitle: on RESOLVED show the FM's note; on REOPENED
      // show whatever the actor said (tenant feedback for tenant-initiated
      // reopens, FM/landlord reopen_message otherwise). Other transitions
      // (approved / closed / not_approved) don't carry a free-text note —
      // skip the subtitle so the feed stays clean.
      const subtitleSnippet = this.buildUpdateSubtitle(event);
      const subtitleLine = subtitleSnippet ? `\n${subtitleSnippet}` : '';
      const assigneeLine = event.assigned_to_name
        ? `\nAssigned to ${event.assigned_to_name}.`
        : '';

      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.MAINTENANCE_REQUEST,
        description: `${headline}${subtitleLine}${assigneeLine}`,
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

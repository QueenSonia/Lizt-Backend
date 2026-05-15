import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';

import { Users } from 'src/users/entities/user.entity';
import { accountHasRole } from 'src/users/entities/account.entity';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { CacheService } from 'src/lib/cache';
import { UtilService } from 'src/utils/utility-service';
import { RolesEnum } from 'src/base.entity';
import { MaintenanceRequestStatusEnum } from 'src/maintenance-requests/dto/create-maintenance-request.dto';
import { MaintenanceRequestsService } from 'src/maintenance-requests/maintenance-requests.service';
import { TemplateSenderService, ButtonDefinition } from '../template-sender';
import { IncomingMessage } from '../utils';
import { LandlordFlow } from '../templates/landlord/landlordflow';
import { TenantFlowService } from '../tenant-flow/tenant-flow.service';

/**
 * LandlordFlowService handles all landlord and facility manager WhatsApp message interactions.
 * This service is extracted from WhatsappBotService to centralize landlord/FM flow management.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.6
 */
@Injectable()
export class LandlordFlowService {
  private readonly logger = new Logger(LandlordFlowService.name);

  // Session timeout in milliseconds (5 minutes)
  private readonly SESSION_TIMEOUT_MS = 5 * 60 * 1000;

  constructor(
    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,

    @InjectRepository(MaintenanceRequest)
    private readonly maintenanceRequestRepo: Repository<MaintenanceRequest>,

    @InjectRepository(TeamMember)
    private readonly teamMemberRepo: Repository<TeamMember>,

    private readonly cache: CacheService,
    private readonly utilService: UtilService,
    private readonly maintenanceRequestService: MaintenanceRequestsService,
    private readonly templateSenderService: TemplateSenderService,
    private readonly landlordFlow: LandlordFlow,

    @Inject(forwardRef(() => TenantFlowService))
    private readonly tenantFlowService: TenantFlowService,
  ) {}

  /**
   * Handle text messages from facility managers
   * Requirements: 3.1
   */
  async handleFacilityText(
    message: IncomingMessage,
    from: string,
  ): Promise<void> {
    const text = message.text?.body;

    if (!text) {
      return;
    }

    const lowerText = text.toLowerCase();
    this.logger.log(`Facility text message: ${text}`);

    // Handle "switch role" command for multi-role users
    if (lowerText === 'switch role' || lowerText === 'switch') {
      await this.cache.delete(`selected_role_${from}`);
      await this.templateSenderService.sendText(
        from,
        'Role cleared. Send any message to select a new role.',
      );
      return;
    }

    if (lowerText === 'start flow') {
      // Note: sendFlow is not implemented in this service
      // This would need to be handled by the main WhatsappBotService
      this.logger.log(
        'Start flow requested - not implemented in LandlordFlowService',
      );
      return;
    }

    // Acknowledging via WhatsApp used to flip status to APPROVED, bypassing
    // the landlord-approval gate. The redesigned policy reserves approval
    // exclusively for the landlord (web), so this command is disabled for FM.
    if (lowerText === 'acknowledge request') {
      await this.templateSenderService.sendText(
        from,
        'Acknowledging requests is no longer available on WhatsApp. Approvals now happen on the web app.',
      );
      return;
    }

    if (lowerText === 'menu') {
      await this.templateSenderService.sendButtons(from, 'Menu Options', [
        { id: 'maintenance_request', title: 'Resolve request' },
        { id: 'view_account_info', title: 'View Account Info' },
        { id: 'visit_site', title: 'Visit our website' },
      ]);
      return;
    }

    if (lowerText === 'done') {
      // Batch delete both keys in one call
      await this.cache.deleteMultiple([
        `maintenance_request_state_${from}`,
        `maintenance_request_state_facility_${from}`,
      ]);
      await this.templateSenderService.sendText(
        from,
        'Thank you!  Your session has ended.',
      );
      return;
    }

    // Handle redis cache
    await this.cachedFacilityResponse(from, text);
  }

  /**
   * Handle cached response for facility manager session state
   * Requirements: 3.3
   */
  async cachedFacilityResponse(from: string, text: string): Promise<void> {
    const facilityState = await this.cache.get(
      `maintenance_request_state_facility_${from}`,
    );

    // Handle viewing specific request by number
    if (facilityState && facilityState.startsWith('view_request_list:')) {
      await this.handleViewRequestByNumber(from, text, facilityState);
      return;
    }

    // Handle marking request as resolved (kept for backward compatibility with text input)
    if (facilityState && facilityState.startsWith('viewing_request:')) {
      // User is viewing a request but typed text instead of using buttons
      await this.templateSenderService.sendText(
        from,
        'Please use the buttons above to mark as resolved or go back to the list.',
      );
      return;
    }

    // Legacy state-changing flows (acknowledged / resolve-or-update /
    // awaiting_update / awaiting_resolution) are no longer reachable from
    // WhatsApp — the FM surface is read-only. If a stale cache entry resurfaces,
    // clear it and nudge the FM to the web app.
    if (
      facilityState === 'acknowledged' ||
      facilityState === 'resolve-or-update' ||
      facilityState === 'awaiting_update' ||
      facilityState === 'awaiting_resolution'
    ) {
      await this.cache.delete(`maintenance_request_state_facility_${from}`);
      await this.templateSenderService.sendText(
        from,
        'Updating or resolving requests is now done in the web app. Type "menu" to see other options.',
      );
      return;
    }

    // Default: show facility manager menu
    await this.showFacilityManagerMenu(from);
  }

  /**
   * Handle viewing a specific request by number from the list
   */
  private async handleViewRequestByNumber(
    from: string,
    text: string,
    facilityState: string,
  ): Promise<void> {
    const requestIds = JSON.parse(facilityState.split('view_request_list:')[1]);
    const selectedIndex = parseInt(text.trim()) - 1;

    if (
      isNaN(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= requestIds.length
    ) {
      await this.templateSenderService.sendText(
        from,
        "I couldn't find that request. Please try again with a valid number.",
      );
      return;
    }

    const requestId = requestIds[selectedIndex];
    const maintenanceRequest = await this.maintenanceRequestRepo.findOne({
      where: { id: requestId },
      relations: ['tenant', 'tenant.user', 'property'],
    });

    if (!maintenanceRequest) {
      await this.templateSenderService.sendText(
        from,
        "I couldn't find that request. Please try again.",
      );
      return;
    }

    // Defensive: even though the list query filters to visible states, the
    // user could type a stale number. Reject anything outside the visible set.
    const FM_VISIBLE_STATUSES: MaintenanceRequestStatusEnum[] = [
      MaintenanceRequestStatusEnum.APPROVED,
      MaintenanceRequestStatusEnum.RESOLVED,
      MaintenanceRequestStatusEnum.REOPENED,
    ];
    if (!FM_VISIBLE_STATUSES.includes(maintenanceRequest.status)) {
      await this.templateSenderService.sendText(
        from,
        "That request isn't visible here. Open the web app for full details.",
      );
      return;
    }

    if (!maintenanceRequest.property) {
      await this.templateSenderService.sendText(
        from,
        'Unable to load full request details. Please contact support.',
      );
      return;
    }

    const statusLabel = this.getStatusLabel(maintenanceRequest.status);
    const tenantUser = maintenanceRequest.tenant?.user;
    const reporterLines = tenantUser
      ? `Tenant: ${this.utilService.toSentenceCase(tenantUser.first_name)} ${this.utilService.toSentenceCase(tenantUser.last_name)}\n` +
        (tenantUser.phone_number ? `Phone: ${tenantUser.phone_number}\n` : '')
      : `Reporter: ${maintenanceRequest.tenant_name || 'Facility manager'}\n`;

    await this.templateSenderService.sendText(
      from,
      `*${maintenanceRequest.description}*\n\n${reporterLines}Property: ${maintenanceRequest.property.name}\nStatus: ${statusLabel}`,
    );

    // Marking resolved now happens in the web app (we capture cost +
    // category + summary there). The detail card on WhatsApp is read-only.
    // CTA URL message takes only one button, so "Back to List" goes in a
    // separate reply-button message right after.
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const dashboardUrl = `${frontendUrl}/facility-manager/issues`;
    await this.templateSenderService.sendCtaUrl(
      from,
      'Tap below to manage this request in your dashboard — we capture cost, category, and summary there when marking it resolved.',
      'Open in web app',
      dashboardUrl,
    );

    await this.templateSenderService.sendButtons(
      from,
      'Or return to the list:',
      [{ id: 'back_to_list', title: 'Back to List' }],
    );

    await this.cache.set(
      `maintenance_request_state_facility_${from}`,
      `viewing_request:${maintenanceRequest.id}`,
      this.SESSION_TIMEOUT_MS,
    );
  }

  /**
   * Get human-readable status label
   */
  private getStatusLabel(status: string | null): string {
    if (!status) {
      return 'Unknown';
    }
    switch (status) {
      case MaintenanceRequestStatusEnum.NOT_APPROVED:
        return 'Pending Approval';
      case MaintenanceRequestStatusEnum.APPROVED:
        return 'Approved';
      case MaintenanceRequestStatusEnum.RESOLVED:
        return 'Resolved';
      case MaintenanceRequestStatusEnum.REOPENED:
        return 'Reopened';
      case MaintenanceRequestStatusEnum.CLOSED:
        return 'Closed';
      default:
        return status;
    }
  }

  /**
   * Handle acknowledged state - user is providing request ID to acknowledge
   */
  private async handleAcknowledgedState(
    from: string,
    text: string,
  ): Promise<void> {
    const maintenanceRequest = await this.maintenanceRequestRepo.findOne({
      where: {
        request_id: text,
      },
      relations: [
        'tenant',
        'tenant.user',
        'facilityManager',
        'facilityManager.account',
      ],
    });

    if (!maintenanceRequest) {
      await this.templateSenderService.sendText(
        from,
        'No maintenance requests found with that ID. try again',
      );
      await this.cache.delete(`maintenance_request_state_facility_${from}`);
      return;
    }

    // FM acknowledging via WhatsApp moves the request into the "approved &
    // being worked on" state. This bypasses the landlord-approval gate
    // because the WhatsApp ack flow is intentionally out-of-band.
    await this.maintenanceRequestService.updateStatus(
      maintenanceRequest.id,
      MaintenanceRequestStatusEnum.APPROVED,
      `Acknowledged by facility manager via WhatsApp`,
      {
        id: maintenanceRequest.facilityManager?.account?.user?.id || 'system',
        role: 'facility_manager',
        name:
          maintenanceRequest.facilityManager?.account?.profile_name ||
          'Facility Manager',
      },
    );

    await this.templateSenderService.sendText(
      from,
      `You have acknowledged maintenance request ID: ${text}`,
    );

    if (maintenanceRequest.tenant?.user?.phone_number) {
      await this.templateSenderService.sendText(
        this.utilService.normalizePhoneNumber(
          maintenanceRequest.tenant.user.phone_number,
        ),
        `Your maintenance request with ID: ${text} is being processed by ${this.utilService.toSentenceCase(
          maintenanceRequest.facilityManager?.account?.profile_name || 'your facility manager',
        )}.`,
      );
    }

    await this.cache.delete(`maintenance_request_state_facility_${from}`);
  }

  /**
   * Handle resolve-or-update state - user choosing between update and resolve
   */
  private async handleResolveOrUpdateState(
    from: string,
    text: string,
  ): Promise<void> {
    if (text.toLowerCase() === 'update') {
      await this.cache.set(
        `maintenance_request_state_facility_${from}`,
        'awaiting_update',
        this.SESSION_TIMEOUT_MS,
      );
      await this.templateSenderService.sendText(
        from,
        'Please provide the request ID and feedback-update separated by a colon. e.g "#SR12345: Your request is being processed"',
      );
      return;
    }

    if (text.toLowerCase() === 'resolve') {
      await this.cache.set(
        `maintenance_request_state_facility_${from}`,
        'awaiting_resolution',
        this.SESSION_TIMEOUT_MS,
      );
      await this.templateSenderService.sendText(
        from,
        'Please provide the request ID to resolve e.g #SR12345',
      );
      return;
    }

    await this.templateSenderService.sendText(
      from,
      'Invalid option. Please type "update" or "resolve".',
    );
  }

  /**
   * Handle awaiting_update state - user providing request ID and feedback
   */
  private async handleAwaitingUpdateState(
    from: string,
    text: string,
  ): Promise<void> {
    const [requestId, ...feedbackParts] = text.split(':');
    const feedback = feedbackParts.join(':').trim();

    if (!requestId || !feedback) {
      await this.templateSenderService.sendText(
        from,
        'Invalid format. Please provide the request ID and feedback-update separated by a colon. e.g "#SR12345: Your request is being processed"',
      );
      await this.templateSenderService.sendText(
        from,
        'Type the right format to see other options or "done" to finish.',
      );
      return;
    }

    const maintenanceRequest = await this.maintenanceRequestRepo.findOne({
      where: {
        request_id: requestId.trim(),
      },
      relations: ['tenant', 'tenant.user', 'facilityManager'],
    });

    if (!maintenanceRequest) {
      await this.templateSenderService.sendText(
        from,
        'No maintenance requests found with that ID. try again',
      );
      await this.cache.delete(`maintenance_request_state_facility_${from}`);
      return;
    }

    maintenanceRequest.notes = feedback;
    await this.maintenanceRequestRepo.save(maintenanceRequest);

    await this.templateSenderService.sendText(
      from,
      `You have updated maintenance request ID: ${requestId.trim()}`,
    );

    if (maintenanceRequest.tenant?.user?.phone_number) {
      await this.templateSenderService.sendText(
        this.utilService.normalizePhoneNumber(
          maintenanceRequest.tenant.user.phone_number,
        ),
        `Update on your maintenance request with ID: ${requestId.trim()} - ${feedback}`,
      );
    }

    await this.cache.delete(`maintenance_request_state_facility_${from}`);
  }

  /**
   * Handle awaiting_resolution state - user providing request ID to resolve
   */
  private async handleAwaitingResolutionState(
    from: string,
    text: string,
  ): Promise<void> {
    const requestId = text.trim();

    if (!requestId) {
      await this.templateSenderService.sendText(
        from,
        'Invalid format. Please provide the request ID to resolve e.g "#SR12345"',
      );
      return;
    }

    const maintenanceRequest = await this.maintenanceRequestRepo.findOne({
      where: {
        request_id: requestId,
      },
      relations: ['tenant', 'tenant.user', 'facilityManager'],
    });

    if (!maintenanceRequest) {
      await this.templateSenderService.sendText(
        from,
        'No maintenance requests found with that ID. try again',
      );
      await this.cache.delete(`maintenance_request_state_facility_${from}`);
      return;
    }

    await this.maintenanceRequestService.updateStatus(
      maintenanceRequest.id,
      MaintenanceRequestStatusEnum.RESOLVED,
    );

    await this.templateSenderService.sendText(
      from,
      `You have resolved maintenance request ID: ${requestId}. Waiting for tenant confirmation.`,
    );

    if (maintenanceRequest.tenant?.user?.phone_number) {
      await this.templateSenderService.sendTenantConfirmationTemplate({
        phone_number: this.utilService.normalizePhoneNumber(
          maintenanceRequest.tenant.user.phone_number,
        ),
        tenant_name: this.utilService.toSentenceCase(
          maintenanceRequest.tenant.user.first_name,
        ),
        request_description: maintenanceRequest.description,
        request_id: maintenanceRequest.request_id,
      });
    }

    await this.cache.delete(`maintenance_request_state_facility_${from}`);
  }

  /**
   * Show facility manager menu
   */
  private async showFacilityManagerMenu(from: string): Promise<void> {
    const user = await this.findFacilityManagerByPhone(from);

    if (!user) {
      await this.templateSenderService.sendToAgentWithTemplate(from);
    } else {
      await this.templateSenderService.sendFacilityManagerMainMenu(
        from,
        this.utilService.toSentenceCase(user.first_name),
      );
    }
  }

  /**
   * Find facility manager by phone number using normalized format.
   *
   * Filters accounts in JS instead of SQL because `accounts.role` is a
   * single-value mirror of `roles[0]`; a multi-role account whose FM role
   * isn't first in `roles[]` is invisible to a `WHERE accounts.role = 'fm'`
   * filter, causing the FM to fall into the agent_welcome fallback.
   */
  private async findFacilityManagerByPhone(
    phoneNumber: string,
  ): Promise<Users | null> {
    const normalizedPhone = this.utilService.normalizePhoneNumber(phoneNumber);

    const user = await this.usersRepo.findOne({
      where: { phone_number: normalizedPhone },
      relations: ['accounts'],
    });

    if (!user) {
      return null;
    }

    const hasFm = user.accounts?.some((acc) =>
      accountHasRole(acc, RolesEnum.FACILITY_MANAGER),
    );

    return hasFm ? user : null;
  }

  /**
   * Handle interactive button messages from facility managers
   * Requirements: 3.2
   */
  async handleFacilityInteractive(
    message: IncomingMessage,
    from: string,
  ): Promise<void> {
    // Handle both interactive button_reply and direct button formats
    const buttonReply =
      (
        message.interactive as {
          button_reply?: { id?: string; payload?: string };
        }
      )?.button_reply ||
      (message as unknown as { button?: { id?: string; payload?: string } })
        .button;
    const buttonId = buttonReply?.id || buttonReply?.payload;

    this.logger.log('🔘 FM Button clicked:', {
      messageType: message.type,
      buttonReply,
      buttonId,
      from,
    });

    if (!buttonReply || !buttonId) {
      this.logger.log('❌ No button reply found in message');
      return;
    }

    switch (buttonId) {
      case 'view_all_maintenance_requests':
      case 'maintenance_request':
        await this.handleViewAllMaintenanceRequests(from);
        break;

      case 'view_account_info':
        await this.handleViewAccountInfo(from);
        break;

      case 'visit_site':
        await this.templateSenderService.sendText(
          from,
          'Visit our website: https://propertykraft.africa',
        );
        break;

      case 'back_to_list':
        await this.templateSenderService.sendButtons(
          from,
          'What would you like to do?',
          [
            { id: 'maintenance_request', title: 'View all requests' },
            { id: 'view_account_info', title: 'View Account Info' },
          ],
        );
        await this.cache.delete(`maintenance_request_state_facility_${from}`);
        break;

      default:
        // Handle tenant-specific actions by routing to tenant flow
        if (buttonId.startsWith('confirm_tenancy_details:')) {
          const propertyId = buttonId.split(':')[1];
          await this.tenantFlowService.handleConfirmTenancyDetails(
            from,
            propertyId,
          );
          break;
        }

        // mark_resolved: postbacks could still arrive from older menu cards
        // cached on the user's device. Reject them — the action moved to web.
        if (
          buttonId.startsWith('mark_resolved:') ||
          buttonId === 'open_in_web_app'
        ) {
          await this.templateSenderService.sendText(
            from,
            'Please mark this request resolved in the web app — we now require cost and category details.',
          );
        } else {
          await this.templateSenderService.sendText(
            from,
            '❓ Unknown option selected.',
          );
        }
    }
  }

  /**
   * Handle view all maintenance requests button
   */
  private async handleViewAllMaintenanceRequests(from: string): Promise<void> {
    this.logger.log('✅ Matched view_all_maintenance_requests or maintenance_request');

    const teamMemberInfo = await this.findTeamMemberByPhone(from);

    if (!teamMemberInfo) {
      await this.templateSenderService.sendText(
        from,
        'No team info available.',
      );
      return;
    }

    // FM-on-WhatsApp is read-only and limited to live work. We hide
    // NOT_APPROVED (pending landlord approval; FM cannot act yet) and
    // CLOSED (finalized; nothing to do). Approved + resolved + reopened
    // remain visible as a quick at-a-glance check from chat. Further
    // scoped to requests assigned to this specific FM — team-wide
    // visibility is on the web app.
    const maintenanceRequests = await this.maintenanceRequestRepo.find({
      where: {
        property: {
          owner_id: teamMemberInfo.team.creatorId,
        },
        assigned_to: teamMemberInfo.id,
        status: In([
          MaintenanceRequestStatusEnum.APPROVED,
          MaintenanceRequestStatusEnum.RESOLVED,
          MaintenanceRequestStatusEnum.REOPENED,
        ]),
      },
      relations: ['tenant', 'tenant.user', 'property'],
    });

    if (!maintenanceRequests.length) {
      await this.templateSenderService.sendText(
        from,
        'No maintenance requests assigned to you.',
      );
      return;
    }

    let response = 'Here are all maintenance requests:\n\n';
    maintenanceRequests.forEach((req, i) => {
      const location = req.property?.name ?? req.property_name ?? 'Common area';
      response += `${i + 1}. ${req.description} (${location})\n\n`;
    });

    response += 'Reply with a number to view details.';

    await this.templateSenderService.sendText(from, response);

    await this.cache.set(
      `maintenance_request_state_facility_${from}`,
      `view_request_list:${JSON.stringify(maintenanceRequests.map((r) => r.id))}`,
      this.SESSION_TIMEOUT_MS,
    );
  }

  /**
   * Handle view account info button
   */
  private async handleViewAccountInfo(from: string): Promise<void> {
    const teamMemberAccountInfo = await this.findTeamMemberByPhone(from);

    if (!teamMemberAccountInfo) {
      await this.templateSenderService.sendText(
        from,
        'No account info available.',
      );
      return;
    }

    await this.templateSenderService.sendText(
      from,
      `Account Info for ${this.utilService.toSentenceCase(
        teamMemberAccountInfo.account.profile_name,
      )}:\n\n` +
        `- Email: ${teamMemberAccountInfo.account.email}\n` +
        `- Phone: ${teamMemberAccountInfo.account.user.phone_number}\n` +
        `- Role: ${this.utilService.toSentenceCase(
          teamMemberAccountInfo.account.role ??
            teamMemberAccountInfo.account.roles?.[0] ??
            '',
        )}`,
    );

    await this.templateSenderService.sendText(
      from,
      'Type "menu" to see other options or "done" to finish.',
    );
  }

  /**
   * Handle mark resolved button
   */
  private async handleMarkResolved(
    from: string,
    buttonId: string,
  ): Promise<void> {
    const requestId = buttonId.split('mark_resolved:')[1];

    const maintenanceRequest = await this.maintenanceRequestRepo.findOne({
      where: { id: requestId },
      relations: ['tenant', 'tenant.user', 'facilityManager'],
    });

    if (!maintenanceRequest) {
      await this.templateSenderService.sendText(
        from,
        "I couldn't find that request.",
      );
      await this.cache.delete(`maintenance_request_state_facility_${from}`);
      return;
    }

    if (maintenanceRequest.status === MaintenanceRequestStatusEnum.CLOSED) {
      await this.templateSenderService.sendText(
        from,
        'This request has already been closed.',
      );
      await this.cache.delete(`maintenance_request_state_facility_${from}`);
      return;
    }

    // Get facility manager info
    const facilityManager = await this.findTeamMemberByPhone(from);

    await this.maintenanceRequestService.updateStatus(
      maintenanceRequest.id,
      MaintenanceRequestStatusEnum.RESOLVED,
      'Facility manager marked as resolved via WhatsApp',
      {
        id: facilityManager?.account?.user?.id || 'system',
        role: 'facility_manager',
        name: facilityManager?.account?.profile_name || 'Facility Manager',
      },
    );

    await this.templateSenderService.sendText(
      from,
      "Great! I've marked this request as resolved. The tenant will confirm if everything is working correctly.",
    );

    if (maintenanceRequest.tenant?.user?.phone_number) {
      try {
        await this.templateSenderService.sendTenantConfirmationTemplate({
          phone_number: this.utilService.normalizePhoneNumber(
            maintenanceRequest.tenant.user.phone_number,
          ),
          tenant_name: this.utilService.toSentenceCase(
            maintenanceRequest.tenant.user.first_name,
          ),
          request_description: maintenanceRequest.description,
          request_id: maintenanceRequest.request_id,
        });
      } catch (error) {
        this.logger.error('Failed to send tenant confirmation:', error);
      }
    }

    await this.cache.delete(`maintenance_request_state_facility_${from}`);
  }

  /**
   * Find team member by phone number using normalized format
   */
  private async findTeamMemberByPhone(
    phoneNumber: string,
  ): Promise<TeamMember | null> {
    const normalizedPhone = this.utilService.normalizePhoneNumber(phoneNumber);

    const teamMember = await this.teamMemberRepo.findOne({
      where: {
        account: { user: { phone_number: normalizedPhone } },
      },
      relations: ['team', 'account', 'account.user'],
    });

    return teamMember;
  }

  // ============================================================================
  // LANDLORD FLOW DELEGATION METHODS
  // These methods delegate to the existing LandlordFlow class
  // Requirements: 3.6
  // ============================================================================

  /**
   * Handle text messages from landlords
   * Delegates to LandlordFlow
   */
  async handleLandlordText(from: string, text: string): Promise<void> {
    return this.landlordFlow.handleText(from, text);
  }

  /**
   * Handle interactive button messages from landlords
   * Delegates to LandlordFlow
   */
  async handleLandlordInteractive(
    message: IncomingMessage,
    from: string,
  ): Promise<void> {
    return this.landlordFlow.handleInteractive(message, from);
  }
}

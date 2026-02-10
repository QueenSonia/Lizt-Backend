import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';

import { Users } from 'src/users/entities/user.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { CacheService } from 'src/lib/cache';
import { UtilService } from 'src/utils/utility-service';
import { RolesEnum } from 'src/base.entity';
import { ServiceRequestStatusEnum } from 'src/service-requests/dto/create-service-request.dto';
import { ServiceRequestsService } from 'src/service-requests/service-requests.service';
import { TemplateSenderService, ButtonDefinition } from '../template-sender';
import { IncomingMessage } from '../utils';
import { LandlordFlow } from '../templates/landlord/landlordflow';

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

    @InjectRepository(ServiceRequest)
    private readonly serviceRequestRepo: Repository<ServiceRequest>,

    @InjectRepository(TeamMember)
    private readonly teamMemberRepo: Repository<TeamMember>,

    private readonly cache: CacheService,
    private readonly utilService: UtilService,
    private readonly serviceRequestService: ServiceRequestsService,
    private readonly templateSenderService: TemplateSenderService,
    private readonly landlordFlow: LandlordFlow,
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

    if (lowerText === 'acknowledge request') {
      await this.cache.set(
        `service_request_state_facility_${from}`,
        'acknowledged',
        this.SESSION_TIMEOUT_MS,
      );
      await this.templateSenderService.sendText(
        from,
        'Please provide the request ID to acknowledge',
      );
      return;
    }

    if (lowerText === 'menu') {
      await this.templateSenderService.sendButtons(from, 'Menu Options', [
        { id: 'service_request', title: 'Resolve request' },
        { id: 'view_account_info', title: 'View Account Info' },
        { id: 'visit_site', title: 'Visit our website' },
      ]);
      return;
    }

    if (lowerText === 'done') {
      // Batch delete both keys in one call
      await this.cache.deleteMultiple([
        `service_request_state_${from}`,
        `service_request_state_facility_${from}`,
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
      `service_request_state_facility_${from}`,
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

    if (facilityState === 'acknowledged') {
      await this.handleAcknowledgedState(from, text);
      return;
    }

    if (facilityState === 'resolve-or-update') {
      await this.handleResolveOrUpdateState(from, text);
      return;
    }

    if (facilityState === 'awaiting_update') {
      await this.handleAwaitingUpdateState(from, text);
      return;
    }

    if (facilityState === 'awaiting_resolution') {
      await this.handleAwaitingResolutionState(from, text);
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
    const serviceRequest = await this.serviceRequestRepo.findOne({
      where: { id: requestId },
      relations: ['tenant', 'tenant.user', 'property'],
    });

    if (!serviceRequest) {
      await this.templateSenderService.sendText(
        from,
        "I couldn't find that request. Please try again.",
      );
      return;
    }

    const statusLabel = this.getStatusLabel(serviceRequest.status);

    await this.templateSenderService.sendText(
      from,
      `*${serviceRequest.description}*\n\nTenant: ${this.utilService.toSentenceCase(serviceRequest.tenant.user.first_name)} ${this.utilService.toSentenceCase(serviceRequest.tenant.user.last_name)}\nProperty: ${serviceRequest.property.name}\nStatus: ${statusLabel}`,
    );

    await this.templateSenderService.sendButtons(
      from,
      'What would you like to do?',
      [
        { id: `mark_resolved:${serviceRequest.id}`, title: 'Mark as Resolved' },
        { id: 'back_to_list', title: 'Back to List' },
      ],
    );

    await this.cache.set(
      `service_request_state_facility_${from}`,
      `viewing_request:${serviceRequest.id}`,
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
      case ServiceRequestStatusEnum.OPEN:
        return 'Open';
      case ServiceRequestStatusEnum.RESOLVED:
        return 'Resolved';
      case ServiceRequestStatusEnum.REOPENED:
        return 'Reopened';
      case ServiceRequestStatusEnum.IN_PROGRESS:
        return 'In Progress';
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
    const serviceRequest = await this.serviceRequestRepo.findOne({
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

    if (!serviceRequest) {
      await this.templateSenderService.sendText(
        from,
        'No service requests found with that ID. try again',
      );
      await this.cache.delete(`service_request_state_facility_${from}`);
      return;
    }

    // Update status via service to track history
    await this.serviceRequestService.updateStatus(
      serviceRequest.id,
      ServiceRequestStatusEnum.IN_PROGRESS,
      `Acknowledged by facility manager via WhatsApp`,
      {
        id: serviceRequest.facilityManager?.account?.user?.id || 'system',
        role: 'facility_manager',
        name:
          serviceRequest.facilityManager?.account?.profile_name ||
          'Facility Manager',
      },
    );

    await this.templateSenderService.sendText(
      from,
      `You have acknowledged service request ID: ${text}`,
    );

    await this.templateSenderService.sendText(
      this.utilService.normalizePhoneNumber(
        serviceRequest.tenant.user.phone_number,
      ),
      `Your service request with ID: ${text} is being processed by ${this.utilService.toSentenceCase(
        serviceRequest.facilityManager.account.profile_name,
      )}.`,
    );

    await this.cache.delete(`service_request_state_facility_${from}`);
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
        `service_request_state_facility_${from}`,
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
        `service_request_state_facility_${from}`,
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

    const serviceRequest = await this.serviceRequestRepo.findOne({
      where: {
        request_id: requestId.trim(),
      },
      relations: ['tenant', 'tenant.user', 'facilityManager'],
    });

    if (!serviceRequest) {
      await this.templateSenderService.sendText(
        from,
        'No service requests found with that ID. try again',
      );
      await this.cache.delete(`service_request_state_facility_${from}`);
      return;
    }

    serviceRequest.notes = feedback;
    await this.serviceRequestRepo.save(serviceRequest);

    await this.templateSenderService.sendText(
      from,
      `You have updated service request ID: ${requestId.trim()}`,
    );

    await this.templateSenderService.sendText(
      this.utilService.normalizePhoneNumber(
        serviceRequest.tenant.user.phone_number,
      ),
      `Update on your service request with ID: ${requestId.trim()} - ${feedback}`,
    );

    await this.cache.delete(`service_request_state_facility_${from}`);
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

    const serviceRequest = await this.serviceRequestRepo.findOne({
      where: {
        request_id: requestId,
      },
      relations: ['tenant', 'tenant.user', 'facilityManager'],
    });

    if (!serviceRequest) {
      await this.templateSenderService.sendText(
        from,
        'No service requests found with that ID. try again',
      );
      await this.cache.delete(`service_request_state_facility_${from}`);
      return;
    }

    await this.serviceRequestService.updateStatus(
      serviceRequest.id,
      ServiceRequestStatusEnum.RESOLVED,
    );

    await this.templateSenderService.sendText(
      from,
      `You have resolved service request ID: ${requestId}. Waiting for tenant confirmation.`,
    );

    // Trigger Tenant Confirmation
    await this.templateSenderService.sendTenantConfirmationTemplate({
      phone_number: this.utilService.normalizePhoneNumber(
        serviceRequest.tenant.user.phone_number,
      ),
      tenant_name: this.utilService.toSentenceCase(
        serviceRequest.tenant.user.first_name,
      ),
      request_description: serviceRequest.description,
      request_id: serviceRequest.request_id,
    });

    await this.cache.delete(`service_request_state_facility_${from}`);
  }

  /**
   * Show facility manager menu
   */
  private async showFacilityManagerMenu(from: string): Promise<void> {
    const user = await this.findFacilityManagerByPhone(from);

    if (!user) {
      await this.templateSenderService.sendToAgentWithTemplate(from);
    } else {
      await this.templateSenderService.sendButtons(
        from,
        `Hello Manager ${this.utilService.toSentenceCase(
          user.first_name,
        )} Welcome to Property Kraft! What would you like to do today?`,
        [
          { id: 'service_request', title: 'Service Requests' },
          { id: 'view_account_info', title: 'Account Info' },
          { id: 'visit_site', title: 'Visit Website' },
        ],
      );
    }
  }

  /**
   * Find facility manager by phone number using normalized format
   */
  private async findFacilityManagerByPhone(
    phoneNumber: string,
  ): Promise<Users | null> {
    const normalizedPhone = this.utilService.normalizePhoneNumber(phoneNumber);

    const user = await this.usersRepo.findOne({
      where: {
        phone_number: normalizedPhone,
        accounts: { role: RolesEnum.FACILITY_MANAGER },
      },
      relations: ['accounts'],
    });

    return user;
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
      case 'view_all_service_requests':
      case 'service_request':
        await this.handleViewAllServiceRequests(from);
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
            { id: 'service_request', title: 'View all requests' },
            { id: 'view_account_info', title: 'View Account Info' },
          ],
        );
        await this.cache.delete(`service_request_state_facility_${from}`);
        break;

      default:
        // Handle dynamic button IDs like "mark_resolved:requestId"
        if (buttonId.startsWith('mark_resolved:')) {
          await this.handleMarkResolved(from, buttonId);
        } else {
          await this.templateSenderService.sendText(
            from,
            '❓ Unknown option selected.',
          );
        }
    }
  }

  /**
   * Handle view all service requests button
   */
  private async handleViewAllServiceRequests(from: string): Promise<void> {
    this.logger.log('✅ Matched view_all_service_requests or service_request');

    const teamMemberInfo = await this.findTeamMemberByPhone(from);

    if (!teamMemberInfo) {
      await this.templateSenderService.sendText(
        from,
        'No team info available.',
      );
      return;
    }

    const serviceRequests = await this.serviceRequestRepo.find({
      where: {
        property: {
          owner_id: teamMemberInfo.team.creatorId,
        },
        status: Not(ServiceRequestStatusEnum.CLOSED),
      },
      relations: ['tenant', 'tenant.user', 'property'],
    });

    if (!serviceRequests.length) {
      await this.templateSenderService.sendText(
        from,
        'No service requests found.',
      );
      return;
    }

    let response = 'Here are all service requests:\n\n';
    serviceRequests.forEach((req, i) => {
      response += `${i + 1}. ${req.description} (${req.property.name})\n\n`;
    });

    response += 'Reply with a number to view details.';

    await this.templateSenderService.sendText(from, response);

    await this.cache.set(
      `service_request_state_facility_${from}`,
      `view_request_list:${JSON.stringify(serviceRequests.map((r) => r.id))}`,
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
          teamMemberAccountInfo.account.role,
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

    const serviceRequest = await this.serviceRequestRepo.findOne({
      where: { id: requestId },
      relations: ['tenant', 'tenant.user', 'facilityManager'],
    });

    if (!serviceRequest) {
      await this.templateSenderService.sendText(
        from,
        "I couldn't find that request.",
      );
      await this.cache.delete(`service_request_state_facility_${from}`);
      return;
    }

    if (serviceRequest.status === ServiceRequestStatusEnum.CLOSED) {
      await this.templateSenderService.sendText(
        from,
        'This request has already been closed.',
      );
      await this.cache.delete(`service_request_state_facility_${from}`);
      return;
    }

    // Get facility manager info
    const facilityManager = await this.findTeamMemberByPhone(from);

    await this.serviceRequestService.updateStatus(
      serviceRequest.id,
      ServiceRequestStatusEnum.RESOLVED,
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

    // Trigger Tenant Confirmation
    this.logger.log(
      'Sending tenant confirmation to:',
      serviceRequest.tenant.user.phone_number,
    );

    try {
      await this.templateSenderService.sendTenantConfirmationTemplate({
        phone_number: this.utilService.normalizePhoneNumber(
          serviceRequest.tenant.user.phone_number,
        ),
        tenant_name: this.utilService.toSentenceCase(
          serviceRequest.tenant.user.first_name,
        ),
        request_description: serviceRequest.description,
        request_id: serviceRequest.request_id,
      });
      this.logger.log('Tenant confirmation sent successfully');
    } catch (error) {
      this.logger.error('Failed to send tenant confirmation:', error);
    }

    await this.cache.delete(`service_request_state_facility_${from}`);
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

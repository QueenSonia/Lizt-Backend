import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, Not } from 'typeorm';

import { Users } from 'src/users/entities/user.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { CacheService } from 'src/lib/cache';
import { UtilService } from 'src/utils/utility-service';
import { RolesEnum } from 'src/base.entity';
import { ServiceRequestStatusEnum } from 'src/service-requests/dto/create-service-request.dto';
import { TenantStatusEnum } from 'src/properties/dto/create-property.dto';
import { ServiceRequestsService } from 'src/service-requests/service-requests.service';
import {
  TemplateSenderService,
  ButtonDefinition,
  FacilityServiceRequestParams,
} from '../template-sender';
import { IncomingMessage } from '../utils';

/**
 * TenantFlowService handles all tenant-specific WhatsApp message interactions.
 * This service is extracted from WhatsappBotService to centralize tenant flow management.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.6
 */
@Injectable()
export class TenantFlowService {
  private readonly logger = new Logger(TenantFlowService.name);

  // Session timeout in milliseconds (5 minutes)
  private readonly SESSION_TIMEOUT_MS = 5 * 60 * 1000;

  // Main menu buttons for tenant
  private readonly MAIN_MENU_BUTTONS: ButtonDefinition[] = [
    { id: 'service_request', title: 'Service request' },
    { id: 'view_tenancy', title: 'View tenancy details' },
    { id: 'visit_site', title: 'Visit our website' },
  ];

  constructor(
    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,

    @InjectRepository(ServiceRequest)
    private readonly serviceRequestRepo: Repository<ServiceRequest>,

    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepo: Repository<PropertyTenant>,

    private readonly cache: CacheService,
    private readonly utilService: UtilService,
    private readonly serviceRequestService: ServiceRequestsService,
    private readonly templateSenderService: TemplateSenderService,
  ) {}

  /**
   * Handle text messages from tenants
   * Requirements: 2.1
   */
  async handleText(message: IncomingMessage, from: string): Promise<void> {
    const text = message.text?.body;

    if (!text) {
      return;
    }

    const lowerText = text.toLowerCase();

    // Handle "switch role" command for multi-role users
    if (lowerText === 'switch role' || lowerText === 'switch') {
      await this.cache.delete(`selected_role_${from}`);
      await this.templateSenderService.sendText(
        from,
        'Role cleared. Send any message to select a new role.',
      );
      return;
    }

    if (lowerText === 'menu') {
      await this.templateSenderService.sendButtons(
        from,
        'Menu Options',
        this.MAIN_MENU_BUTTONS,
        'Tap on any option to continue.',
      );
      return;
    }

    if (lowerText === 'done') {
      await this.cache.delete(`service_request_state_${from}`);
      await this.templateSenderService.sendText(
        from,
        'Thank you!  Your session has ended.',
      );
      return;
    }

    // Handle redis cache
    await this.cachedResponse(from, text);
  }

  /**
   * Handle cached response for tenant session state
   * Requirements: 2.3
   */
  async cachedResponse(from: string, text: string): Promise<void> {
    const userState = await this.cache.get(`service_request_state_${from}`);

    // Handle property selection for multi-property tenants
    if (userState && userState.startsWith('select_property:')) {
      await this.handlePropertySelection(from, text, userState);
      return;
    }

    if (
      userState === 'awaiting_description' ||
      userState?.startsWith('awaiting_description:')
    ) {
      await this.handleServiceRequestDescription(from, text, userState);
      return;
    }

    if (userState === 'view_single_service_request') {
      await this.handleViewSingleServiceRequest(from, text);
      return;
    }

    // Default: show tenant menu
    await this.showTenantMenu(from);
  }

  /**
   * Handle property selection for multi-property tenants
   */
  private async handlePropertySelection(
    from: string,
    text: string,
    userState: string,
  ): Promise<void> {
    const propertyIds = JSON.parse(userState.split('select_property:')[1]);
    const selectedIndex = parseInt(text.trim()) - 1;

    if (
      isNaN(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= propertyIds.length
    ) {
      await this.templateSenderService.sendText(
        from,
        'Invalid selection. Please reply with a valid number.',
      );
      return;
    }

    const selectedPropertyId = propertyIds[selectedIndex];

    // Store selected property and move to awaiting description
    await this.cache.set(
      `service_request_state_${from}`,
      `awaiting_description:${selectedPropertyId}`,
      this.SESSION_TIMEOUT_MS,
    );

    await this.templateSenderService.sendText(
      from,
      'Sure! Please tell me what needs to be fixed.',
    );
  }

  /**
   * Handle service request description submission
   */
  private async handleServiceRequestDescription(
    from: string,
    text: string,
    userState: string,
  ): Promise<void> {
    // Extract property_id if it was stored
    let selectedPropertyId: string | undefined = undefined;
    if (userState.startsWith('awaiting_description:')) {
      selectedPropertyId = userState.split('awaiting_description:')[1];
    }

    const user = await this.findTenantByPhone(from);

    if (!user?.accounts?.length) {
      await this.templateSenderService.sendText(
        from,
        'We could not find your tenancy information.',
      );
      await this.cache.delete(`service_request_state_${from}`);
      return;
    }

    try {
      const new_service_request =
        await this.serviceRequestService.createServiceRequest({
          tenant_id: user.accounts[0].id,
          property_id: selectedPropertyId,
          text,
        });

      if (new_service_request) {
        const {
          created_at,
          facility_managers,
          property_name,
          property_location,
          property_id,
        } = new_service_request;

        await this.templateSenderService.sendText(
          from,
          "Got it. I've noted your request — someone will take a look and reach out once it's being handled.",
        );

        // Send navigation options after completing request
        await this.templateSenderService.sendButtons(
          from,
          'Want to do something else?',
          [
            { id: 'new_service_request', title: 'Request a service' },
            { id: 'main_menu', title: 'Go back to main menu' },
          ],
        );

        await this.cache.delete(`service_request_state_${from}`);

        // Send notifications to facility managers
        await this.notifyFacilityManagers(
          facility_managers,
          user,
          property_name,
          property_location,
          text,
          created_at,
        );

        // Send notification to landlord
        await this.notifyLandlord(
          property_id,
          user,
          property_name,
          property_location,
          text,
          created_at,
        );
      }
      await this.cache.delete(`service_request_state_${from}`);
    } catch (error) {
      await this.templateSenderService.sendText(
        from,
        (error as Error).message ||
          'An error occurred while logging your request.',
      );
      await this.cache.delete(`service_request_state_${from}`);
    }
  }

  /**
   * Notify facility managers about a new service request
   */
  private async notifyFacilityManagers(
    facilityManagers: Array<{ phone_number: string; name: string }>,
    user: Users,
    propertyName: string,
    propertyLocation: string,
    serviceRequest: string,
    createdAt: Date,
  ): Promise<void> {
    // Convert tenant phone to local format (e.g., 09016469693)
    const tenantLocalPhone = user.phone_number.startsWith('234')
      ? '0' + user.phone_number.slice(3)
      : user.phone_number.replace(/^\+234/, '0');

    for (const manager of facilityManagers) {
      const params: FacilityServiceRequestParams = {
        phone_number: manager.phone_number,
        manager_name: manager.name,
        property_name: propertyName,
        property_location: propertyLocation,
        service_request: serviceRequest,
        tenant_name: `${this.utilService.toSentenceCase(
          user.first_name,
        )} ${this.utilService.toSentenceCase(user.last_name)}`,
        tenant_phone_number: tenantLocalPhone,
        date_created: new Date(createdAt).toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Africa/Lagos',
        }),
        is_landlord: false,
      };

      await this.templateSenderService.sendFacilityServiceRequest(params);

      // Add delay (e.g., 2 seconds)
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  /**
   * Notify landlord about a new service request
   */
  private async notifyLandlord(
    propertyId: string,
    user: Users,
    propertyName: string,
    propertyLocation: string,
    serviceRequest: string,
    createdAt: Date,
  ): Promise<void> {
    const propertyTenant = await this.propertyTenantRepo.findOne({
      where: {
        property_id: propertyId,
      },
      relations: ['property', 'property.owner', 'property.owner.user'],
    });

    if (propertyTenant) {
      const adminPhoneNumber = this.utilService.normalizePhoneNumber(
        propertyTenant?.property.owner.user.phone_number,
      );

      // Convert tenant phone to local format
      const tenantLocalPhone = user.phone_number.startsWith('234')
        ? '0' + user.phone_number.slice(3)
        : user.phone_number.replace(/^\+234/, '0');

      const params: FacilityServiceRequestParams = {
        phone_number: adminPhoneNumber,
        manager_name: this.utilService.toSentenceCase(
          propertyTenant.property.owner.user.first_name,
        ),
        property_name: propertyName,
        property_location: propertyLocation,
        service_request: serviceRequest,
        tenant_name: `${this.utilService.toSentenceCase(
          user.first_name,
        )} ${this.utilService.toSentenceCase(user.last_name)}`,
        tenant_phone_number: tenantLocalPhone,
        date_created: new Date(createdAt).toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Africa/Lagos',
        }),
        is_landlord: true,
      };

      await this.templateSenderService.sendFacilityServiceRequest(params);
    }
  }

  /**
   * Handle viewing a single service request
   */
  private async handleViewSingleServiceRequest(
    from: string,
    text: string,
  ): Promise<void> {
    const normalizedPhone = this.utilService.normalizePhoneNumber(from);

    const serviceRequests = await this.serviceRequestRepo.find({
      where: {
        tenant: { user: { phone_number: normalizedPhone } },
        description: ILike(`%${text}%`),
      },
      relations: ['tenant'],
    });

    if (!serviceRequests.length) {
      await this.templateSenderService.sendText(
        from,
        'No service requests found matching that description.',
      );
      await this.cache.delete(`service_request_state_${from}`);
      return;
    }

    let response = 'Here are the matching service requests:\n';
    serviceRequests.forEach((req) => {
      const createdDate = req.created_at
        ? new Date(req.created_at).toLocaleDateString()
        : 'Unknown date';
      response += `${req.description} (${createdDate}) \n Status: ${req.status}\n Notes: ${
        req.notes || '——'
      }\n\n`;
    });

    await this.templateSenderService.sendText(from, response);
    await this.cache.delete(`service_request_state_${from}`);

    await this.templateSenderService.sendButtons(from, 'back', [
      {
        id: 'service_request',
        title: 'Back to Requests',
      },
    ]);
  }

  /**
   * Show tenant menu
   */
  private async showTenantMenu(from: string): Promise<void> {
    const user = await this.findTenantByPhone(from);

    if (!user) {
      this.logger.log(
        '⚠️ Tenant not found in cachedResponse, sending agent template',
      );
      await this.templateSenderService.sendToAgentWithTemplate(from);
    } else {
      this.logger.log('✅ Sending tenant menu to:', user.first_name);
      await this.templateSenderService.sendButtons(
        from,
        `Hello ${this.utilService.toSentenceCase(
          user.first_name,
        )} What would you like to do?`,
        this.MAIN_MENU_BUTTONS,
        'Tap on any option to continue.',
      );
    }
  }

  /**
   * Handle interactive button messages from tenants
   * Requirements: 2.2
   */
  async handleInteractive(
    message: IncomingMessage,
    from: string,
  ): Promise<void> {
    const buttonReply =
      (
        message.interactive as {
          button_reply?: { id?: string; payload?: string };
        }
      )?.button_reply ||
      (message as unknown as { button?: { id?: string; payload?: string } })
        .button;
    const buttonId = buttonReply?.id || buttonReply?.payload;

    if (!buttonReply) return;
    this.logger.log(`Button ID: ${buttonId}`);

    // Handle role selection buttons
    if (
      buttonId === 'select_role_fm' ||
      buttonId === 'select_role_landlord' ||
      buttonId === 'select_role_tenant'
    ) {
      await this.handleRoleSelection(from, buttonId);
      return;
    }

    // Handle button IDs with payloads (e.g., "confirm_resolution_yes:request_id")
    let cleanButtonId = buttonId;
    if (buttonId?.includes(':')) {
      const [action] = buttonId.split(':');
      if (
        action === 'confirm_resolution_yes' ||
        action === 'confirm_resolution_no'
      ) {
        cleanButtonId = action;
      }
    }

    switch (cleanButtonId) {
      case 'visit_site':
        await this.templateSenderService.sendText(
          from,
          'Visit our website: https://propertykraft.africa',
        );
        break;

      case 'view_tenancy':
        await this.handleViewTenancy(from);
        break;

      case 'service_request':
        await this.templateSenderService.sendButtons(
          from,
          'What would you like to do?',
          [
            { id: 'new_service_request', title: 'Request a service' },
            { id: 'view_service_request', title: 'View all requests' },
          ],
        );
        break;

      case 'view_service_request':
        await this.handleViewServiceRequests(from);
        break;

      case 'new_service_request':
        await this.handleNewServiceRequest(from);
        break;

      case 'main_menu':
        await this.handleMainMenu(from);
        break;

      case 'confirm_resolution_yes':
        await this.handleConfirmResolutionYes(from);
        break;

      case 'confirm_resolution_no':
        await this.handleConfirmResolutionNo(from);
        break;

      default:
        await this.templateSenderService.sendText(
          from,
          '❓ Unknown option selected.',
        );
    }
  }

  /**
   * Handle role selection button clicks
   */
  private async handleRoleSelection(
    from: string,
    buttonId: string,
  ): Promise<void> {
    const selectedRole =
      buttonId === 'select_role_fm'
        ? RolesEnum.FACILITY_MANAGER
        : buttonId === 'select_role_landlord'
          ? RolesEnum.LANDLORD
          : RolesEnum.TENANT;

    this.logger.log('✅ User selected role:', selectedRole);

    // Store selected role in cache (valid for 24 hours)
    await this.cache.set(
      `selected_role_${from}`,
      selectedRole,
      24 * 60 * 60 * 1000,
    );

    // Route to appropriate handler based on selected role
    if (selectedRole === RolesEnum.FACILITY_MANAGER) {
      const normalizedPhone = this.utilService.normalizePhoneNumber(from);
      const user = await this.usersRepo.findOne({
        where: { phone_number: normalizedPhone },
        relations: ['accounts'],
      });

      await this.templateSenderService.sendButtons(
        from,
        `Hello Manager ${this.utilService.toSentenceCase(user?.first_name || '')} Welcome to Property Kraft! What would you like to do today?`,
        [
          { id: 'service_request', title: 'Service Requests' },
          { id: 'view_account_info', title: 'Account Info' },
          { id: 'visit_site', title: 'Visit Website' },
        ],
      );
    } else if (selectedRole === RolesEnum.LANDLORD) {
      const normalizedPhone = this.utilService.normalizePhoneNumber(from);
      const user = await this.usersRepo.findOne({
        where: { phone_number: normalizedPhone },
        relations: ['accounts'],
      });

      await this.templateSenderService.sendButtons(
        from,
        `Hello ${this.utilService.toSentenceCase(user?.first_name || '')}, What do you want to do today?`,
        [
          { id: 'view_properties', title: 'View properties' },
          { id: 'view_maintenance', title: 'Maintenance requests' },
          { id: 'generate_kyc_link', title: 'Generate KYC link' },
        ],
      );
    } else {
      const normalizedPhone = this.utilService.normalizePhoneNumber(from);
      const user = await this.usersRepo.findOne({
        where: { phone_number: normalizedPhone },
        relations: ['accounts'],
      });

      await this.templateSenderService.sendButtons(
        from,
        `Hello ${this.utilService.toSentenceCase(
          user?.first_name || '',
        )} What would you like to do?`,
        this.MAIN_MENU_BUTTONS,
        'Tap on any option to continue.',
      );
    }
  }

  /**
   * Handle view tenancy button
   */
  private async handleViewTenancy(from: string): Promise<void> {
    const user = await this.findTenantByPhone(from);

    this.logger.log('👤 User lookup result:', {
      found: !!user,
      userId: user?.id,
      accountsCount: user?.accounts?.length || 0,
    });

    if (!user?.accounts?.length) {
      this.logger.log('❌ No user found with tenant account for phone:', from);
      await this.templateSenderService.sendText(
        from,
        'No tenancy info available.',
      );
      return;
    }

    const accountId = user.accounts[0].id;
    this.logger.log('🏠 Looking for properties for account:', accountId);

    const properties = await this.propertyTenantRepo.find({
      where: { tenant_id: accountId },
      relations: ['property', 'property.rents'],
    });

    this.logger.log('🏠 Properties found:', {
      count: properties?.length || 0,
    });

    if (!properties?.length) {
      this.logger.log('⚠️ No properties found for tenant account:', accountId);
      await this.templateSenderService.sendText(from, 'No properties found.');
      return;
    }

    for (const item of properties) {
      // Check if rent data exists
      if (!item.property?.rents?.length) {
        this.logger.log(
          '⚠️ No rent data found for property:',
          item.property?.name,
        );
        await this.templateSenderService.sendText(
          from,
          `Property ${item.property?.name || 'Unknown'} found, but no rent details available. Please contact support.`,
        );
        continue;
      }

      const rent = item.property.rents[0];

      // Validate rent data
      if (!rent.rent_start_date || !rent.expiry_date || !rent.rental_price) {
        this.logger.log(
          '⚠️ Incomplete rent data for property:',
          item.property?.name,
        );
        await this.templateSenderService.sendText(
          from,
          `Property ${item.property?.name || 'Unknown'} found, but rent details are incomplete. Please contact support.`,
        );
        continue;
      }

      const startDate = new Date(rent.rent_start_date).toLocaleDateString(
        'en-GB',
        {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        },
      );
      const endDate = new Date(rent.expiry_date).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });

      await this.templateSenderService.sendText(
        from,
        `Here are your tenancy details for ${item.property.name}:\n• Rent: ${rent.rental_price.toLocaleString(
          'en-NG',
          {
            style: 'currency',
            currency: 'NGN',
          },
        )}\n• Tenancy term: ${startDate} to ${endDate}`,
      );

      await this.cache.set(
        `service_request_state_${from}`,
        'other_options',
        this.SESSION_TIMEOUT_MS,
      );
    }

    await this.templateSenderService.sendText(
      from,
      'Type "menu" to see other options or "done" to finish.',
    );
  }

  /**
   * Handle view service requests button
   */
  private async handleViewServiceRequests(from: string): Promise<void> {
    const normalizedPhone = this.utilService.normalizePhoneNumber(from);

    const serviceRequests = await this.serviceRequestRepo.find({
      where: {
        tenant: { user: { phone_number: normalizedPhone } },
        status: Not(ServiceRequestStatusEnum.CLOSED),
      },
      relations: ['tenant'],
      order: { created_at: 'DESC' },
    });

    if (!serviceRequests.length) {
      await this.templateSenderService.sendText(
        from,
        "You don't have any service requests yet.",
      );
      return;
    }

    let response = 'Here are your recent service requests:\n\n';
    serviceRequests.forEach((req) => {
      const date = req.created_at ? new Date(req.created_at) : new Date();
      const formattedDate = date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      const formattedTime = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
      response += `• ${formattedDate}, ${formattedTime} – ${req.description}\n\n`;
    });

    await this.templateSenderService.sendText(from, response);

    // Send navigation options after viewing requests
    await this.templateSenderService.sendButtons(
      from,
      'Want to do something else?',
      [
        { id: 'new_service_request', title: 'Request a service' },
        { id: 'main_menu', title: 'Go back to main menu' },
      ],
    );
  }

  /**
   * Handle new service request button
   */
  private async handleNewServiceRequest(from: string): Promise<void> {
    const user = await this.findTenantByPhone(from);

    this.logger.log('👤 User lookup result (new request):', {
      found: !!user,
      userId: user?.id,
      accountsCount: user?.accounts?.length || 0,
    });

    if (!user?.accounts?.length) {
      this.logger.log(
        '❌ No user found with tenant account for phone (new request):',
        from,
      );
      await this.templateSenderService.sendText(
        from,
        'No tenancy info available.',
      );
      return;
    }

    const accountId = user.accounts[0].id;
    const properties = await this.propertyTenantRepo.find({
      where: {
        tenant_id: accountId,
        status: TenantStatusEnum.ACTIVE,
      },
      relations: ['property'],
    });

    if (!properties?.length) {
      await this.templateSenderService.sendText(
        from,
        'No active properties found for your account.',
      );
      return;
    }

    // If tenant has multiple properties, ask them to select
    if (properties.length > 1) {
      let propertyList = 'Which property is this request for?\n\n';
      properties.forEach((pt, index) => {
        propertyList += `${index + 1}. ${pt.property.name}\n`;
      });
      propertyList += '\nReply with the number of the property.';

      await this.templateSenderService.sendText(from, propertyList);

      // Store property IDs in cache
      await this.cache.set(
        `service_request_state_${from}`,
        `select_property:${JSON.stringify(properties.map((p) => p.property_id))}`,
        this.SESSION_TIMEOUT_MS,
      );
    } else {
      // Single property - proceed directly to description
      await this.cache.set(
        `service_request_state_${from}`,
        `awaiting_description:${properties[0].property_id}`,
        this.SESSION_TIMEOUT_MS,
      );
      await this.templateSenderService.sendText(
        from,
        'Sure! Please tell me what needs to be fixed.',
      );
    }
  }

  /**
   * Handle main menu button
   */
  private async handleMainMenu(from: string): Promise<void> {
    // Clear any cached state and return to main menu
    await this.cache.delete(`service_request_state_${from}`);

    const user = await this.findTenantByPhone(from);

    if (!user) {
      await this.templateSenderService.sendToAgentWithTemplate(from);
    } else {
      await this.templateSenderService.sendButtons(
        from,
        `Hello ${this.utilService.toSentenceCase(user.first_name)} What would you like to do?`,
        this.MAIN_MENU_BUTTONS,
      );
    }
  }

  /**
   * Handle confirm resolution yes button
   */
  private async handleConfirmResolutionYes(from: string): Promise<void> {
    const normalizedPhone = this.utilService.normalizePhoneNumber(from);

    const latestResolvedRequest = await this.serviceRequestRepo.findOne({
      where: {
        tenant: { user: { phone_number: normalizedPhone } },
        status: ServiceRequestStatusEnum.RESOLVED,
      },
      relations: [
        'tenant',
        'tenant.user',
        'facilityManager',
        'facilityManager.account',
        'facilityManager.account.user',
        'property',
      ],
      order: { resolution_date: 'DESC' },
    });

    if (latestResolvedRequest) {
      await this.serviceRequestService.updateStatus(
        latestResolvedRequest.id,
        ServiceRequestStatusEnum.CLOSED,
        'Tenant confirmed issue is fully resolved via WhatsApp',
        {
          id: latestResolvedRequest.tenant.user.id,
          role: 'tenant',
          name: `${latestResolvedRequest.tenant.user.first_name} ${latestResolvedRequest.tenant.user.last_name}`,
        },
      );

      await this.templateSenderService.sendText(
        from,
        "Fantastic! Glad that's sorted 😊",
      );

      // Notify FM
      if (latestResolvedRequest.facilityManager?.account?.user?.phone_number) {
        await this.templateSenderService.sendText(
          this.utilService.normalizePhoneNumber(
            latestResolvedRequest.facilityManager.account.user.phone_number,
          ),
          `✅ Tenant confirmed the issue is fixed.\nRequest: ${latestResolvedRequest.description}\nStatus: Closed`,
        );
      }

      // Notify landlord
      const propertyTenant = await this.propertyTenantRepo.findOne({
        where: {
          property_id: latestResolvedRequest.property_id,
        },
        relations: ['property', 'property.owner', 'property.owner.user'],
      });

      if (propertyTenant?.property?.owner?.user?.phone_number) {
        await this.templateSenderService.sendText(
          this.utilService.normalizePhoneNumber(
            propertyTenant.property.owner.user.phone_number,
          ),
          `✅ Tenant confirmed the issue is fixed.\nRequest: ${latestResolvedRequest.description}\nStatus: Closed`,
        );
      }
    } else {
      await this.templateSenderService.sendText(
        from,
        "I couldn't find a pending resolution to confirm.",
      );
    }
  }

  /**
   * Handle confirm resolution no button
   */
  private async handleConfirmResolutionNo(from: string): Promise<void> {
    const normalizedPhone = this.utilService.normalizePhoneNumber(from);

    const latestResolvedRequest = await this.serviceRequestRepo.findOne({
      where: {
        tenant: { user: { phone_number: normalizedPhone } },
        status: ServiceRequestStatusEnum.RESOLVED,
      },
      relations: [
        'tenant',
        'tenant.user',
        'facilityManager',
        'facilityManager.account',
        'facilityManager.account.user',
        'property',
      ],
      order: { resolution_date: 'DESC' },
    });

    if (latestResolvedRequest) {
      await this.serviceRequestService.updateStatus(
        latestResolvedRequest.id,
        ServiceRequestStatusEnum.REOPENED,
        'Tenant reported issue is not fully resolved via WhatsApp',
        {
          id: latestResolvedRequest.tenant.user.id,
          role: 'tenant',
          name: `${latestResolvedRequest.tenant.user.first_name} ${latestResolvedRequest.tenant.user.last_name}`,
        },
      );

      await this.templateSenderService.sendText(
        from,
        "Thanks for letting me know. I'll reopen the request and notify maintenance to check again.",
      );

      // Notify FM
      if (latestResolvedRequest.facilityManager?.account?.user?.phone_number) {
        await this.templateSenderService.sendText(
          this.utilService.normalizePhoneNumber(
            latestResolvedRequest.facilityManager.account.user.phone_number,
          ),
          `⚠️ Tenant says the issue is not resolved. The request has been reopened.\nRequest: ${latestResolvedRequest.description}\nStatus: Reopened`,
        );
      }

      // Notify landlord
      const propertyTenant = await this.propertyTenantRepo.findOne({
        where: {
          property_id: latestResolvedRequest.property_id,
        },
        relations: ['property', 'property.owner', 'property.owner.user'],
      });

      if (propertyTenant?.property?.owner?.user?.phone_number) {
        await this.templateSenderService.sendText(
          this.utilService.normalizePhoneNumber(
            propertyTenant.property.owner.user.phone_number,
          ),
          `⚠️ Tenant says the issue is not resolved. The request has been reopened.\nRequest: ${latestResolvedRequest.description}\nStatus: Reopened`,
        );
      }
    } else {
      await this.templateSenderService.sendText(
        from,
        "I couldn't find a pending resolution to confirm.",
      );
    }
  }

  /**
   * Find tenant by phone number using normalized format
   */
  private async findTenantByPhone(phoneNumber: string): Promise<Users | null> {
    const normalizedPhone = this.utilService.normalizePhoneNumber(phoneNumber);

    const user = await this.usersRepo.findOne({
      where: {
        phone_number: normalizedPhone,
        accounts: { role: RolesEnum.TENANT },
      },
      relations: ['accounts'],
    });

    return user;
  }
}

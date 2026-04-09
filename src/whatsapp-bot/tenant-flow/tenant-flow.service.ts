import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, Not, In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { Users } from 'src/users/entities/user.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Property } from 'src/properties/entities/property.entity';
import { Rent } from 'src/rents/entities/rent.entity';
import { RentStatusEnum } from 'src/rents/dto/create-rent.dto';
import {
  RenewalInvoice,
  RenewalPaymentStatus,
} from 'src/tenancies/entities/renewal-invoice.entity';
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
import { WhatsAppNotificationLogService } from '../whatsapp-notification-log.service';
import { TenantBalancesService } from 'src/tenant-balances/tenant-balances.service';

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
    { id: 'payment', title: 'Payment' },
  ];

  constructor(
    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,

    @InjectRepository(ServiceRequest)
    private readonly serviceRequestRepo: Repository<ServiceRequest>,

    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepo: Repository<PropertyTenant>,

    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,

    @InjectRepository(Rent)
    private readonly rentRepo: Repository<Rent>,

    @InjectRepository(RenewalInvoice)
    private readonly renewalInvoiceRepo: Repository<RenewalInvoice>,

    private readonly cache: CacheService,
    private readonly utilService: UtilService,
    private readonly serviceRequestService: ServiceRequestsService,
    private readonly templateSenderService: TemplateSenderService,
    private readonly notificationLogService: WhatsAppNotificationLogService,
    private readonly tenantBalancesService: TenantBalancesService,
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

    // Handle property selection for tenancy details
    const tenancyDetailsSelection = await this.cache.get(
      `tenancy_details_selection_${from}`,
    );
    if (tenancyDetailsSelection) {
      await this.handleTenancyDetailsPropertySelection(
        from,
        text,
        tenancyDetailsSelection,
      );
      return;
    }

    // Handle property selection for multi-property tenants
    if (userState && userState.startsWith('select_property:')) {
      await this.handlePropertySelection(from, text, userState);
      return;
    }

    // Handle property selection for OB payment
    if (userState && userState.startsWith('select_property_ob:')) {
      await this.handlePropertySelectionForOB(from, text, userState);
      return;
    }

    // Handle property selection for rent payment
    if (userState && userState.startsWith('select_property_rent:')) {
      await this.handlePropertySelectionForRent(from, text, userState);
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
  /**
   * Handle property selection for tenancy details confirmation
   */
  private async handleTenancyDetailsPropertySelection(
    from: string,
    text: string,
    cachedPropertyIds: string,
  ): Promise<void> {
    const propertyIds = JSON.parse(cachedPropertyIds);
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

    // Clear the cache
    await this.cache.delete(`tenancy_details_selection_${from}`);

    const user = await this.findTenantByPhone(from);
    if (!user?.accounts?.length) {
      await this.templateSenderService.sendText(
        from,
        'No tenancy info available.',
      );
      return;
    }

    const accountId = user.accounts[0].id;
    const selectedPropertyId = propertyIds[selectedIndex];

    // Find the specific property tenant record
    const propertyTenant = await this.propertyTenantRepo.findOne({
      where: {
        tenant_id: accountId,
        property_id: selectedPropertyId,
        status: TenantStatusEnum.ACTIVE,
      },
      relations: ['property'],
    });

    if (!propertyTenant) {
      await this.templateSenderService.sendText(
        from,
        'Property tenancy not found. Please contact your landlord.',
      );
      return;
    }

    // Show details for the selected property
    await this.showTenancyDetailsForProperty(from, accountId, propertyTenant);
  }

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

    // Fix #20: Prevent duplicate submissions within a short window
    const dedupeKey = `service_request_dedup_${from}`;
    const existingSubmission = await this.cache.get(dedupeKey);
    if (existingSubmission) {
      await this.templateSenderService.sendText(
        from,
        'Your request was already submitted. Please wait a moment.',
      );
      return;
    }
    // Set a 30-second dedup window
    await this.cache.set(dedupeKey, '1', 30 * 1000);

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

        // Fix #11: Notifications are queued independently — failures don't affect the tenant
        try {
          await this.queueFacilityManagerNotifications(
            facility_managers,
            user,
            property_name,
            property_location,
            text,
            created_at,
            new_service_request.id,
          );
        } catch (err) {
          this.logger.error('Failed to queue FM notifications:', err);
        }

        try {
          await this.queueLandlordNotification(
            property_id,
            user,
            property_name,
            property_location,
            text,
            created_at,
            new_service_request.id,
          );
        } catch (err) {
          this.logger.error('Failed to queue landlord notification:', err);
        }
      }
      await this.cache.delete(`service_request_state_${from}`);
    } catch (error) {
      // Fix #10: Never expose raw error messages to tenants
      this.logger.error(
        'Service request creation failed:',
        (error as Error).message,
      );
      await this.templateSenderService.sendText(
        from,
        'Sorry, we could not log your request right now. Please try again shortly.',
      );
      await this.cache.delete(`service_request_state_${from}`);
      await this.cache.delete(dedupeKey);
    }
  }

  /**
   * Queue WhatsApp notifications for all facility managers via the notification log service.
   * Notifications are persisted and retried automatically on failure.
   */
  private async queueFacilityManagerNotifications(
    facilityManagers: Array<{ phone_number: string; name: string }>,
    user: Users,
    propertyName: string,
    propertyLocation: string,
    serviceRequest: string,
    createdAt: Date,
    serviceRequestId?: string,
  ): Promise<void> {
    if (!facilityManagers?.length) return;

    const tenantLocalPhone = this.toLocalPhone(user.phone_number);
    const tenantName = `${this.utilService.toSentenceCase(user.first_name)} ${this.utilService.toSentenceCase(user.last_name)}`;
    const formattedDate = this.formatDateLagos(createdAt);

    for (const manager of facilityManagers) {
      const params: FacilityServiceRequestParams = {
        phone_number: manager.phone_number,
        manager_name: manager.name,
        property_name: propertyName,
        property_location: propertyLocation,
        service_request: serviceRequest,
        tenant_name: tenantName,
        tenant_phone_number: tenantLocalPhone,
        date_created: formattedDate,
        is_landlord: false,
      };

      await this.notificationLogService.queue(
        'sendFacilityServiceRequest',
        params,
        serviceRequestId,
      );
    }
  }

  /**
   * Queue WhatsApp notification for the landlord via the notification log service.
   * Fix #4: Queries Property directly instead of going through PropertyTenant.
   * Fix #12: Full null-safety on the owner chain.
   */
  private async queueLandlordNotification(
    propertyId: string,
    user: Users,
    propertyName: string,
    propertyLocation: string,
    serviceRequest: string,
    createdAt: Date,
    serviceRequestId?: string,
  ): Promise<void> {
    const property = await this.propertyRepo.findOne({
      where: { id: propertyId },
      relations: ['owner', 'owner.user'],
    });

    if (!property?.owner?.user?.phone_number) {
      this.logger.warn(
        `Cannot notify landlord: owner data missing for property ${propertyId}`,
      );
      return;
    }

    const adminPhoneNumber = this.utilService.normalizePhoneNumber(
      property.owner.user.phone_number,
    );

    const tenantLocalPhone = this.toLocalPhone(user.phone_number);

    const params: FacilityServiceRequestParams = {
      phone_number: adminPhoneNumber,
      manager_name: this.utilService.toSentenceCase(
        property.owner.user.first_name,
      ),
      property_name: propertyName,
      property_location: propertyLocation,
      service_request: serviceRequest,
      tenant_name: `${this.utilService.toSentenceCase(user.first_name)} ${this.utilService.toSentenceCase(user.last_name)}`,
      tenant_phone_number: tenantLocalPhone,
      date_created: this.formatDateLagos(createdAt),
      is_landlord: true,
    };

    await this.notificationLogService.queue(
      'sendFacilityServiceRequest',
      params,
      serviceRequestId,
    );
  }

  /** Convert a phone number to Nigerian local format (0xxx) */
  private toLocalPhone(phone: string): string {
    if (phone.startsWith('234')) return '0' + phone.slice(3);
    return phone.replace(/^\+234/, '0');
  }

  /** Format a date in Africa/Lagos timezone */
  private formatDateLagos(date: Date): string {
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Africa/Lagos',
    });
  }

  /**
   * Handle viewing a single service request
   */
  private async handleViewSingleServiceRequest(
    from: string,
    text: string,
  ): Promise<void> {
    const normalizedPhone = this.utilService.normalizePhoneNumber(from);

    // Fix #18: Escape LIKE special characters to prevent pattern injection
    const escapedText = text.replace(/[%_]/g, '\\$&');
    const serviceRequests = await this.serviceRequestRepo.find({
      where: {
        tenant: { user: { phone_number: normalizedPhone } },
        description: ILike(`%${escapedText}%`),
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
    let propertyId: string | null = null;

    if (buttonId?.includes(':')) {
      const [action, payload] = buttonId.split(':');
      if (
        action === 'confirm_resolution_yes' ||
        action === 'confirm_resolution_no'
      ) {
        cleanButtonId = action;
      }
      if (action === 'confirm_pay_ob') {
        await this.handleConfirmPayOB(from, payload);
        return;
      }
      if (action === 'confirm_pay_rent') {
        await this.handleConfirmPayRent(from, payload);
        return;
      }
      if (action === 'confirm_tenancy_details') {
        cleanButtonId = action;
        propertyId = payload; // Extract the property ID
      }
    }

    switch (cleanButtonId) {
      case 'visit_site':
        await this.templateSenderService.sendText(
          from,
          'Visit our website: https://propertykraft.africa',
        );
        break;

      case 'payment':
        await this.handlePaymentMenu(from);
        break;

      case 'pay_outstanding_balance':
        await this.handlePayOutstandingBalance(from);
        break;

      case 'pay_rent':
        await this.handlePayRent(from);
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

      case 'cancel_payment':
        await this.templateSenderService.sendText(from, 'Payment cancelled.');
        break;

      case 'confirm_tenancy_details':
        console.log(
          '🏠 Processing confirm_tenancy_details with property ID:',
          propertyId,
        );
        if (propertyId) {
          await this.handleConfirmTenancyDetails(from, propertyId);
        } else {
          console.log('❌ No property ID provided for confirm_tenancy_details');
          await this.templateSenderService.sendText(
            from,
            'Unable to retrieve property information. Please contact your landlord.',
          );
        }
        break;

      case 'tenancy_details_correct':
        await this.handleTenancyDetailsCorrect(from);
        break;

      case 'tenancy_details_incorrect':
        await this.handleTenancyDetailsIncorrect(from);
        break;

      default:
        await this.templateSenderService.sendText(
          from,
          'Unknown option selected.',
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

    const tenantAccount = user.accounts.find(
      (a) => a.role === RolesEnum.TENANT,
    );

    if (!tenantAccount) {
      this.logger.error('No tenant account found for user');
      return;
    }

    const accountId = tenantAccount.id;
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
      // Filter to this tenant's active rent only
      const tenantRents = item.property?.rents?.filter(
        (r) =>
          r.tenant_id === accountId && r.rent_status === RentStatusEnum.ACTIVE,
      );

      // Check if rent data exists
      if (!tenantRents?.length) {
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

      const rent = tenantRents[tenantRents.length - 1];

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
      relations: ['tenant', 'tenant.user', 'property'],
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

      const statusMessage = `✅ Tenant confirmed the issue is fixed.\nRequest: ${latestResolvedRequest.description}\nStatus: Closed`;
      await this.notifyPropertyStakeholders(
        latestResolvedRequest.property_id,
        statusMessage,
      );
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
      relations: ['tenant', 'tenant.user', 'property'],
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

      const statusMessage = `⚠️ Tenant says the issue is not resolved. The request has been reopened.\nRequest: ${latestResolvedRequest.description}\nStatus: Reopened`;
      await this.notifyPropertyStakeholders(
        latestResolvedRequest.property_id,
        statusMessage,
      );
    } else {
      await this.templateSenderService.sendText(
        from,
        "I couldn't find a pending resolution to confirm.",
      );
    }
  }

  /**
   * Notify all facility managers and the landlord for a given property with a text message.
   * Fix #2: All FMs are notified (no single assignment).
   * Fix #4: Queries Property directly for landlord info.
   */
  private async notifyPropertyStakeholders(
    propertyId: string,
    message: string,
  ): Promise<void> {
    try {
      const property = await this.propertyRepo.findOne({
        where: { id: propertyId },
        relations: ['owner', 'owner.user'],
      });

      if (!property) return;

      // Notify landlord
      if (property.owner?.user?.phone_number) {
        await this.templateSenderService.sendText(
          this.utilService.normalizePhoneNumber(
            property.owner.user.phone_number,
          ),
          message,
        );
      }

      // Notify all FMs for this landlord's team
      const fms = await this.serviceRequestService.findFacilityManagersForOwner(
        property.owner_id,
      );
      for (const fm of fms) {
        if (fm.account?.user?.phone_number) {
          await this.templateSenderService.sendText(
            this.utilService.normalizePhoneNumber(fm.account.user.phone_number),
            message,
          );
        }
      }
    } catch (error) {
      this.logger.error('Failed to notify property stakeholders:', error);
    }
  }

  // ========================
  // PAYMENT FLOW METHODS
  // ========================

  /**
   * Show payment sub-menu to tenant.
   * If tenant has outstanding balance, only show "Pay Outstanding Balance" to prioritize clearing it.
   * Otherwise show only "Pay Rent".
   */
  private async handlePaymentMenu(from: string): Promise<void> {
    const user = await this.findTenantByPhone(from);

    if (!user?.accounts?.length) {
      await this.templateSenderService.sendText(
        from,
        'No tenancy info available.',
      );
      return;
    }

    const accountId = user.accounts[0].id;

    // Check if tenant has any active rent
    const activeRents = await this.rentRepo.find({
      where: {
        tenant_id: accountId,
        rent_status: RentStatusEnum.ACTIVE,
      },
      relations: ['property'],
    });

    if (!activeRents.length) {
      await this.templateSenderService.sendText(
        from,
        'No active tenancy found.',
      );
      return;
    }

    // Check outstanding balance via TenantBalance for each unique landlord
    let hasOutstandingBalance = false;
    for (const r of activeRents) {
      if (!r.property?.owner_id) continue;
      const ob = await this.tenantBalancesService.getBalance(
        accountId,
        r.property.owner_id,
      );
      if (ob < 0) {
        hasOutstandingBalance = true;
        break;
      }
    }

    if (hasOutstandingBalance) {
      await this.handlePayOutstandingBalance(from);
    } else {
      await this.handlePayRent(from);
    }
  }

  /**
   * Handle "Pay Outstanding Balance" — creates a tenant-generated OB-only invoice.
   * No landlord approval needed.
   */
  private async handlePayOutstandingBalance(from: string): Promise<void> {
    const user = await this.findTenantByPhone(from);

    if (!user?.accounts?.length) {
      await this.templateSenderService.sendText(
        from,
        'No tenancy info available.',
      );
      return;
    }

    const accountId = user.accounts[0].id;

    // Get active rents to find landlords
    const activeRents = await this.rentRepo.find({
      where: { tenant_id: accountId, rent_status: RentStatusEnum.ACTIVE },
      relations: ['property'],
    });

    // Get OB for each unique landlord (use first active rent per landlord as representative)
    const landlordToRent = new Map<string, Rent>();
    for (const r of activeRents) {
      if (r.property?.owner_id && !landlordToRent.has(r.property.owner_id)) {
        landlordToRent.set(r.property.owner_id, r);
      }
    }

    const filtered: Array<{ rent: Rent; ob: number }> = [];
    for (const [landlordId, rent] of landlordToRent.entries()) {
      const walletBal = await this.tenantBalancesService.getBalance(
        accountId,
        landlordId,
      );
      const ob = walletBal < 0 ? -walletBal : 0;
      if (ob > 0) filtered.push({ rent, ob });
    }

    if (!filtered.length) {
      await this.templateSenderService.sendText(
        from,
        'You have no outstanding balance.',
      );
      return;
    }

    if (filtered.length > 1) {
      // Multi-landlord: ask tenant to select
      let propertyList = 'Which property is this payment for?\n\n';
      filtered.forEach(({ rent, ob }, index) => {
        const obFormatted = ob.toLocaleString('en-NG', {
          style: 'currency',
          currency: 'NGN',
        });
        propertyList += `${index + 1}. ${rent.property.name} — ${obFormatted}\n`;
      });
      propertyList += '\nReply with the number of the property.';

      await this.templateSenderService.sendText(from, propertyList);
      await this.cache.set(
        `service_request_state_${from}`,
        `select_property_ob:${JSON.stringify(filtered.map(({ rent }) => rent.property_id))}`,
        this.SESSION_TIMEOUT_MS,
      );
    } else {
      await this.sendOBConfirmation(from, filtered[0].rent, filtered[0].ob);
    }
  }

  /**
   * Handle property selection for OB payment (multi-property tenant)
   */
  private async handlePropertySelectionForOB(
    from: string,
    text: string,
    userState: string,
  ): Promise<void> {
    const propertyIds = JSON.parse(userState.split('select_property_ob:')[1]);
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

    await this.cache.delete(`service_request_state_${from}`);

    const user = await this.findTenantByPhone(from);
    if (!user?.accounts?.length) return;

    const accountId = user.accounts[0].id;

    const rent = await this.rentRepo.findOne({
      where: {
        property_id: propertyIds[selectedIndex],
        tenant_id: accountId,
        rent_status: RentStatusEnum.ACTIVE,
      },
      relations: ['property'],
    });

    if (!rent?.property?.owner_id) {
      await this.templateSenderService.sendText(
        from,
        'No outstanding balance found for that property.',
      );
      return;
    }

    const ob = await this.tenantBalancesService.getBalance(
      accountId,
      rent.property.owner_id,
    );

    if (ob >= 0) {
      await this.templateSenderService.sendText(
        from,
        'No outstanding balance found for that property.',
      );
      return;
    }

    await this.sendOBConfirmation(from, rent, -ob);
  }

  /**
   * Send OB payment confirmation message with details before generating the link.
   */
  private async sendOBConfirmation(
    from: string,
    rent: Rent,
    ob: number,
  ): Promise<void> {
    const formatNGN = (amt: number) =>
      amt.toLocaleString('en-NG', { style: 'currency', currency: 'NGN' });

    let message = `Do you want to pay the outstanding balance for *${rent.property.name}*?\n`;
    message += `\n*Outstanding Balance:* ${formatNGN(ob)}`;

    await this.templateSenderService.sendButtons(from, message, [
      { id: `confirm_pay_ob:${rent.property_id}`, title: 'Yes, pay now' },
      { id: 'cancel_payment', title: 'Cancel' },
    ]);
  }

  /**
   * Handle confirmed OB payment button click.
   */
  private async handleConfirmPayOB(
    from: string,
    propertyId: string,
  ): Promise<void> {
    const user = await this.findTenantByPhone(from);
    if (!user?.accounts?.length) return;

    const accountId = user.accounts[0].id;

    const rent = await this.rentRepo.findOne({
      where: {
        property_id: propertyId,
        tenant_id: accountId,
        rent_status: RentStatusEnum.ACTIVE,
      },
      relations: ['property'],
    });

    if (!rent?.property?.owner_id) {
      await this.templateSenderService.sendText(
        from,
        'No outstanding balance found for that property.',
      );
      return;
    }

    const totalOBWallet = await this.tenantBalancesService.getBalance(
      accountId,
      rent.property.owner_id,
    );

    if (totalOBWallet >= 0) {
      await this.templateSenderService.sendText(
        from,
        'No outstanding balance found for that property.',
      );
      return;
    }

    await this.createOBInvoiceAndSendLink(from, rent, -totalOBWallet);
  }

  /**
   * Create an OB-only invoice and send the payment link to the tenant.
   */
  private async createOBInvoiceAndSendLink(
    from: string,
    rent: Rent,
    outstandingBalance: number,
  ): Promise<void> {
    const user = await this.findTenantByPhone(from);
    if (!user?.accounts?.length) return;

    const accountId = user.accounts[0].id;

    // Find propertyTenant record
    const propertyTenant = await this.propertyTenantRepo.findOne({
      where: {
        property_id: rent.property_id,
        tenant_id: accountId,
        status: TenantStatusEnum.ACTIVE,
      },
    });

    if (!propertyTenant) {
      await this.templateSenderService.sendText(
        from,
        'Could not find your tenancy record. Please contact your landlord.',
      );
      return;
    }

    // Create OB-only invoice
    const token = uuidv4();

    const invoice = this.renewalInvoiceRepo.create({
      token,
      property_tenant_id: propertyTenant.id,
      property_id: rent.property_id,
      tenant_id: accountId,
      start_date: rent.expiry_date || new Date(),
      end_date: rent.expiry_date || new Date(),
      rent_amount: 0,
      service_charge: 0,
      legal_fee: 0,
      other_charges: 0,
      total_amount: outstandingBalance,
      outstanding_balance: outstandingBalance,
      token_type: 'tenant',
      payment_status: RenewalPaymentStatus.UNPAID,
      payment_frequency: rent.payment_frequency,
    });

    await this.renewalInvoiceRepo.save(invoice);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const tenantName = `${this.utilService.toSentenceCase(user.first_name)}`;

    await this.templateSenderService.sendOutstandingBalanceLink({
      phone_number: from,
      tenant_name: tenantName,
      renewal_token: token,
      frontend_url: frontendUrl,
    });
  }

  /**
   * Handle "Pay Rent" — creates a tenant-generated rent invoice that needs landlord approval.
   */
  private async handlePayRent(from: string): Promise<void> {
    const user = await this.findTenantByPhone(from);

    if (!user?.accounts?.length) {
      await this.templateSenderService.sendText(
        from,
        'No tenancy info available.',
      );
      return;
    }

    const accountId = user.accounts[0].id;

    const activeRents = await this.rentRepo.find({
      where: {
        tenant_id: accountId,
        rent_status: RentStatusEnum.ACTIVE,
      },
      relations: ['property'],
    });

    if (!activeRents.length) {
      await this.templateSenderService.sendText(
        from,
        'No active tenancy found.',
      );
      return;
    }

    if (activeRents.length > 1) {
      let propertyList = 'Which property is this payment for?\n\n';
      activeRents.forEach((rent, index) => {
        propertyList += `${index + 1}. ${rent.property.name}\n`;
      });
      propertyList += '\nReply with the number of the property.';

      await this.templateSenderService.sendText(from, propertyList);
      await this.cache.set(
        `service_request_state_${from}`,
        `select_property_rent:${JSON.stringify(activeRents.map((r) => r.property_id))}`,
        this.SESSION_TIMEOUT_MS,
      );
    } else {
      await this.sendRentConfirmation(from, activeRents[0]);
    }
  }

  /**
   * Handle property selection for rent payment (multi-property tenant)
   */
  private async handlePropertySelectionForRent(
    from: string,
    text: string,
    userState: string,
  ): Promise<void> {
    const propertyIds = JSON.parse(userState.split('select_property_rent:')[1]);
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

    await this.cache.delete(`service_request_state_${from}`);

    const user = await this.findTenantByPhone(from);
    if (!user?.accounts?.length) return;

    const rent = await this.rentRepo.findOne({
      where: {
        property_id: propertyIds[selectedIndex],
        tenant_id: user.accounts[0].id,
        rent_status: RentStatusEnum.ACTIVE,
      },
      relations: ['property'],
    });

    if (!rent) {
      await this.templateSenderService.sendText(
        from,
        'No active rent found for that property.',
      );
      return;
    }

    await this.sendRentConfirmation(from, rent);
  }

  /**
   * Send rent payment confirmation message with details before requesting landlord approval.
   */
  private async sendRentConfirmation(from: string, rent: Rent): Promise<void> {
    const formatNGN = (amt: number) =>
      amt.toLocaleString('en-NG', { style: 'currency', currency: 'NGN' });

    const rentAmount = rent.rental_price || 0;
    const serviceCharge = rent.service_charge || 0;
    const walletBalance = rent.property?.owner_id
      ? await this.tenantBalancesService.getBalance(
          rent.tenant_id,
          rent.property.owner_id,
        )
      : 0;
    const outstandingBalance = walletBalance < 0 ? -walletBalance : 0;
    const totalAmount = Math.max(0, rentAmount + serviceCharge - walletBalance);

    const paymentFrequency = rent.payment_frequency || 'Annually';

    // Calculate renewal dates
    const startDate = new Date(rent.expiry_date || new Date());
    startDate.setDate(startDate.getDate() + 1);
    const endDate = new Date(startDate);
    switch (paymentFrequency.toLowerCase()) {
      case 'monthly':
        endDate.setMonth(endDate.getMonth() + 1);
        break;
      case 'quarterly':
        endDate.setMonth(endDate.getMonth() + 3);
        break;
      case 'bi-annually':
        endDate.setMonth(endDate.getMonth() + 6);
        break;
      case 'annually':
      default:
        endDate.setFullYear(endDate.getFullYear() + 1);
        break;
    }
    endDate.setDate(endDate.getDate() - 1);

    const startFormatted = startDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const endFormatted = endDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    let message = `Do you want to send a rent renewal request to your landlord for *${rent.property.name}*?\n`;
    message += `\n*Frequency:* ${paymentFrequency}`;
    message += `\n*Tenancy Period:* ${startFormatted} – ${endFormatted}`;
    message += `\n\n*Rent:* ${formatNGN(rentAmount)}`;
    if (serviceCharge > 0)
      message += `\n*Service Charge:* ${formatNGN(serviceCharge)}`;
    if (outstandingBalance > 0)
      message += `\n*Outstanding Balance:* ${formatNGN(outstandingBalance)}`;
    if (walletBalance > 0)
      message += `\n*Wallet Credit:* -${formatNGN(walletBalance)}`;
    message += `\n\n*Total: ${formatNGN(totalAmount)}*`;

    await this.templateSenderService.sendButtons(from, message, [
      {
        id: `confirm_pay_rent:${rent.property_id}`,
        title: 'Yes, send request',
      },
      { id: 'cancel_payment', title: 'Cancel' },
    ]);
  }

  /**
   * Handle confirmed rent payment button click.
   */
  private async handleConfirmPayRent(
    from: string,
    propertyId: string,
  ): Promise<void> {
    const user = await this.findTenantByPhone(from);
    if (!user?.accounts?.length) return;

    const rent = await this.rentRepo.findOne({
      where: {
        property_id: propertyId,
        tenant_id: user.accounts[0].id,
        rent_status: RentStatusEnum.ACTIVE,
      },
      relations: ['property'],
    });

    if (!rent) {
      await this.templateSenderService.sendText(
        from,
        'No active rent found for that property.',
      );
      return;
    }

    await this.createRentInvoiceAndRequestApproval(from, rent);
  }

  /**
   * Create a rent invoice (with OB if any) and send approval request to landlord.
   */
  private async createRentInvoiceAndRequestApproval(
    from: string,
    rent: Rent,
  ): Promise<void> {
    const user = await this.findTenantByPhone(from);
    if (!user?.accounts?.length) return;

    const accountId = user.accounts[0].id;
    const rentAmount = rent.rental_price || 0;
    const serviceCharge = rent.service_charge || 0;
    const walletBal = rent.property?.owner_id
      ? await this.tenantBalancesService.getBalance(
          accountId,
          rent.property.owner_id,
        )
      : 0;
    const outstandingBalance = walletBal < 0 ? -walletBal : 0;
    const totalAmount = Math.max(0, rentAmount + serviceCharge - walletBal);

    // Find propertyTenant record
    const propertyTenant = await this.propertyTenantRepo.findOne({
      where: {
        property_id: rent.property_id,
        tenant_id: accountId,
        status: TenantStatusEnum.ACTIVE,
      },
    });

    if (!propertyTenant) {
      await this.templateSenderService.sendText(
        from,
        'Could not find your tenancy record. Please contact your landlord.',
      );
      return;
    }

    // Calculate renewal dates (same logic as initiateRenewal)
    const startDate = new Date(rent.expiry_date || new Date());
    startDate.setDate(startDate.getDate() + 1);

    const paymentFrequency = rent.payment_frequency || 'Annually';
    const endDate = new Date(startDate);
    switch (paymentFrequency.toLowerCase()) {
      case 'monthly':
        endDate.setMonth(endDate.getMonth() + 1);
        break;
      case 'quarterly':
        endDate.setMonth(endDate.getMonth() + 3);
        break;
      case 'bi-annually':
        endDate.setMonth(endDate.getMonth() + 6);
        break;
      case 'annually':
      default:
        endDate.setFullYear(endDate.getFullYear() + 1);
        break;
    }
    endDate.setDate(endDate.getDate() - 1);

    // Create invoice with PENDING_APPROVAL status
    const token = uuidv4();

    const invoice = this.renewalInvoiceRepo.create({
      token,
      property_tenant_id: propertyTenant.id,
      property_id: rent.property_id,
      tenant_id: accountId,
      start_date: startDate,
      end_date: endDate,
      rent_amount: rentAmount,
      service_charge: serviceCharge,
      legal_fee: 0,
      other_charges: 0,
      total_amount: totalAmount,
      outstanding_balance: outstandingBalance,
      token_type: 'tenant',
      payment_status: RenewalPaymentStatus.PENDING_APPROVAL,
      payment_frequency: paymentFrequency,
    });

    await this.renewalInvoiceRepo.save(invoice);

    // Look up landlord to send approval request
    const property = await this.propertyRepo.findOne({
      where: { id: rent.property_id },
      relations: ['owner', 'owner.user'],
    });

    if (!property?.owner?.user?.phone_number) {
      this.logger.warn(
        `Cannot send approval request: owner data missing for property ${rent.property_id}`,
      );
      await this.templateSenderService.sendText(
        from,
        'We could not reach your landlord. Please contact them directly.',
      );
      return;
    }

    const landlordPhone = this.utilService.normalizePhoneNumber(
      property.owner.user.phone_number,
    );
    const tenantName = `${this.utilService.toSentenceCase(user.first_name)} ${this.utilService.toSentenceCase(user.last_name)}`;
    const formatNGN = (amt: number) =>
      amt.toLocaleString('en-NG', { style: 'currency', currency: 'NGN' });

    const startFormatted = startDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const endFormatted = endDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    let message = `${tenantName} is requesting to pay rent for *${rent.property.name}*.\n`;
    message += `\n*Frequency:* ${paymentFrequency}`;
    message += `\n*Tenancy Period:* ${startFormatted} – ${endFormatted}`;
    message += `\n\n*Rent:* ${formatNGN(rentAmount)}`;
    if (serviceCharge > 0)
      message += `\n*Service Charge:* ${formatNGN(serviceCharge)}`;
    if (outstandingBalance > 0)
      message += `\n*Outstanding Balance:* ${formatNGN(outstandingBalance)}`;
    message += `\n\n*Total: ${formatNGN(totalAmount)}*`;
    message += `\n\nDo you approve this payment?`;

    // Send approval request to landlord with buttons
    await this.templateSenderService.sendButtons(landlordPhone, message, [
      { id: `approve_rent_request:${invoice.id}`, title: 'Approve' },
      { id: `decline_rent_request:${invoice.id}`, title: 'Decline' },
    ]);

    // Notify tenant
    await this.templateSenderService.sendText(
      from,
      `Your rent payment request for ${rent.property.name} has been sent to your landlord for approval. You'll be notified once they respond.`,
    );
  }

  /**
   * Handle "Confirm details" quick reply from welcome_tenant template.
   * Shows details for the specific property that was attached.
   */
  async handleConfirmTenancyDetails(
    from: string,
    propertyId: string,
  ): Promise<void> {
    const user = await this.findTenantByPhone(from);

    if (!user?.accounts?.length) {
      await this.templateSenderService.sendText(
        from,
        'No tenancy info available.',
      );
      return;
    }

    const propertyTenant = await this.propertyTenantRepo.findOne({
      where: {
        tenant_id: In(user.accounts.map((a) => a.id)),
        property_id: propertyId,
        status: TenantStatusEnum.ACTIVE,
      },
      relations: ['property'],
    });

    if (!propertyTenant) {
      await this.templateSenderService.sendText(
        from,
        'No active tenancy found for this property. Please contact your landlord.',
      );
      return;
    }

    await this.showTenancyDetailsForProperty(
      from,
      propertyTenant.tenant_id,
      propertyTenant,
    );
  }

  /**
   * Show tenancy details for a specific property
   */
  private async showTenancyDetailsForProperty(
    from: string,
    accountId: string,
    propertyTenant: any,
  ): Promise<void> {
    if (!propertyTenant?.property) {
      await this.templateSenderService.sendText(
        from,
        'Property details are not available. Please contact your landlord.',
      );
      return;
    }

    // Find the rent record specifically for this tenant and property
    const rent = await this.rentRepo.findOne({
      where: {
        tenant_id: accountId,
        property_id: propertyTenant.property.id,
        rent_status: RentStatusEnum.ACTIVE,
      },
    });

    console.log(
      '🔍 DEBUG: Found rent record:',
      rent
        ? {
            id: rent.id,
            tenant_id: rent.tenant_id,
            property_id: rent.property_id,
            rental_price: rent.rental_price,
            rent_start_date: rent.rent_start_date,
            expiry_date: rent.expiry_date,
          }
        : 'null',
    );

    if (!rent) {
      await this.templateSenderService.sendText(
        from,
        `Rent details for ${propertyTenant.property.name} are not available yet. Please contact your landlord.`,
      );
      return;
    }

    const property = propertyTenant.property;

    const formatNGN = (amount: number) =>
      amount != null
        ? amount.toLocaleString('en-NG', { style: 'currency', currency: 'NGN' })
        : '—';

    const formatDate = (date: Date | string | null) =>
      date
        ? new Date(date).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : '—';

    const serviceCharge = rent.service_charge ?? property.service_charge ?? 0;

    const detailsMessage =
      `Here are your tenancy details:\n\n` +
      `• Property: ${property.name}\n` +
      `• Location: ${property.location}\n` +
      `• Rent: ${formatNGN(rent.rental_price)}\n` +
      `• Service charge: ${serviceCharge > 0 ? formatNGN(serviceCharge) : 'None'}\n` +
      `• Tenancy start date: ${formatDate(rent.rent_start_date)}\n` +
      `• Tenancy due date: ${formatDate(rent.expiry_date)}\n\n` +
      `Are these details correct?`;

    console.log(
      '🔍 DEBUG: Sending details message for property:',
      property.name,
    );

    await this.templateSenderService.sendButtons(from, detailsMessage, [
      { id: 'tenancy_details_correct', title: 'Yes, correct' },
      { id: 'tenancy_details_incorrect', title: 'No, not correct' },
    ]);
  }

  /**
   * Handle "Yes, correct" response — tenant confirmed their tenancy details.
   */
  private async handleTenancyDetailsCorrect(from: string): Promise<void> {
    await this.templateSenderService.sendButtons(
      from,
      `Great, you're all set.\n\nYou can now use Lizt to report issues, make payments and stay updated.\n\nSimply tap Hi to get started.`,
      [{ id: 'main_menu', title: 'Hi' }],
    );
  }

  /**
   * Handle "No, not correct" response — tenant says details are wrong.
   */
  private async handleTenancyDetailsIncorrect(from: string): Promise<void> {
    await this.templateSenderService.sendText(
      from,
      `Thanks for letting us know.\n\nPlease contact your landlord or property manager to update your tenancy details before continuing.`,
    );
  }

  /**
   * Find tenant by phone number.
   * Filters user.accounts to only those that appear as tenant_id in PropertyTenant,
   * so callers can safely use accounts[0] as the active tenant account regardless
   * of what role label the account has.
   */
  private async findTenantByPhone(phoneNumber: string): Promise<Users | null> {
    const normalizedPhone = this.utilService.normalizePhoneNumber(phoneNumber);

    const user = await this.usersRepo.findOne({
      where: { phone_number: normalizedPhone },
      relations: ['accounts'],
    });

    console.log('🔍 findTenantByPhone:', {
      normalizedPhone,
      userFound: !!user,
      userId: user?.id,
      accounts: user?.accounts?.map((a) => ({ id: a.id, role: a.role })),
    });

    if (!user?.accounts?.length) return null;

    const accountIds = user.accounts.map((a) => a.id);
    const tenantRecords = await this.propertyTenantRepo.find({
      where: { tenant_id: In(accountIds) },
      select: ['tenant_id'],
    });

    console.log('🔍 PropertyTenant lookup:', {
      accountIds,
      tenantRecordsFound: tenantRecords.length,
      tenantIds: tenantRecords.map((r) => r.tenant_id),
    });

    const tenantAccountIds = new Set(tenantRecords.map((r) => r.tenant_id));
    if (!tenantAccountIds.size) return null;

    // Keep only accounts that are used as tenant_id in PropertyTenant.
    // Sort so proper TENANT-role accounts come first — callers using accounts[0]
    // will get the cleanest account when both old (FM/landlord) and new (tenant)
    // records exist for the same user.
    user.accounts = user.accounts
      .filter((a) => tenantAccountIds.has(a.id))
      .sort((a, b) => {
        if (a.role === RolesEnum.TENANT && b.role !== RolesEnum.TENANT) return -1;
        if (a.role !== RolesEnum.TENANT && b.role === RolesEnum.TENANT) return 1;
        return 0;
      });
    return user;
  }
}

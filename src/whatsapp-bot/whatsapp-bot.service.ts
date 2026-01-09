import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ILike, Not, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import WhatsApp from 'whatsapp';
import { Users } from 'src/users/entities/user.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { CacheService } from 'src/lib/cache';

import { SCREEN_RESPONSES } from './flows';
import { RolesEnum } from 'src/base.entity';
import { UsersService } from 'src/users/users.service';
import { ServiceRequestStatusEnum } from 'src/service-requests/dto/create-service-request.dto';
import { UtilService } from 'src/utils/utility-service';
import { IncomingMessage } from './utils';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { ServiceRequestsService } from 'src/service-requests/service-requests.service';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { PropertiesService } from 'src/properties/properties.service';
import { Waitlist } from 'src/users/entities/waitlist.entity';
import { Property } from 'src/properties/entities/property.entity';
import { TenantStatusEnum } from 'src/properties/dto/create-property.dto';
import { Account } from 'src/users/entities/account.entity';
import { LandlordFlow } from './templates/landlord/landlordflow';
import { LandlordLookup } from './templates/landlord/landlordlookup';
import { LandlordInteractive } from './templates/landlord/landinteractive';
import { ChatLogService } from './chat-log.service';
import { MessageDirection } from './entities/message-direction.enum';

// ✅ Reusable buttons
const MAIN_MENU_BUTTONS = [
  { id: 'service_request', title: 'Service request' },
  { id: 'view_tenancy', title: 'View tenancy details' },
  { id: 'visit_site', title: 'Visit our website' },
];

@Injectable()
export class WhatsappBotService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappBotService.name);
  private wa = new WhatsApp();

  // ✅ Define timeout in milliseconds
  private readonly SESSION_TIMEOUT_MS = 5 * 60 * 1000;

  constructor(
    @InjectRepository(Users)
    private usersRepo: Repository<Users>,

    @InjectRepository(ServiceRequest)
    private readonly serviceRequestRepo: Repository<ServiceRequest>,

    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepo: Repository<PropertyTenant>,

    @InjectRepository(TeamMember)
    private readonly teamMemberRepo: Repository<TeamMember>,

    @InjectRepository(Waitlist)
    private readonly waitlistRepo: Repository<Waitlist>,

    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,

    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,

    private readonly flow: LandlordFlow,

    private readonly serviceRequestService: ServiceRequestsService,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
    private readonly utilService: UtilService,
    private readonly chatLogService: ChatLogService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Module initialization - Add configuration validation and startup logging
   * Requirements: 6.1, 6.2, 6.3, 6.4
   */
  async onModuleInit() {
    this.logger.log('🚀 WhatsApp Bot Service initializing...');

    try {
      // Validate and log simulation mode configuration
      await this.validateAndLogSimulationMode();

      // Validate simulator dependencies when simulation mode is active
      await this.validateSimulatorDependencies();

      // Validate production dependencies when not in simulation mode
      await this.validateProductionDependencies();

      this.logger.log(
        '✅ WhatsApp Bot Service initialization completed successfully',
      );
    } catch (error) {
      this.logger.error(
        '❌ WhatsApp Bot Service initialization failed:',
        error.message,
      );
      throw error;
    }
  }

  async getNextScreen(decryptedBody) {
    const { screen, data, action } = decryptedBody;

    console.log('Received request body:', decryptedBody);

    if (action === 'ping') {
      return { data: { status: 'active' } };
    }

    if (data?.error) {
      console.warn('Received client error:', data);
      return { data: { acknowledged: true } };
    }

    if (action === 'INIT') {
      return {
        ...SCREEN_RESPONSES.WELCOME_SCREEN,
        data: {
          ...SCREEN_RESPONSES.WELCOME_SCREEN.data,
          is_location_enabled: false,
          is_date_enabled: false,
          is_time_enabled: false,
        },
      };
    }

    if (action === 'data_exchange') {
      switch (screen) {
        case 'WELCOME_SCREEN':
          return { ...SCREEN_RESPONSES.SERVICE_REQUEST };

        case 'SERVICE_REQUEST':
          return { ...SCREEN_RESPONSES.REPORT_ISSUE_INPUT };

        case 'REPORT_ISSUE_INPUT':
          return { ...SCREEN_RESPONSES.ISSUE_LOGGED_CONFIRMATION };

        case 'ISSUE_LOGGED_CONFIRMATION':
          return {
            ...SCREEN_RESPONSES.TERMINAL_SCREEN,
            ...SCREEN_RESPONSES.SUCCESS,
          };
      }
    }

    console.error('Unhandled request body:', decryptedBody);
    throw new Error('Unhandled endpoint request.');
  }

  /**
   * Get all possible phone number formats for lookup
   * Handles the mismatch between WhatsApp webhook format and database storage
   */
  private getPhoneNumberFormats(phoneNumber: string): string[] {
    const normalized = this.utilService.normalizePhoneNumber(phoneNumber);
    const withoutPlus = normalized.startsWith('+')
      ? normalized.slice(1)
      : normalized;
    const local = phoneNumber.startsWith('234')
      ? '0' + phoneNumber.slice(3)
      : phoneNumber;

    return [
      phoneNumber, // Original format from WhatsApp
      normalized, // +234... format
      withoutPlus, // 234... format (without +)
      local, // 0... local format
    ];
  }

  /**
   * Find user by phone number with comprehensive format matching
   */
  private async findUserByPhone(
    phoneNumber: string,
    role?: RolesEnum,
  ): Promise<Users | null> {
    const phoneFormats = this.getPhoneNumberFormats(phoneNumber);

    console.log('🔍 Phone number lookup formats:', {
      original: phoneNumber,
      formats: phoneFormats,
      role: role || 'any',
    });

    const whereConditions = phoneFormats.map((format) => {
      const condition: any = { phone_number: format };
      if (role) {
        condition.accounts = { role };
      }
      return condition;
    });

    const user = await this.usersRepo.findOne({
      where: whereConditions,
      relations: ['accounts'],
    });

    console.log('👤 User lookup result:', {
      found: !!user,
      userId: user?.id,
      accountsCount: user?.accounts?.length || 0,
      matchedPhone: user?.phone_number,
    });

    return user;
  }

  async handleMessage(messages: IncomingMessage[]) {
    const message = messages[0];
    const from = message?.from;
    if (!from || !message) return;

    console.log('📱 Incoming WhatsApp message from:', from);
    console.log('📨 Full message object:', JSON.stringify(message, null, 2));

    // Log inbound message with graceful error handling and simulation status
    try {
      // Detect if this is a simulator message
      const isSimulated = this.isSimulatorMessage(message);

      // Enhanced logging with simulation status
      console.log('📝 Logging inbound message:', {
        from,
        messageType: message.type || 'unknown',
        isSimulated,
        messageId: message.id,
      });

      await this.chatLogService.logInboundMessage(
        from,
        message.type || 'unknown',
        this.extractMessageContent(message),
        {
          ...message,
          is_simulated: isSimulated,
          simulation_status: isSimulated
            ? 'simulator_message'
            : 'production_message',
        },
      );

      if (isSimulated) {
        console.log('✅ Successfully logged SIMULATED inbound message');
      } else {
        console.log('✅ Successfully logged production inbound message');
      }
    } catch (error) {
      console.error(
        '⚠️ Failed to log inbound message, continuing with processing:',
        error,
      );
      // Continue processing even if logging fails (graceful degradation)
      // Requirements: 7.3 - Ensure logging errors don't break message flow
    }

    // CRITICAL: Check if this is a role selection button click BEFORE role detection
    const buttonReply =
      message.interactive?.button_reply || (message as any).button;
    const buttonId = buttonReply?.id || buttonReply?.payload;

    if (buttonId === 'select_role_fm' || buttonId === 'select_role_landlord') {
      console.log('🎯 Role selection button detected, handling directly');
      // Handle role selection in the appropriate handler based on message type
      if (message.type === 'interactive' || message.type === 'button') {
        // This will be handled by handleInteractive/handleFacilityInteractive
        // But we need to route it there without going through role detection
        const selectedRole =
          buttonId === 'select_role_fm'
            ? RolesEnum.FACILITY_MANAGER
            : RolesEnum.LANDLORD;

        console.log('✅ User selected role:', selectedRole);
        console.log(
          '💾 Storing in cache:',
          `selected_role_${from}`,
          '=',
          selectedRole,
        );

        await this.cache.set(
          `selected_role_${from}`,
          selectedRole,
          24 * 60 * 60 * 1000,
        );

        const verify = await this.cache.get(`selected_role_${from}`);
        console.log('✅ Verified cache storage:', verify);

        // Now show the appropriate menu
        const user = await this.usersRepo.findOne({
          where: { phone_number: from },
          relations: ['accounts'],
        });

        if (selectedRole === RolesEnum.FACILITY_MANAGER) {
          await this.sendButtons(
            from,
            `Hello Manager ${this.utilService.toSentenceCase(user?.first_name || '')} Welcome to Property Kraft! What would you like to do today?`,
            [
              { id: 'service_request', title: 'View requests' },
              { id: 'view_account_info', title: 'Account Info' },
              { id: 'visit_site', title: 'Visit website' },
            ],
          );
        } else {
          const landlordName = this.utilService.toSentenceCase(
            user?.first_name || 'there',
          );
          await this.sendLandlordMainMenu(from, landlordName);
        }
        return; // Don't continue with role detection
      }
    }

    // CRITICAL FIX: Try both phone number formats
    // WhatsApp sends international format (2348184350211)
    // But DB might have local format (08184350211)
    const normalizedPhone = this.utilService.normalizePhoneNumber(from);
    const strippedFrom = from.replace(/^\+/, '');
    const localPhone = strippedFrom.startsWith('234')
      ? '0' + strippedFrom.slice(3)
      : from;

    console.log('🔍 Phone number formats:', {
      original: from,
      normalized: normalizedPhone,
      local: localPhone,
    });

    // Try to find user with either format
    const user = await this.usersRepo.findOne({
      where: [
        { phone_number: from },
        { phone_number: normalizedPhone },
        { phone_number: localPhone },
        { phone_number: strippedFrom },
      ],
      relations: ['accounts'],
    });

    // console.log('👤 User lookup result:', {
    //   found: !!user,
    //   userId: user?.id,
    //   userName: user ? `${user.first_name} ${user.last_name}` : 'N/A',
    //   phoneNumber: user?.phone_number,
    //   userTableRole: user?.role,
    //   accountsCount: user?.accounts?.length || 0,
    //   accountsIsArray: Array.isArray(user?.accounts),
    //   accountsRaw: user?.accounts,
    //   accounts: user?.accounts?.map((acc) => ({
    //     id: acc.id,
    //     role: acc.role,
    //     email: acc.email,
    //   })),
    // });

    // CRITICAL: If accounts array is empty or undefined, the user might not have been properly set up
    if (!user) {
      console.log('❌ User not found - will route to default handler');
    } else if (!user.accounts || user.accounts.length === 0) {
      console.log(
        '⚠️ WARNING: User found but has NO accounts! This is a data integrity issue.',
      );
      console.log(
        '   User will be treated as unrecognized. Check database setup.',
      );
    }

    // FIXED: Check account role with role selection for multi-role users
    let role = user?.role; // Fallback to user.role if no accounts

    if (user?.accounts && user.accounts.length > 0) {
      console.log('🔍 Checking accounts for role...', {
        totalAccounts: user.accounts.length,
        accountRoles: user.accounts.map((acc) => acc.role),
      });

      // Check if user has selected a role (from role selection menu)
      const selectedRole = await this.cache.get(`selected_role_${from}`);

      if (selectedRole) {
        console.log('✅ Using previously selected role:', selectedRole);
        console.log(
          '🔍 Selected role type:',
          typeof selectedRole,
          selectedRole,
        );
        console.log('🔍 Enum values:', {
          FM: RolesEnum.FACILITY_MANAGER,
          LANDLORD: RolesEnum.LANDLORD,
        });
        role = selectedRole as RolesEnum;
      } else {
        // Check if user has multiple roles (FM + Landlord, or any combination)
        const hasMultipleRoles = user.accounts.length > 1;
        const hasFM = user.accounts.some(
          (acc) => acc.role === RolesEnum.FACILITY_MANAGER,
        );
        const hasLandlord = user.accounts.some(
          (acc) => acc.role === RolesEnum.LANDLORD,
        );

        if (hasMultipleRoles && (hasFM || hasLandlord)) {
          console.log(
            '👥 User has multiple roles, showing role selection menu',
          );

          // Build role selection buttons
          const roleButtons: { id: string; title: string }[] = [];
          if (hasFM) {
            roleButtons.push({
              id: 'select_role_fm',
              title: 'Facility Manager',
            });
          }
          if (hasLandlord) {
            roleButtons.push({ id: 'select_role_landlord', title: 'Landlord' });
          }

          await this.sendButtons(
            from,
            'You have multiple roles. Which would you like to use?',
            roleButtons,
          );

          // Don't route yet, wait for role selection
          return;
        }

        // Single role - use priority order
        const facilityAccount = user.accounts.find(
          (acc) => acc.role === RolesEnum.FACILITY_MANAGER,
        );
        if (facilityAccount) {
          console.log('✅ Found FACILITY_MANAGER account:', facilityAccount.id);
          role = RolesEnum.FACILITY_MANAGER;
        } else {
          const landlordAccount = user.accounts.find(
            (acc) => acc.role === RolesEnum.LANDLORD,
          );
          if (landlordAccount) {
            console.log('✅ Found LANDLORD account:', landlordAccount.id);
            role = RolesEnum.LANDLORD;
          } else {
            const tenantAccount = user.accounts.find(
              (acc) => acc.role === RolesEnum.TENANT,
            );
            if (tenantAccount) {
              console.log('✅ Found TENANT account:', tenantAccount.id);
              role = RolesEnum.TENANT;
            } else {
              console.log('❌ No matching account role found!');
            }
          }
        }
      }
    }

    console.log('🎭 Role detection result:', {
      detectedRole: role,
      accountsCount: user?.accounts?.length,
      willRouteToDefault:
        !role ||
        ![
          RolesEnum.TENANT,
          RolesEnum.LANDLORD,
          RolesEnum.FACILITY_MANAGER,
        ].includes(role as any),
    });

    switch (role) {
      case RolesEnum.FACILITY_MANAGER:
        console.log('Facility Manager Message');
        if (message.type === 'interactive' || message.type === 'button') {
          void this.handleFacilityInteractive(message, from);
        }

        if (message.type === 'text') {
          console.log('in facility');
          void this.handleFacilityText(message, from);
        }

        break;
      case RolesEnum.TENANT:
        console.log('In tenant');
        if (message.type === 'interactive' || message.type === 'button') {
          void this.handleInteractive(message, from);
        }

        if (message.type === 'text') {
          void this.handleText(message, from);
        }
        break;
      case RolesEnum.LANDLORD:
        console.log('In Landlord');
        if (message.type === 'interactive' || message.type === 'button') {
          void this.flow.handleInteractive(message, from);
        }

        if (message.type === 'text') {
          void this.flow.handleText(from, message.text?.body as any);
        }

        break;
      default:
        console.log('⚠️ Routing to DEFAULT handler (unrecognized role):', {
          role,
          messageType: message.type,
          from,
        });
        if (message.type === 'interactive') {
          void this.handleDefaultInteractive(message, from);
        }

        if (message.type === 'text') {
          void this.handleDefaultText(message, from);
        }
    }
  }

  async handleDefaultText(message: any, from: string) {
    const text = message.text?.body;

    if (text.toLowerCase() === 'done') {
      await this.cache.delete(`service_request_state_${from}`);
      await this.cache.delete(`service_request_state_default_${from}`);
      await this.sendText(from, 'Thank you!  Your session has ended.');
      return;
    }
    void this.handleDefaultCachedResponse(from, text);
  }

  async handleDefaultCachedResponse(from, text) {
    const default_state = await this.cache.get(
      `service_request_state_default_${from}`,
    );

    if (default_state && default_state.includes('property_owner_options')) {
      const option = default_state.split('property_owner_options')[1].slice(1);

      const waitlist = this.waitlistRepo.create({
        full_name: text,
        phone_number: this.utilService.normalizePhoneNumber(from),
        option,
      });

      await this.waitlistRepo.save(waitlist);

      await this.sendText(
        from,
        `Thanks, ${text}! Someone from our team will reach out shortly to help you complete setup.`,
      );

      await this.sendText(
        '2349138834648',
        `${text} just joined your waitlist and is in interested in ${option}`,
      );

      await this.sendText(
        from,
        'Know another landlord who could benefit from Lizt? Share their name & number in this format \n e.g John James:08123456789 \n, and we’ll reach out directly (mentioning you). \n If not, reply "done" to end session',
      );

      await this.cache.set(
        `service_request_state_default_${from}`,
        `share_referral`,
        this.SESSION_TIMEOUT_MS, // now in ms,
      );

      return;
    } else if (default_state === 'share_referral') {
      const [referral_name, referral_phone_number] = text.trim().split(':');

      if (!referral_name || !referral_phone_number) {
        await this.sendText(
          from,
          'Invalid format. Please use: Name:PhoneNumber',
        );
        return;
      }

      const waitlist = await this.waitlistRepo.findOne({
        where: { phone_number: from },
      });

      if (!waitlist) {
        await this.sendText(from, 'Information not found');
        return;
      }

      const normalizedPhone = this.utilService.normalizePhoneNumber(
        referral_phone_number,
      );
      if (!normalizedPhone) {
        await this.sendText(
          from,
          'Invalid phone number format, please try again.',
        );
        return;
      }

      waitlist.referral_name = referral_name.trim();
      waitlist.referral_phone_number = normalizedPhone;

      await this.waitlistRepo.save(waitlist);

      await this.sendText(
        from,
        'Thank you for sharing a referral with us, your session has ended',
      );

      await this.cache.delete(`service_request_state_default_${from}`);
      return;
    } else {
      await this.sendButtons(
        from,
        `Hello! Welcome to Lizt by Property Kraft – we make property management seamless for owners, managers, and renters.\n Which best describes you?`,
        [
          { id: 'property_owner', title: 'Property Owner' },
          { id: 'property_manager', title: 'Property Manager' },
          { id: 'house_hunter', title: 'House Hunter' },
        ],
      );
    }
  }

  async handleDefaultInteractive(message: any, from: string) {
    const buttonReply = message.interactive?.button_reply;
    if (!buttonReply) return;

    switch (buttonReply.id) {
      case 'property_owner':
        await this.sendButtons(
          from,
          `Great! As a Property Owner, you can use Lizt to:\n 
     1. Rent Reminders & Lease Tracking – stay on top of rent due dates and lease expiries.\n 
     2. Rent Collection – receive rent payments directly into your bank account through us, while we track payment history and balances for you.\n 
     3. Maintenance Management – tenants can log service requests with you for quick action. \n Please choose one of the options below:`,
          [
            { id: 'rent_reminder', title: 'Rent Reminders' },
            { id: 'reminder_collection', title: 'Reminders/Collection' },
            { id: 'all', title: 'All' },
          ],
        );

        break;
      case 'rent_reminder':
      default:
        await this.sendText(
          from,
          `Got it! You’ve selected, ${buttonReply.id} \n Before we connect you with our team, may we have your full name?`,
        );
        await this.cache.set(
          `service_request_state_default_${from}`,
          `property_owner_options_${buttonReply.id}`,
          this.SESSION_TIMEOUT_MS, // now in ms,
        );
    }
  }

  async handleFacilityText(message: any, from: string) {
    const text = message.text?.body;

    console.log(text, 'facility');

    // Handle "switch role" command for multi-role users
    if (
      text?.toLowerCase() === 'switch role' ||
      text?.toLowerCase() === 'switch'
    ) {
      await this.cache.delete(`selected_role_${from}`);
      await this.sendText(
        from,
        'Role cleared. Send any message to select a new role.',
      );
      return;
    }

    if (text?.toLowerCase() === 'start flow') {
      void this.sendFlow(from); // Call the send flow logic
    }

    if (text?.toLowerCase() === 'acknowledge request') {
      await this.cache.set(
        `service_request_state_facility_${from}`,
        'acknowledged',
        this.SESSION_TIMEOUT_MS, // now in ms,
      );
      await this.sendText(from, 'Please provide the request ID to acknowledge');
    }

    if (text?.toLowerCase() === 'menu') {
      await this.sendButtons(from, 'Menu Options', [
        { id: 'service_request', title: 'Resolve request' },
        { id: 'view_account_info', title: 'View Account Info' },
        { id: 'visit_site', title: 'Visit our website' },
      ]);
      return;
    }

    if (text.toLowerCase() === 'done') {
      await this.cache.delete(`service_request_state_${from}`);
      await this.cache.delete(`service_request_state_facility_${from}`);
      await this.sendText(from, 'Thank you!  Your session has ended.');
      return;
    }

    //handle redis cache
    void this.cachedFacilityResponse(from, text);
  }

  async cachedFacilityResponse(from, text) {
    const facilityState = await this.cache.get(
      `service_request_state_facility_${from}`,
    );

    // Handle viewing specific request by number
    if (facilityState && facilityState.startsWith('view_request_list:')) {
      const requestIds = JSON.parse(
        facilityState.split('view_request_list:')[1],
      );
      const selectedIndex = parseInt(text.trim()) - 1;

      if (
        isNaN(selectedIndex) ||
        selectedIndex < 0 ||
        selectedIndex >= requestIds.length
      ) {
        await this.sendText(
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
        await this.sendText(
          from,
          "I couldn't find that request. Please try again.",
        );
        return;
      }

      const statusLabel =
        serviceRequest.status === ServiceRequestStatusEnum.OPEN
          ? 'Open'
          : serviceRequest.status === ServiceRequestStatusEnum.RESOLVED
            ? 'Resolved'
            : serviceRequest.status === ServiceRequestStatusEnum.REOPENED
              ? 'Reopened'
              : serviceRequest.status === ServiceRequestStatusEnum.IN_PROGRESS
                ? 'In Progress'
                : serviceRequest.status;

      await this.sendText(
        from,
        `*${serviceRequest.description}*\n\nTenant: ${this.utilService.toSentenceCase(serviceRequest.tenant.user.first_name)} ${this.utilService.toSentenceCase(serviceRequest.tenant.user.last_name)}\nProperty: ${serviceRequest.property.name}\nStatus: ${statusLabel}`,
      );

      await this.sendButtons(from, 'What would you like to do?', [
        { id: `mark_resolved:${serviceRequest.id}`, title: 'Mark as Resolved' },
        { id: 'back_to_list', title: 'Back to List' },
      ]);

      await this.cache.set(
        `service_request_state_facility_${from}`,
        `viewing_request:${serviceRequest.id}`,
        this.SESSION_TIMEOUT_MS,
      );
      return;
    }

    // Handle marking request as resolved (kept for backward compatibility with text input)
    if (facilityState && facilityState.startsWith('viewing_request:')) {
      // User is viewing a request but typed text instead of using buttons
      await this.sendText(
        from,
        'Please use the buttons above to mark as resolved or go back to the list.',
      );
      return;
    }

    if (facilityState === 'acknowledged') {
      const serviceRequest = await this.serviceRequestRepo.findOne({
        where: {
          request_id: text,
        },
        relations: ['tenant', 'facilityManager'],
      });

      if (!serviceRequest) {
        await this.sendText(
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
      await this.sendText(
        from,
        `You have acknowledged service request ID: ${text}`,
      );
      await this.sendText(
        this.utilService.normalizePhoneNumber(
          serviceRequest.tenant.user.phone_number,
        ),
        `Your service request with ID: ${text} is being processed by ${this.utilService.toSentenceCase(
          serviceRequest.facilityManager.account.profile_name,
        )}.`,
      );
      await this.cache.delete(`service_request_state_facility_${from}`);
    } else if (facilityState === 'resolve-or-update') {
      if (text.toLowerCase() === 'update') {
        await this.cache.set(
          `service_request_state_facility_${from}`,
          'awaiting_update',
          this.SESSION_TIMEOUT_MS, // now in ms,
        );
        await this.sendText(
          from,
          'Please provide the request ID and feedback-update separated by a colon. e.g "#SR12345: Your request is being processed"',
        );
        return;
      } else if (text.toLowerCase() === 'resolve') {
        await this.cache.set(
          `service_request_state_facility_${from}`,
          'awaiting_resolution',
          this.SESSION_TIMEOUT_MS, // now in ms,
        );
        await this.sendText(
          from,
          'Please provide the request ID to resolve e.g #SR12345',
        );
        return;
      } else {
        await this.sendText(
          from,
          'Invalid option. Please type "update" or "resolve".',
        );
        return;
      }
    } else if (facilityState === 'awaiting_update') {
      const [requestId, ...feedbackParts] = text.split(':');
      const feedback = feedbackParts.join(':').trim();
      if (!requestId || !feedback) {
        await this.sendText(
          from,
          'Invalid format. Please provide the request ID and feedback-update separated by a colon. e.g "#SR12345: Your request is being processed"',
        );
        await this.sendText(
          from,
          'Type the right format to see other options or "done" to finish.',
        );
        return;
      }
      const serviceRequest = await this.serviceRequestRepo.findOne({
        where: {
          request_id: requestId.trim(),
        },
        relations: ['tenant', 'facilityManager'],
      });

      if (!serviceRequest) {
        await this.sendText(
          from,
          'No service requests found with that ID. try again',
        );
        await this.cache.delete(`service_request_state_facility_${from}`);
        return;
      }
      serviceRequest.notes = feedback;
      await this.serviceRequestRepo.save(serviceRequest);
      await this.sendText(
        from,
        `You have updated service request ID: ${requestId.trim()}`,
      );
      await this.sendText(
        this.utilService.normalizePhoneNumber(
          serviceRequest.tenant.user.phone_number,
        ),
        `Update on your service request with ID: ${requestId.trim()} - ${feedback}`,
      );
      await this.cache.delete(`service_request_state_facility_${from}`);
    } else if (facilityState === 'awaiting_resolution') {
      const requestId = text.trim();
      if (!requestId) {
        await this.sendText(
          from,
          'Invalid format. Please provide the request ID to resolve e.g "#SR12345"',
        );
        return;
      }
      const serviceRequest = await this.serviceRequestRepo.findOne({
        where: {
          request_id: requestId,
        },
        relations: ['tenant', 'facilityManager'],
      });

      if (!serviceRequest) {
        await this.sendText(
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
      await this.sendText(
        from,
        `You have resolved service request ID: ${requestId}. Waiting for tenant confirmation.`,
      );

      // Trigger Tenant Confirmation
      await this.sendTenantConfirmationTemplate({
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
      return;
    } else {
      const user = await this.usersRepo.findOne({
        where: {
          phone_number: `${from}`,
          accounts: { role: RolesEnum.FACILITY_MANAGER },
        },
        relations: ['accounts'],
      });

      if (!user) {
        await this.sendToAgentWithTemplate(from);
      } else {
        await this.sendButtons(
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
  }

  async handleFacilityInteractive(message: any, from: string) {
    // Handle both interactive button_reply and direct button formats
    const buttonReply = message.interactive?.button_reply || message.button;
    const buttonId = buttonReply?.id || buttonReply?.payload;

    console.log('🔘 FM Button clicked:', {
      messageType: message.type,
      buttonReply,
      buttonId,
      from,
    });

    if (!buttonReply || !buttonId) {
      console.log('❌ No button reply found in message');
      return;
    }

    switch (buttonId) {
      case 'view_all_service_requests':
      case 'service_request': {
        console.log('✅ Matched view_all_service_requests or service_request');
        const teamMemberInfo = await this.teamMemberRepo.findOne({
          where: {
            account: { user: { phone_number: `${from}` } },
          },
          relations: ['team'],
        });

        if (!teamMemberInfo) {
          await this.sendText(from, 'No team info available.');
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
          await this.sendText(from, 'No service requests found.');
          return;
        }

        let response = 'Here are all service requests:\n\n';
        serviceRequests.forEach((req: any, i) => {
          response += `${i + 1}. ${req.description} (${req.property.name})\n\n`;
        });

        response += 'Reply with a number to view details.';

        await this.sendText(from, response);

        await this.cache.set(
          `service_request_state_facility_${from}`,
          `view_request_list:${JSON.stringify(serviceRequests.map((r) => r.id))}`,
          this.SESSION_TIMEOUT_MS,
        );
        break;
      }

      case 'view_account_info': {
        const teamMemberAccountInfo = await this.teamMemberRepo.findOne({
          where: {
            account: { user: { phone_number: `${from}` } },
          },
          relations: ['account', 'account.user'],
        });

        if (!teamMemberAccountInfo) {
          await this.sendText(from, 'No account info available.');
          return;
        }

        await this.sendText(
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

        await this.sendText(
          from,
          'Type "menu" to see other options or "done" to finish.',
        );
        break;
      }
      case 'visit_site':
        await this.sendText(
          from,
          'Visit our website: https://propertykraft.africa',
        );
        break;

      case 'back_to_list':
        await this.sendButtons(from, 'What would you like to do?', [
          { id: 'service_request', title: 'View all requests' },
          { id: 'view_account_info', title: 'View Account Info' },
        ]);
        await this.cache.delete(`service_request_state_facility_${from}`);
        break;

      default:
        // Handle dynamic button IDs like "mark_resolved:requestId"
        if (buttonId.startsWith('mark_resolved:')) {
          const requestId = buttonId.split('mark_resolved:')[1];

          const serviceRequest = await this.serviceRequestRepo.findOne({
            where: { id: requestId },
            relations: ['tenant', 'tenant.user', 'facilityManager'],
          });

          if (!serviceRequest) {
            await this.sendText(from, "I couldn't find that request.");
            await this.cache.delete(`service_request_state_facility_${from}`);
            return;
          }

          if (serviceRequest.status === ServiceRequestStatusEnum.CLOSED) {
            await this.sendText(from, 'This request has already been closed.');
            await this.cache.delete(`service_request_state_facility_${from}`);
            return;
          }

          // Get facility manager info
          const facilityManager = await this.teamMemberRepo.findOne({
            where: { account: { user: { phone_number: from } } },
            relations: ['account', 'account.user'],
          });

          await this.serviceRequestService.updateStatus(
            serviceRequest.id,
            ServiceRequestStatusEnum.RESOLVED,
            'Facility manager marked as resolved via WhatsApp',
            {
              id: facilityManager?.account?.user?.id || 'system',
              role: 'facility_manager',
              name:
                facilityManager?.account?.profile_name || 'Facility Manager',
            },
          );

          await this.sendText(
            from,
            "Great! I've marked this request as resolved. The tenant will confirm if everything is working correctly.",
          );

          // Trigger Tenant Confirmation
          console.log(
            'Sending tenant confirmation to:',
            serviceRequest.tenant.user.phone_number,
          );
          try {
            await this.sendTenantConfirmationTemplate({
              phone_number: this.utilService.normalizePhoneNumber(
                serviceRequest.tenant.user.phone_number,
              ),
              tenant_name: this.utilService.toSentenceCase(
                serviceRequest.tenant.user.first_name,
              ),
              request_description: serviceRequest.description,
              request_id: serviceRequest.request_id,
            });
            console.log('Tenant confirmation sent successfully');
          } catch (error) {
            console.error('Failed to send tenant confirmation:', error);
          }

          await this.cache.delete(`service_request_state_facility_${from}`);
          break;
        }

        await this.sendText(from, '❓ Unknown option selected.');
    }
  }

  // users
  async handleText(message: any, from: string) {
    const text = message.text?.body;

    if (text?.toLowerCase() === 'start flow') {
      void this.sendFlow(from); // Call the send flow logic
    }

    console.log('tenant sends:', text);

    // Handle "switch role" command for multi-role users
    if (
      text?.toLowerCase() === 'switch role' ||
      text?.toLowerCase() === 'switch'
    ) {
      await this.cache.delete(`selected_role_${from}`);
      await this.sendText(
        from,
        'Role cleared. Send any message to select a new role.',
      );
      return;
    }

    if (text?.toLowerCase() === 'menu') {
      await this.sendButtons(
        from,
        'Menu Options',
        [
          { id: 'service_request', title: 'Service request' },
          { id: 'view_tenancy', title: 'View tenancy details' },
          // {
          //   id: 'view_notices_and_documents',
          //   title: 'See notices and documents',
          // },
          { id: 'visit_site', title: 'Visit our website' },
        ],
        'Tap on any option to continue.',
      );
      return;
    }

    if (text.toLowerCase() === 'done') {
      await this.cache.delete(`service_request_state_${from}`);
      await this.sendText(from, 'Thank you!  Your session has ended.');
      return;
    }

    //handle redis cache
    void this.cachedResponse(from, text);
  }

  async cachedResponse(from, text) {
    const userState = await this.cache.get(`service_request_state_${from}`);

    // Handle property selection for multi-property tenants
    if (userState && userState.startsWith('select_property:')) {
      const propertyIds = JSON.parse(userState.split('select_property:')[1]);
      const selectedIndex = parseInt(text.trim()) - 1;

      if (
        isNaN(selectedIndex) ||
        selectedIndex < 0 ||
        selectedIndex >= propertyIds.length
      ) {
        await this.sendText(
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

      await this.sendText(from, 'Sure! Please tell me what needs to be fixed.');
      return;
    }

    if (
      userState === 'awaiting_description' ||
      userState?.startsWith('awaiting_description:')
    ) {
      // Extract property_id if it was stored
      let selectedPropertyId: string | undefined = undefined;
      if (userState.startsWith('awaiting_description:')) {
        selectedPropertyId = userState.split('awaiting_description:')[1];
      }

      // FIXED: Use multi-format phone lookup
      const normalizedPhone = this.utilService.normalizePhoneNumber(from);
      const strippedFrom = from.replace(/^\+/, '');
      const localPhone = strippedFrom.startsWith('234')
        ? '0' + strippedFrom.slice(3)
        : from;

      const user = await this.usersRepo.findOne({
        where: [
          { phone_number: from, accounts: { role: RolesEnum.TENANT } },
          {
            phone_number: normalizedPhone,
            accounts: { role: RolesEnum.TENANT },
          },
          { phone_number: localPhone, accounts: { role: RolesEnum.TENANT } },
          { phone_number: strippedFrom, accounts: { role: RolesEnum.TENANT } },
        ],
        relations: ['accounts'],
      });

      if (!user?.accounts?.length) {
        await this.sendText(
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
            request_id,
            property_id,
          } = new_service_request;
          await this.sendText(
            from,
            "Got it. I've noted your request — someone will take a look and reach out once it's being handled.",
          );

          // Send navigation options after completing request
          await this.sendButtons(from, 'Want to do something else?', [
            { id: 'new_service_request', title: 'Request a service' },
            { id: 'main_menu', title: 'Go back to main menu' },
          ]);

          await this.cache.delete(`service_request_state_${from}`);

          // Send notifications to facility managers
          for (const manager of facility_managers) {
            await this.sendFacilityServiceRequest({
              phone_number: manager.phone_number,
              manager_name: manager.name,
              property_name: property_name,
              property_location: property_location,
              service_request: text,
              tenant_name: `${this.utilService.toSentenceCase(
                user.first_name,
              )} ${this.utilService.toSentenceCase(user.last_name)}`,
              tenant_phone_number: user.phone_number,
              date_created: new Date(created_at).toLocaleString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
                timeZone: 'Africa/Lagos',
              }),
              is_landlord: false, // Explicitly mark as FM notification
            });

            // Add delay (e.g., 2 seconds)
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }

          // Send notification to landlord
          const property_tenant = await this.propertyTenantRepo.findOne({
            where: {
              property_id,
            },
            relations: ['property', 'property.owner', 'property.owner.user'],
          });

          if (property_tenant) {
            const admin_phone_number = this.utilService.normalizePhoneNumber(
              property_tenant?.property.owner.user.phone_number,
            );

            await this.sendFacilityServiceRequest({
              phone_number: admin_phone_number,
              manager_name: this.utilService.toSentenceCase(
                property_tenant.property.owner.user.first_name,
              ),
              property_name: property_name,
              property_location: property_location,
              service_request: text,
              tenant_name: `${this.utilService.toSentenceCase(
                user.first_name,
              )} ${this.utilService.toSentenceCase(user.last_name)}`,
              tenant_phone_number: user.phone_number,
              date_created: new Date(created_at).toLocaleString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
                timeZone: 'Africa/Lagos',
              }),
              is_landlord: true, // Explicitly mark as landlord notification
            });
          }
        }
        await this.cache.delete(`service_request_state_${from}`);
      } catch (error) {
        await this.sendText(
          from,
          error.message || 'An error occurred while logging your request.',
        );
        await this.cache.delete(`service_request_state_${from}`);
      }

      return;
    } else if (userState === 'view_single_service_request') {
      // FIXED: Use multi-format phone lookup
      const normalizedPhone = this.utilService.normalizePhoneNumber(from);
      const localPhone = from.startsWith('234') ? '0' + from.slice(3) : from;

      const serviceRequests = await this.serviceRequestRepo.find({
        where: [
          {
            tenant: { user: { phone_number: from } },
            description: ILike(`%${text}%`),
          },
          {
            tenant: { user: { phone_number: normalizedPhone } },
            description: ILike(`%${text}%`),
          },
          {
            tenant: { user: { phone_number: localPhone } },
            description: ILike(`%${text}%`),
          },
        ],
        relations: ['tenant'],
      });

      if (!serviceRequests.length) {
        await this.sendText(
          from,
          'No service requests found matching that description.',
        );
        await this.cache.delete(`service_request_state_${from}`);
        return;
      }

      let response = 'Here are the matching service requests:\n';
      serviceRequests.forEach((req: any, i) => {
        response += `${req.description} (${new Date(
          req.created_at,
        ).toLocaleDateString()}) \n Status: ${req.status}\n Notes: ${
          req.notes || '——'
        }\n\n`;
      });

      await this.sendText(from, response);
      await this.cache.delete(`service_request_state_${from}`);

      await this.sendButtons(from, 'back', [
        {
          id: 'service_request',
          title: 'Back to Requests',
        },
      ]);

      return;
    } else {
      // FIXED: Use multi-format phone lookup like in handleMessage
      const normalizedPhone = this.utilService.normalizePhoneNumber(from);
      const strippedFrom = from.replace(/^\+/, '');
      const localPhone = strippedFrom.startsWith('234')
        ? '0' + strippedFrom.slice(3)
        : from;

      const user = await this.usersRepo.findOne({
        where: [
          { phone_number: from, accounts: { role: RolesEnum.TENANT } },
          {
            phone_number: normalizedPhone,
            accounts: { role: RolesEnum.TENANT },
          },
          { phone_number: localPhone, accounts: { role: RolesEnum.TENANT } },
          { phone_number: strippedFrom, accounts: { role: RolesEnum.TENANT } },
        ],
        relations: ['accounts'],
      });

      if (!user) {
        console.log(
          '⚠️ Tenant not found in cachedResponse, sending agent template',
        );
        await this.sendToAgentWithTemplate(from);
      } else {
        console.log('✅ Sending tenant menu to:', user.first_name);
        await this.sendButtons(
          from,
          `Hello ${this.utilService.toSentenceCase(
            user.first_name,
          )} What would you like to do?`,
          [
            { id: 'service_request', title: 'Service request' },
            { id: 'view_tenancy', title: 'View tenancy details' },
            // {
            //   id: 'view_notices_and_documents',
            //   title: 'See notices and documents',
            // },
            { id: 'visit_site', title: 'Visit our website' },
          ],
          'Tap on any option to continue.',
        );
      }
    }
  }

  async handleInteractive(message: any, from: string) {
    const buttonReply = message.interactive?.button_reply || message.button;
    const buttonId = buttonReply?.id || buttonReply?.payload;

    if (!buttonReply) return;
    console.log(buttonId, 'bID');

    // Handle role selection buttons
    if (buttonId === 'select_role_fm' || buttonId === 'select_role_landlord') {
      const selectedRole =
        buttonId === 'select_role_fm'
          ? RolesEnum.FACILITY_MANAGER
          : RolesEnum.LANDLORD;

      console.log('✅ User selected role:', selectedRole);
      console.log(
        '💾 Storing in cache:',
        `selected_role_${from}`,
        '=',
        selectedRole,
      );

      // Store selected role in cache (valid for 24 hours)
      await this.cache.set(
        `selected_role_${from}`,
        selectedRole,
        24 * 60 * 60 * 1000,
      );

      // Verify it was stored
      const verify = await this.cache.get(`selected_role_${from}`);
      console.log('✅ Verified cache storage:', verify);

      // Route to appropriate handler based on selected role
      if (selectedRole === RolesEnum.FACILITY_MANAGER) {
        const user = await this.usersRepo.findOne({
          where: { phone_number: from },
          relations: ['accounts'],
        });

        await this.sendButtons(
          from,
          `Hello Manager ${this.utilService.toSentenceCase(user?.first_name || '')} Welcome to Property Kraft! What would you like to do today?`,
          [
            { id: 'service_request', title: 'Service Requests' },
            { id: 'view_account_info', title: 'Account Info' },
            { id: 'visit_site', title: 'Visit Website' },
          ],
        );
      } else {
        const user = await this.usersRepo.findOne({
          where: { phone_number: from },
          relations: ['accounts'],
        });

        await this.sendButtons(
          from,
          `Hello ${this.utilService.toSentenceCase(user?.first_name || '')}, What do you want to do today?`,
          [
            { id: 'view_properties', title: 'View properties' },
            { id: 'view_maintenance', title: 'Maintenance requests' },
            { id: 'generate_kyc_link', title: 'Generate KYC link' },
          ],
        );
      }
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
        // Route to the appropriate case by using the action part
        cleanButtonId = action;
      }
    }

    switch (cleanButtonId) {
      case 'visit_site':
        await this.sendText(
          from,
          'Visit our website: https://propertykraft.africa',
        );
        break;

      case 'view_tenancy': {
        // FIXED: Use comprehensive multi-format phone lookup
        const normalizedPhoneViewTenancy =
          this.utilService.normalizePhoneNumber(from);
        const localPhoneViewTenancy = from.startsWith('234')
          ? '0' + from.slice(3)
          : from;

        // Additional format: without + prefix (common in WhatsApp webhooks)
        const withoutPlusPrefix = normalizedPhoneViewTenancy.startsWith('+')
          ? normalizedPhoneViewTenancy.slice(1)
          : normalizedPhoneViewTenancy;

        console.log('🔍 Phone number lookup formats:', {
          original: from,
          normalized: normalizedPhoneViewTenancy,
          local: localPhoneViewTenancy,
          withoutPlus: withoutPlusPrefix,
        });

        const user = await this.usersRepo.findOne({
          where: [
            { phone_number: from, accounts: { role: RolesEnum.TENANT } },
            {
              phone_number: normalizedPhoneViewTenancy,
              accounts: { role: RolesEnum.TENANT },
            },
            {
              phone_number: localPhoneViewTenancy,
              accounts: { role: RolesEnum.TENANT },
            },
            {
              phone_number: withoutPlusPrefix,
              accounts: { role: RolesEnum.TENANT },
            },
          ],
          relations: ['accounts'],
        });

        console.log('👤 User lookup result:', {
          found: !!user,
          userId: user?.id,
          accountsCount: user?.accounts?.length || 0,
          accounts: user?.accounts?.map((acc) => ({
            id: acc.id,
            role: acc.role,
          })),
        });

        if (!user?.accounts?.length) {
          console.log('❌ No user found with tenant account for phone:', from);
          await this.sendText(from, 'No tenancy info available.');
          return;
        }

        const accountId = user.accounts[0].id;
        console.log('🏠 Looking for properties for account:', accountId);

        const properties = await this.propertyTenantRepo.find({
          where: { tenant_id: accountId },
          relations: ['property', 'property.rents'],
        });

        console.log('🏠 Properties found:', {
          count: properties?.length || 0,
          properties: properties?.map((pt) => ({
            id: pt.id,
            propertyId: pt.property_id,
            propertyName: pt.property?.name,
            status: pt.status,
            rentsCount: pt.property?.rents?.length || 0,
          })),
        });

        if (!properties?.length) {
          console.log('⚠️ No properties found for tenant account:', accountId);
          console.log(
            '   This means no property_tenants record exists for this account.',
          );
          console.log(
            '   Tenant may not have been properly attached to a property.',
          );
          await this.sendText(from, 'No properties found.');
          return;
        }

        for (const item of properties) {
          // Check if rent data exists
          if (!item.property?.rents?.length) {
            console.log(
              '⚠️ No rent data found for property:',
              item.property?.name,
            );
            await this.sendText(
              from,
              `Property ${item.property?.name || 'Unknown'} found, but no rent details available. Please contact support.`,
            );
            continue;
          }

          const rent = item.property.rents[0];

          // Validate rent data
          if (
            !rent.rent_start_date ||
            !rent.expiry_date ||
            !rent.rental_price
          ) {
            console.log(
              '⚠️ Incomplete rent data for property:',
              item.property?.name,
            );
            await this.sendText(
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
          const endDate = new Date(rent.expiry_date).toLocaleDateString(
            'en-GB',
            {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            },
          );

          await this.sendText(
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
            this.SESSION_TIMEOUT_MS, // now in ms,
          );
        }

        await this.sendText(
          from,
          'Type "menu" to see other options or "done" to finish.',
        );
        break;
      }

      case 'service_request':
        await this.sendButtons(from, 'What would you like to do?', [
          {
            id: 'new_service_request',
            title: 'Request a service',
          },
          {
            id: 'view_service_request',
            title: 'View all requests',
          },
        ]);
        break;

      case 'view_service_request': {
        // FIXED: Use multi-format phone lookup
        const normalizedPhoneViewService =
          this.utilService.normalizePhoneNumber(from);
        const localPhoneViewService = from.startsWith('234')
          ? '0' + from.slice(3)
          : from;

        const serviceRequests = await this.serviceRequestRepo.find({
          where: [
            {
              tenant: { user: { phone_number: from } },
              status: Not(ServiceRequestStatusEnum.CLOSED),
            },
            {
              tenant: { user: { phone_number: normalizedPhoneViewService } },
              status: Not(ServiceRequestStatusEnum.CLOSED),
            },
            {
              tenant: { user: { phone_number: localPhoneViewService } },
              status: Not(ServiceRequestStatusEnum.CLOSED),
            },
          ],
          relations: ['tenant'],
          order: { created_at: 'DESC' },
        });

        if (!serviceRequests.length) {
          await this.sendText(from, "You don't have any service requests yet.");
          return;
        }

        let response = 'Here are your recent service requests:\n\n';
        serviceRequests.forEach((req: any) => {
          const date = new Date(req.created_at);
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

        await this.sendText(from, response);

        // Send navigation options after viewing requests
        await this.sendButtons(from, 'Want to do something else?', [
          { id: 'new_service_request', title: 'Request a service' },
          { id: 'main_menu', title: 'Go back to main menu' },
        ]);
        break;
      }

      case 'new_service_request': {
        // Check if tenant has multiple properties
        const normalizedPhoneNewRequest =
          this.utilService.normalizePhoneNumber(from);
        const localPhoneNewRequest = from.startsWith('234')
          ? '0' + from.slice(3)
          : from;

        // Additional format: without + prefix (common in WhatsApp webhooks)
        const withoutPlusPrefixNewRequest =
          normalizedPhoneNewRequest.startsWith('+')
            ? normalizedPhoneNewRequest.slice(1)
            : normalizedPhoneNewRequest;

        console.log('🔍 Phone number lookup formats (new request):', {
          original: from,
          normalized: normalizedPhoneNewRequest,
          local: localPhoneNewRequest,
          withoutPlus: withoutPlusPrefixNewRequest,
        });

        const userNewRequest = await this.usersRepo.findOne({
          where: [
            { phone_number: from, accounts: { role: RolesEnum.TENANT } },
            {
              phone_number: normalizedPhoneNewRequest,
              accounts: { role: RolesEnum.TENANT },
            },
            {
              phone_number: localPhoneNewRequest,
              accounts: { role: RolesEnum.TENANT },
            },
            {
              phone_number: withoutPlusPrefixNewRequest,
              accounts: { role: RolesEnum.TENANT },
            },
          ],
          relations: ['accounts'],
        });

        console.log('👤 User lookup result (new request):', {
          found: !!userNewRequest,
          userId: userNewRequest?.id,
          accountsCount: userNewRequest?.accounts?.length || 0,
        });

        if (!userNewRequest?.accounts?.length) {
          console.log(
            '❌ No user found with tenant account for phone (new request):',
            from,
          );
          await this.sendText(from, 'No tenancy info available.');
          return;
        }

        const accountId = userNewRequest.accounts[0].id;
        const properties = await this.propertyTenantRepo.find({
          where: {
            tenant_id: accountId,
            status: TenantStatusEnum.ACTIVE,
          },
          relations: ['property'],
        });

        if (!properties?.length) {
          await this.sendText(
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

          await this.sendText(from, propertyList);

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
          await this.sendText(
            from,
            'Sure! Please tell me what needs to be fixed.',
          );
        }
        break;
      }

      case 'main_menu': {
        // Clear any cached state and return to main menu
        await this.cache.delete(`service_request_state_${from}`);

        // FIXED: Use multi-format phone lookup
        const normalizedPhoneMainMenu =
          this.utilService.normalizePhoneNumber(from);
        const localPhoneMainMenu = from.startsWith('234')
          ? '0' + from.slice(3)
          : from;

        // Additional format: without + prefix (common in WhatsApp webhooks)
        const withoutPlusPrefixMainMenu = normalizedPhoneMainMenu.startsWith(
          '+',
        )
          ? normalizedPhoneMainMenu.slice(1)
          : normalizedPhoneMainMenu;

        const userMainMenu = await this.usersRepo.findOne({
          where: [
            { phone_number: from, accounts: { role: RolesEnum.TENANT } },
            {
              phone_number: normalizedPhoneMainMenu,
              accounts: { role: RolesEnum.TENANT },
            },
            {
              phone_number: localPhoneMainMenu,
              accounts: { role: RolesEnum.TENANT },
            },
            {
              phone_number: withoutPlusPrefixMainMenu,
              accounts: { role: RolesEnum.TENANT },
            },
          ],
          relations: ['accounts'],
        });

        if (!userMainMenu) {
          await this.sendToAgentWithTemplate(from);
        } else {
          await this.sendButtons(
            from,
            `Hello ${this.utilService.toSentenceCase(userMainMenu.first_name)} What would you like to do?`,
            [
              { id: 'service_request', title: 'Service request' },
              { id: 'view_tenancy', title: 'View tenancy details' },
              { id: 'visit_site', title: 'Visit our website' },
            ],
          );
        }
        break;
      }

      case 'confirm_resolution_yes': {
        // Handle Yes, it's fixed
        // We need to find the request associated with this interaction.
        // Since buttons don't carry payload in standard interactive messages easily without context,
        // we might need to rely on the last resolved request or parse context if available.
        // However, for simplicity and robustness, we can try to find the latest RESOLVED request for this tenant.

        const normalizedPhone = this.utilService.normalizePhoneNumber(from);
        const localPhone = from.startsWith('234') ? '0' + from.slice(3) : from;

        const latestResolvedRequest = await this.serviceRequestRepo.findOne({
          where: [
            {
              tenant: { user: { phone_number: from } },
              status: ServiceRequestStatusEnum.RESOLVED,
            },
            {
              tenant: { user: { phone_number: normalizedPhone } },
              status: ServiceRequestStatusEnum.RESOLVED,
            },
            {
              tenant: { user: { phone_number: localPhone } },
              status: ServiceRequestStatusEnum.RESOLVED,
            },
          ],
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

          await this.sendText(from, "Fantastic! Glad that's sorted 😊");

          // Notify FM and Landlord
          if (
            latestResolvedRequest.facilityManager?.account?.user?.phone_number
          ) {
            await this.sendText(
              this.utilService.normalizePhoneNumber(
                latestResolvedRequest.facilityManager.account.user.phone_number,
              ),
              `✅ Tenant confirmed the issue is fixed.\nRequest: ${latestResolvedRequest.description}\nStatus: Closed`,
            );
          }

          // Notify landlord
          const property_tenant = await this.propertyTenantRepo.findOne({
            where: {
              property_id: latestResolvedRequest.property_id,
            },
            relations: ['property', 'property.owner', 'property.owner.user'],
          });

          if (property_tenant?.property?.owner?.user?.phone_number) {
            await this.sendText(
              this.utilService.normalizePhoneNumber(
                property_tenant.property.owner.user.phone_number,
              ),
              `✅ Tenant confirmed the issue is fixed.\nRequest: ${latestResolvedRequest.description}\nStatus: Closed`,
            );
          }
        } else {
          await this.sendText(
            from,
            "I couldn't find a pending resolution to confirm.",
          );
        }
        break;
      }

      case 'confirm_resolution_no': {
        // Handle No, not yet
        const normalizedPhone = this.utilService.normalizePhoneNumber(from);
        const localPhone = from.startsWith('234') ? '0' + from.slice(3) : from;

        const latestResolvedRequest = await this.serviceRequestRepo.findOne({
          where: [
            {
              tenant: { user: { phone_number: from } },
              status: ServiceRequestStatusEnum.RESOLVED,
            },
            {
              tenant: { user: { phone_number: normalizedPhone } },
              status: ServiceRequestStatusEnum.RESOLVED,
            },
            {
              tenant: { user: { phone_number: localPhone } },
              status: ServiceRequestStatusEnum.RESOLVED,
            },
          ],
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

          await this.sendText(
            from,
            "Thanks for letting me know. I'll reopen the request and notify maintenance to check again.",
          );

          // Notify FM and Landlord
          if (
            latestResolvedRequest.facilityManager?.account?.user?.phone_number
          ) {
            await this.sendText(
              this.utilService.normalizePhoneNumber(
                latestResolvedRequest.facilityManager.account.user.phone_number,
              ),
              `⚠️ Tenant says the issue is not resolved. The request has been reopened.\nRequest: ${latestResolvedRequest.description}\nStatus: Reopened`,
            );
          }

          // Notify landlord
          const property_tenant = await this.propertyTenantRepo.findOne({
            where: {
              property_id: latestResolvedRequest.property_id,
            },
            relations: ['property', 'property.owner', 'property.owner.user'],
          });

          if (property_tenant?.property?.owner?.user?.phone_number) {
            await this.sendText(
              this.utilService.normalizePhoneNumber(
                property_tenant.property.owner.user.phone_number,
              ),
              `⚠️ Tenant says the issue is not resolved. The request has been reopened.\nRequest: ${latestResolvedRequest.description}\nStatus: Reopened`,
            );
          }
        } else {
          await this.sendText(
            from,
            "I couldn't find a pending resolution to confirm.",
          );
        }
        break;
      }

      default:
        await this.sendText(from, '❓ Unknown option selected.');
    }
  }

  async sendWhatsappMessageWithTemplate({
    phone_number,
    template_name,
    template_language = 'en',
    template_parameters = [],
  }: {
    phone_number: string;
    template_name: string;
    template_language?: string;
    template_parameters?: Array<{
      type: 'text';
      text: string;
      parameter_name?: string;
    }>;
  }) {
    const payload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: template_name,
        language: { code: template_language },
        components: [
          {
            type: 'body',
            parameters: template_parameters,
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  async sendToUserWithTemplate(phone_number: string, customer_name: string) {
    const payload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'main_menu',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                parameter_name: 'name',
                text: customer_name,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  async sendToAgentWithTemplate(phone_number) {
    const payload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'agent_welcome',
        language: {
          code: 'en',
        },
      },
    };

    await this.sendToWhatsappAPI(payload);
  }
  async sendToFacilityManagerWithTemplate({ phone_number, name, team, role }) {
    const payload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'facility_manager', // Your template name
        language: {
          code: 'en', // must match the language you set in WhatsApp template
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                parameter_name: 'name',
                text: name,
              },
              {
                type: 'text',
                parameter_name: 'team',
                text: team,
              },
              {
                type: 'text',
                parameter_name: 'role',
                text: role,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  async sendToPropertiesCreatedTemplate({ phone_number, name, property_name }) {
    const payload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'properties_created', // Your template name
        language: {
          code: 'en', // must match the language you set in WhatsApp template
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                parameter_name: 'name',
                text: name,
              },
              {
                type: 'text',
                parameter_name: 'property_name',
                text: property_name,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  async sendUserAddedTemplate({ phone_number, name, user, property_name }) {
    const payload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'user_added', // Your template name
        language: {
          code: 'en', // must match the language you set in WhatsApp template
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                parameter_name: 'name',
                text: name,
              },
              {
                type: 'text',
                parameter_name: 'user',
                text: user,
              },
              {
                type: 'text',
                parameter_name: 'property_name',
                text: property_name,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  async sendTenantWelcomeTemplate({
    phone_number,
    tenant_name,
    landlord_name,
    apartment_name,
  }: {
    phone_number: string;
    tenant_name: string;
    landlord_name: string;
    apartment_name?: string;
  }) {
    const payload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'tenant_welcome', // Your template name
        language: {
          code: 'en', // must match the language you set in WhatsApp template
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                parameter_name: 'tenant_name',
                text: tenant_name,
              },
              {
                type: 'text',
                parameter_name: 'landlord_name',
                text: landlord_name,
              },
              {
                type: 'text',
                parameter_name: 'apartment_name',
                text: apartment_name || 'your property',
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  async sendTenantConfirmationTemplate({
    phone_number,
    tenant_name,
    request_description,
    request_id,
  }: {
    phone_number: string;
    tenant_name: string;
    request_description: string;
    request_id: string;
  }) {
    const payload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'service_request_confirmation', // Template name
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                parameter_name: 'tenant_name',
                text: tenant_name,
              },
              {
                type: 'text',
                parameter_name: 'request_description',
                text: request_description,
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: 0,
            parameters: [
              {
                type: 'payload',
                payload: `confirm_resolution_yes:${request_id}`,
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: 1,
            parameters: [
              {
                type: 'payload',
                payload: `confirm_resolution_no:${request_id}`,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send tenant attachment confirmation via WhatsApp
   * Notifies tenant when they've been successfully attached to a property
   * Uses existing 'tenant_welcome' template
   */
  async sendTenantAttachmentNotification({
    phone_number,
    tenant_name,
    landlord_name,
    apartment_name,
  }: {
    phone_number: string;
    tenant_name: string;
    landlord_name: string;
    apartment_name: string;
  }) {
    // Use the existing tenant welcome template
    await this.sendTenantWelcomeTemplate({
      phone_number,
      tenant_name,
      landlord_name,
      apartment_name,
    });
  }

  /**
   * Send KYC application notification to landlord via WhatsApp
   * Notifies landlord when a tenant submits a KYC application
   * Uses 'tenant_application_notification' template with one URL button:
   * - View Application - Opens application details page with download option
   *
   * Template body: "{{1}}, a KYC application was submitted by {{2}} for the property {{3}}. Use the link below to view the application."
   * Variables:
   * {{1}} = landlord_name
   * {{2}} = tenant_name
   * {{3}} = property_name
   */
  async sendKYCApplicationNotification({
    phone_number,
    landlord_name,
    tenant_name,
    property_name,
    application_id,
    frontend_url,
  }: {
    phone_number: string;
    landlord_name: string;
    tenant_name: string;
    property_name: string;
    application_id: string;
    frontend_url: string;
  }) {
    const payload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'tenant_application_notification',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: landlord_name, // {{1}}
              },
              {
                type: 'text',
                text: tenant_name, // {{2}}
              },
              {
                type: 'text',
                text: property_name, // {{3}}
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: application_id, // {{1}} in button URL
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send KYC submission confirmation to tenant via WhatsApp
   * Notifies tenant when they successfully submit a KYC application
   * Uses 'kyc_submission_confirmation' template
   *
   * Template body: "Hello {{1}}, Your KYC form has been submitted. Your landlord is reviewing your details, and we'll keep you updated."
   * Variables:
   * {{1}} = tenant_name
   *
   * NOTE: You need to create this template in your WhatsApp Business Manager with the name 'kyc_submission_confirmation'
   */
  async sendKYCSubmissionConfirmation({
    phone_number,
    tenant_name,
  }: {
    phone_number: string;
    tenant_name: string;
  }) {
    const payload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'kyc_submission_confirmation',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: tenant_name, // {{1}}
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  async sendFacilityServiceRequest({
    phone_number,
    manager_name,
    property_name,
    property_location,
    service_request,
    tenant_name,
    tenant_phone_number,
    date_created,
    is_landlord = false,
  }: {
    phone_number: string;
    manager_name: string;
    property_name: string;
    property_location: string;
    service_request: string;
    tenant_name: string;
    tenant_phone_number: string;
    date_created: string;
    is_landlord?: boolean;
  }) {
    // For landlords, use template with URL button for direct redirect
    if (is_landlord) {
      const payload = {
        messaging_product: 'whatsapp',
        to: phone_number,
        type: 'template',
        template: {
          name: 'landlord_service_request_notification',
          language: {
            code: 'en',
          },
          components: [
            {
              type: 'body',
              parameters: [
                {
                  type: 'text',
                  text: tenant_name, // {{1}}
                },
                {
                  type: 'text',
                  text: property_name, // {{2}}
                },
                {
                  type: 'text',
                  text: service_request, // {{3}}
                },
                {
                  type: 'text',
                  text: date_created, // {{4}}
                },
              ],
            },
          ],
        },
      };

      await this.sendToWhatsappAPI(payload);
      return;
    }

    // For facility managers, use the template with quick reply button
    const payload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'fm_service_request_notification', // Template name
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: tenant_name, // {{1}}
              },
              {
                type: 'text',
                text: property_name, // {{2}}
              },
              {
                type: 'text',
                text: service_request, // {{3}}
              },
              {
                type: 'text',
                text: date_created, // {{4}}
              },
              {
                type: 'text',
                text: tenant_phone_number, // {{5}} - Tenant phone number
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: 0,
            parameters: [
              {
                type: 'payload',
                payload: 'view_all_service_requests',
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send KYC completion link to existing tenant via WhatsApp
   * Notifies tenant when landlord creates property with existing tenant
   * Uses 'kyc_completion_link' template with one URL button:
   * - Complete KYC - Opens KYC form with pre-filled data
   *
   * Template body: "Hello {{1}}, {{2}} has added you as a tenant for {{3}}. Please complete your KYC information using the link below."
   * Variables:
   * {{1}} = tenant_name
   * {{2}} = landlord_name
   * {{3}} = property_name
   *
   * Button URL: {{frontend_url}}/kyc/{{kyc_link_id}}
   */
  async sendKYCCompletionLink({
    phone_number,
    tenant_name,
    landlord_name,
    property_name,
    kyc_link_id,
  }: {
    phone_number: string;
    tenant_name: string;
    landlord_name: string;
    property_name: string;
    kyc_link_id: string;
  }) {
    const payload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'kyc_completion_link',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: tenant_name, // {{1}}
              },
              {
                type: 'text',
                text: landlord_name, // {{2}}
              },
              {
                type: 'text',
                text: property_name, // {{3}}
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: kyc_link_id, // Dynamic part of URL
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send KYC completion notification to landlord via WhatsApp
   * Notifies landlord when tenant completes their pending KYC
   * Uses 'kyc_completion_notification' template with one URL button:
   * - View Tenant Details - Opens tenant detail page
   *
   * Template body: "Hello {{1}}, {{2}} has completed their KYC information for {{3}}. You can now view their full tenant details."
   * Variables:
   * {{1}} = landlord_name
   * {{2}} = tenant_name
   * {{3}} = property_name
   *
   * Button URL: https://www.lizt.co/landlord/tenant-detail?tenantId={{tenant_id}}
   */
  async sendKYCCompletionNotification({
    phone_number,
    landlord_name,
    tenant_name,
    property_name,
    tenant_id,
  }: {
    phone_number: string;
    landlord_name: string;
    tenant_name: string;
    property_name: string;
    tenant_id: string;
  }) {
    const payload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'kyc_completion_notification',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: landlord_name, // {{1}}
              },
              {
                type: 'text',
                text: tenant_name, // {{2}}
              },
              {
                type: 'text',
                text: property_name, // {{3}}
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: tenant_id, // Dynamic part of URL (tenantId query parameter)
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  async sendText(to: string, text: string) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body: text,
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  async sendButtons(
    to: string,
    text: string = 'Hello, welcome to Property Kraft',
    buttons: { id: string; title: string }[],
    footer?: string,
  ) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text },
        ...(footer && { footer: { text: footer } }),
        action: {
          buttons: buttons.map((btn) => ({
            type: 'reply',
            reply: {
              id: btn.id,
              title: btn.title,
            },
          })),
        },
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send landlord main menu with URL buttons (requires approved template)
   * Template name: landlord_main_menu
   * This uses a WhatsApp template with URL buttons that redirect directly
   */
  async sendLandlordMainMenu(to: string, landlordName: string) {
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: 'landlord_main_menu',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: landlordName,
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: 2, // Third button (Generate KYC Link)
            parameters: [
              {
                type: 'payload',
                payload: 'generate_kyc_link',
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  async sendFlow(recipientNumber: string) {
    const payload = {
      messaging_product: 'whatsapp',
      to: recipientNumber,
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: {
          text: 'Please fill out this form:',
        },
        footer: {
          text: 'Powered by WhatsApp Flows',
        },
        action: {
          name: 'flow',
          parameters: {
            flow_id: '1435187147817037', // your flow_id
            flow_action: 'navigate',
            flow_message_version: '3',
            flow_cta: 'Not shown in draft mode',
            mode: 'draft',
            // flow_token: 'optional_prefill_token', // optional
            // flow_navigation: {
            //   screen: 'SERVICE_REQUEST', // start screen
            // },
          },
        },
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  async sendToWhatsappAPI(payload: object) {
    try {
      // Enhanced simulation mode detection with improved logging
      const simulatorMode = this.config.get('WHATSAPP_SIMULATOR');
      const isSimulationMode = this.validateSimulationMode(simulatorMode);

      console.log('🎭 Simulation mode detection:', {
        environmentVariable: simulatorMode,
        isSimulationMode,
        messageType: this.extractPayloadMessageType(payload),
        recipient: (payload as any)?.to,
      });

      if (isSimulationMode) {
        console.log('🎭 Simulation mode: Intercepting outbound message');
        console.log(
          '📤 Intercepted payload:',
          JSON.stringify(payload, null, 2),
        );

        try {
          // Emit to WebSocket gateway for simulator
          this.eventEmitter.emit('whatsapp.outbound', payload);
          console.log('✅ Successfully emitted to WebSocket gateway');

          // Log outbound message with simulation flag and enhanced debugging
          const recipientPhone = (payload as any)?.to;
          if (recipientPhone) {
            console.log('📝 Logging simulated outbound message:', {
              recipient: recipientPhone,
              messageType: this.extractPayloadMessageType(payload),
              isSimulated: true,
              simulationMode: 'intercepted',
            });

            await this.chatLogService.logOutboundMessage(
              recipientPhone,
              this.extractPayloadMessageType(payload),
              this.extractPayloadContent(payload),
              {
                ...payload,
                is_simulated: true,
                simulation_status: 'intercepted_by_simulator',
                simulation_mode: simulatorMode,
              },
              'sim_msg_id_' + Date.now(),
            );
            console.log('✅ Successfully logged simulated outbound message');
          }

          // Return properly formatted simulated response
          const simulatedResponse = this.createSimulatedResponse(payload);
          console.log('📋 Returning simulated response:', simulatedResponse);
          return simulatedResponse;
        } catch (simulationError) {
          console.error(
            '❌ Error in simulation mode processing:',
            simulationError,
          );
          // Enhanced error handling for simulation mode
          // Requirements: 7.3, 8.1, 8.4 - Ensure logging errors don't break message flow

          // Enhanced error context for debugging
          const errorContext = {
            mode: 'simulation',
            errorType: simulationError.constructor.name,
            errorMessage: simulationError.message,
            recipient: (payload as any)?.to,
            messageType: this.extractPayloadMessageType(payload),
            timestamp: new Date().toISOString(),
          };

          console.error('Simulation error context:', errorContext);

          // Still try to emit to WebSocket even if logging fails
          try {
            this.eventEmitter.emit('whatsapp.outbound', payload);
            console.log(
              '✅ Successfully emitted to WebSocket despite logging error',
            );
          } catch (emitError) {
            console.error('❌ Failed to emit to WebSocket:', emitError);
            // Don't throw - continue with response generation
          }

          // Return simulated response even if other operations fail
          // Validates: Requirements 8.1, 8.3 - Maintain same error response format
          const simulatedResponse = this.createSimulatedResponse(payload);
          console.log(
            '📋 Returning simulated response despite errors:',
            simulatedResponse,
          );
          return simulatedResponse;
        }
      }

      // Production mode: Send to real WhatsApp API
      console.log('🚀 Production mode: Sending to WhatsApp Cloud API');

      const phoneNumberId = this.config.get('WA_PHONE_NUMBER_ID');
      const accessToken = this.config.get('CLOUD_API_ACCESS_TOKEN');

      // Enhanced configuration validation with consistent error format
      // Validates: Requirements 8.1, 8.3, 8.4
      if (!phoneNumberId) {
        const configError = new Error(
          'WhatsApp phone number ID (WA_PHONE_NUMBER_ID) is not configured.',
        );
        console.error('❌ Configuration error:', {
          error: configError.message,
          mode: 'production',
          missingConfig: 'WA_PHONE_NUMBER_ID',
          timestamp: new Date().toISOString(),
        });
        throw configError;
      }
      if (!accessToken) {
        const configError = new Error(
          'WhatsApp access token (CLOUD_API_ACCESS_TOKEN) is not configured.',
        );
        console.error('❌ Configuration error:', {
          error: configError.message,
          mode: 'production',
          missingConfig: 'CLOUD_API_ACCESS_TOKEN',
          timestamp: new Date().toISOString(),
        });
        throw configError;
      }

      let response;
      let data;

      try {
        response = await fetch(
          `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(payload),
          },
        );

        data = await response.json();
        console.log('📨 Response from WhatsApp API:', data);
        console.log('📊 Response status:', response.status);
      } catch (networkError) {
        // Enhanced network error handling
        // Validates: Requirements 8.1, 8.4
        const errorContext = {
          mode: 'production',
          errorType: 'NetworkError',
          errorMessage: networkError.message,
          recipient: (payload as any)?.to,
          messageType: this.extractPayloadMessageType(payload),
          timestamp: new Date().toISOString(),
        };

        console.error('❌ Network error calling WhatsApp API:', errorContext);
        throw new Error(`Network error: ${networkError.message}`);
      }

      if (!response.ok) {
        // Enhanced API error handling with consistent format
        // Validates: Requirements 8.1, 8.3, 8.4
        const apiErrorContext = {
          mode: 'production',
          httpStatus: response.status,
          httpStatusText: response.statusText,
          whatsappError: data,
          recipient: (payload as any)?.to,
          messageType: this.extractPayloadMessageType(payload),
          timestamp: new Date().toISOString(),
        };

        console.error('❌ WhatsApp API Error:', apiErrorContext);

        // Create consistent error message format
        const errorMessage = `WhatsApp API Error (${response.status}): ${
          data?.error?.message || response.statusText
        }`;

        throw new Error(errorMessage);
      }

      // Log outbound message with graceful error handling and simulation status
      try {
        const wamid = data?.messages?.[0]?.id;
        const recipientPhone = (payload as any)?.to;

        if (recipientPhone) {
          console.log('📝 Logging production outbound message:', {
            recipient: recipientPhone,
            messageType: this.extractPayloadMessageType(payload),
            isSimulated: false,
            wamid,
          });

          await this.chatLogService.logOutboundMessage(
            recipientPhone,
            this.extractPayloadMessageType(payload),
            this.extractPayloadContent(payload),
            {
              ...payload,
              is_simulated: false,
              simulation_status: 'production_message',
              whatsapp_response: data,
            },
            wamid,
          );
          console.log('✅ Successfully logged production outbound message');
        }
      } catch (loggingError) {
        // Enhanced logging error handling
        // Validates: Requirements 7.3, 8.4 - Ensure logging errors don't break message flow
        const loggingErrorContext = {
          mode: 'production',
          errorType: loggingError.constructor.name,
          errorMessage: loggingError.message,
          recipient: (payload as any)?.to,
          messageType: this.extractPayloadMessageType(payload),
          timestamp: new Date().toISOString(),
        };

        console.error(
          '⚠️ Failed to log outbound message, continuing with response:',
          loggingErrorContext,
        );
        // Continue processing even if logging fails (graceful degradation)
      }

      return data;
    } catch (error) {
      // Enhanced top-level error handling with consistent format
      // Validates: Requirements 8.1, 8.2, 8.3, 8.4
      const errorContext = {
        errorType: error.constructor.name,
        errorMessage: error.message,
        recipient: (payload as any)?.to,
        messageType: this.extractPayloadMessageType(payload),
        timestamp: new Date().toISOString(),
      };

      console.error('❌ Error in sendToWhatsappAPI:', errorContext);

      // Re-throw with enhanced context but maintain original error type
      // This ensures consistent error handling across both modes
      throw error;
    }
  }

  /**
   * Helper method to extract content from incoming messages
   */
  private extractMessageContent(message: any): string {
    if (message.text?.body) {
      return message.text.body;
    }
    if (message.interactive?.button_reply?.title) {
      return `Button: ${message.interactive.button_reply.title}`;
    }
    if (message.interactive?.list_reply?.title) {
      return `List: ${message.interactive.list_reply.title}`;
    }
    if (message.button?.text) {
      return `Button: ${message.button.text}`;
    }
    if (message.image) {
      return `Image message (ID: ${message.image.id || 'unknown'})`;
    }
    if (message.document) {
      return `Document: ${message.document.filename || 'unknown'}`;
    }
    if (message.audio) {
      return `Audio message (ID: ${message.audio.id || 'unknown'})`;
    }
    if (message.video) {
      return `Video message (ID: ${message.video.id || 'unknown'})`;
    }
    if (message.location) {
      return `Location: ${message.location.latitude}, ${message.location.longitude}`;
    }
    return 'Unknown message content';
  }

  /**
   * Check if an incoming message is from the simulator
   * Requirements: 7.1 - Update inbound message logging to handle simulator messages
   */
  private isSimulatorMessage(message: any): boolean {
    return message.is_simulated === true;
  }

  /**
   * Helper method to extract message type from outbound payload
   */
  private extractPayloadMessageType(payload: any): string {
    if (payload.text) return 'text';
    if (payload.interactive) return 'interactive';
    if (payload.template) return 'template';
    if (payload.image) return 'image';
    if (payload.document) return 'document';
    if (payload.audio) return 'audio';
    if (payload.video) return 'video';
    if (payload.location) return 'location';
    return 'unknown';
  }

  /**
   * Helper method to extract content from outbound payload
   */
  private extractPayloadContent(payload: any): string {
    if (payload.text?.body) {
      return payload.text.body;
    }
    if (payload.interactive?.body?.text) {
      return payload.interactive.body.text;
    }
    if (payload.template?.name) {
      return `Template: ${payload.template.name}`;
    }
    if (payload.image?.caption) {
      return `Image: ${payload.image.caption}`;
    }
    if (payload.document?.filename) {
      return `Document: ${payload.document.filename}`;
    }
    return 'Outbound message content';
  }

  /**
   * Validates the WHATSAPP_SIMULATOR environment variable
   * Requirements: 6.1, 6.2
   */
  private validateSimulationMode(simulatorValue: string | undefined): boolean {
    console.log('🔍 Validating simulation mode configuration:', {
      rawValue: simulatorValue,
      type: typeof simulatorValue,
    });

    if (simulatorValue === undefined || simulatorValue === null) {
      console.log('✅ Simulation mode disabled (undefined/null)');
      return false;
    }

    const normalizedValue = simulatorValue.toString().toLowerCase().trim();
    console.log('🔄 Normalized value:', normalizedValue);

    if (normalizedValue === 'true') {
      console.log(
        '⚠️ WARNING: Simulation mode is ENABLED - no real WhatsApp messages will be sent',
      );
      return true;
    }

    if (normalizedValue === 'false' || normalizedValue === '') {
      console.log('✅ Simulation mode disabled (false/empty)');
      return false;
    }

    console.warn(
      '⚠️ Invalid WHATSAPP_SIMULATOR value:',
      simulatorValue,
      'treating as disabled',
    );
    return false;
  }

  /**
   * Creates a properly formatted simulated WhatsApp API response
   * Requirements: 2.5
   */
  private createSimulatedResponse(payload: any): any {
    const recipientPhone = payload?.to || 'unknown';
    const messageId =
      'sim_msg_id_' +
      Date.now() +
      '_' +
      Math.random().toString(36).substr(2, 9);

    console.log('🎭 Creating simulated response for:', {
      recipient: recipientPhone,
      messageId,
      messageType: this.extractPayloadMessageType(payload),
    });

    // Match WhatsApp Cloud API response format exactly
    const simulatedResponse = {
      messaging_product: 'whatsapp',
      contacts: [
        {
          input: recipientPhone,
          wa_id: recipientPhone.replace(/^\+/, ''), // Remove + prefix if present
        },
      ],
      messages: [
        {
          id: messageId,
        },
      ],
    };

    console.log('📋 Generated simulated response:', simulatedResponse);
    return simulatedResponse;
  }

  /**
   * Validate and log simulation mode configuration
   * Requirements: 6.1, 6.2
   */
  private async validateAndLogSimulationMode(): Promise<void> {
    const simulatorMode = this.config.get('WHATSAPP_SIMULATOR');
    const isSimulationMode = this.validateSimulationMode(simulatorMode);

    this.logger.log('📋 Configuration Status:');
    this.logger.log(`   WHATSAPP_SIMULATOR: ${simulatorMode || 'undefined'}`);
    this.logger.log(`   Simulation Mode Active: ${isSimulationMode}`);

    if (isSimulationMode) {
      this.logger.warn('⚠️  WARNING: SIMULATION MODE IS ENABLED');
      this.logger.warn(
        '⚠️  No real WhatsApp messages will be sent to WhatsApp Cloud API',
      );
      this.logger.warn(
        '⚠️  All outbound messages will be intercepted and routed to simulator',
      );
      this.logger.warn(
        '⚠️  This should only be used in development/testing environments',
      );
    } else {
      this.logger.log(
        '✅ Production mode active - messages will be sent to WhatsApp Cloud API',
      );
    }
  }

  /**
   * Validate simulator dependencies when simulation mode is active
   * Requirements: 6.3
   */
  private async validateSimulatorDependencies(): Promise<void> {
    const simulatorMode = this.config.get('WHATSAPP_SIMULATOR');
    const isSimulationMode = this.validateSimulationMode(simulatorMode);

    if (!isSimulationMode) {
      return; // Skip validation if not in simulation mode
    }

    this.logger.log('🔍 Validating simulator dependencies...');

    // Check if EventEmitter2 is available (required for WebSocket communication)
    if (!this.eventEmitter) {
      throw new Error(
        'EventEmitter2 is required for simulation mode but not available',
      );
    }

    // Check if ChatLogService is available (required for message logging)
    if (!this.chatLogService) {
      throw new Error(
        'ChatLogService is required for simulation mode but not available',
      );
    }

    // Validate that WebSocket gateway dependencies are available
    // Note: We can't directly check the gateway here, but we can verify the event emitter works
    try {
      // Test event emission capability
      this.eventEmitter.emit('whatsapp.test', { test: true });
      this.logger.log('✅ Event emitter is working correctly');
    } catch (error) {
      throw new Error(`Event emitter validation failed: ${error.message}`);
    }

    this.logger.log('✅ All simulator dependencies validated successfully');
  }

  /**
   * Validate production dependencies when not in simulation mode
   * Requirements: 6.4
   */
  private async validateProductionDependencies(): Promise<void> {
    const simulatorMode = this.config.get('WHATSAPP_SIMULATOR');
    const isSimulationMode = this.validateSimulationMode(simulatorMode);

    if (isSimulationMode) {
      return; // Skip validation if in simulation mode
    }

    this.logger.log('🔍 Validating production dependencies...');

    const phoneNumberId = this.config.get('WA_PHONE_NUMBER_ID');
    const accessToken = this.config.get('CLOUD_API_ACCESS_TOKEN');

    const errors: string[] = [];

    if (!phoneNumberId) {
      errors.push(
        'WA_PHONE_NUMBER_ID environment variable is required for production mode',
      );
    }

    if (!accessToken) {
      errors.push(
        'CLOUD_API_ACCESS_TOKEN environment variable is required for production mode',
      );
    }

    if (errors.length > 0) {
      const errorMessage = `Production configuration validation failed:\n${errors.map((err) => `  - ${err}`).join('\n')}`;
      this.logger.error('❌ ' + errorMessage);
      throw new Error(errorMessage);
    }

    this.logger.log('✅ All production dependencies validated successfully');
    this.logger.log(
      `   Phone Number ID: ${phoneNumberId ? '***configured***' : 'missing'}`,
    );
    this.logger.log(
      `   Access Token: ${accessToken ? '***configured***' : 'missing'}`,
    );
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ILike, Not, Repository } from 'typeorm';

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

// ✅ Reusable buttons
const MAIN_MENU_BUTTONS = [
  { id: 'service_request', title: 'Make service request' },
  { id: 'view_tenancy', title: 'View tenancy details' },
  { id: 'visit_site', title: 'Visit our website' },
];

@Injectable()
export class WhatsappBotService {
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
  ) {}

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

  async handleMessage(messages: IncomingMessage[]) {
    const message = messages[0];
    const from = message?.from;
    if (!from || !message) return;

    console.log('📱 Incoming WhatsApp message from:', from);
    console.log('📨 Full message object:', JSON.stringify(message, null, 2));

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
          await this.sendButtons(
            from,
            `Hello ${this.utilService.toSentenceCase(user?.first_name || '')}, What do you want to do today?`,
            [
              { id: 'view_properties', title: 'View properties' },
              { id: 'view_maintenance', title: 'Maintenance' },
              { id: 'new_tenant', title: 'Add tenant' },
            ],
          );
        }
        return; // Don't continue with role detection
      }
    }

    // CRITICAL FIX: Try both phone number formats
    // WhatsApp sends international format (2348184350211)
    // But DB might have local format (08184350211)
    const normalizedPhone = this.utilService.normalizePhoneNumber(from);
    const localPhone = from.startsWith('234') ? '0' + from.slice(3) : from;

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
        `${serviceRequest.description}\n\nTenant: ${this.utilService.toSentenceCase(serviceRequest.tenant.user.first_name)} ${this.utilService.toSentenceCase(serviceRequest.tenant.user.last_name)}\nProperty: ${serviceRequest.property.name}\nStatus: ${statusLabel}\n\nReply "Resolved" to mark it as fixed.\nReply "Back" to go to the list.`,
      );

      await this.cache.set(
        `service_request_state_facility_${from}`,
        `viewing_request:${serviceRequest.id}`,
        this.SESSION_TIMEOUT_MS,
      );
      return;
    }

    // Handle marking request as resolved
    if (facilityState && facilityState.startsWith('viewing_request:')) {
      const requestId = facilityState.split('viewing_request:')[1];

      if (text.toLowerCase() === 'resolved') {
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

        await this.serviceRequestService.updateStatus(
          serviceRequest.id,
          ServiceRequestStatusEnum.RESOLVED,
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
        return;
      } else if (text.toLowerCase() === 'back') {
        // Go back to list
        await this.sendButtons(from, 'What would you like to do?', [
          { id: 'service_request', title: 'View all requests' },
          { id: 'view_account_info', title: 'View Account Info' },
        ]);
        await this.cache.delete(`service_request_state_facility_${from}`);
        return;
      } else {
        await this.sendText(
          from,
          'Please reply "Resolved" to mark as fixed, or "Back" to return to the list.',
        );
        return;
      }
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

      serviceRequest.status = ServiceRequestStatusEnum.IN_PROGRESS;
      await this.serviceRequestRepo.save(serviceRequest);
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
          const statusLabel =
            req.status === ServiceRequestStatusEnum.OPEN
              ? 'Open'
              : req.status === ServiceRequestStatusEnum.RESOLVED
                ? 'Resolved'
                : req.status === ServiceRequestStatusEnum.REOPENED
                  ? 'Reopened'
                  : req.status === ServiceRequestStatusEnum.IN_PROGRESS
                    ? 'In Progress'
                    : req.status;
          response += `${i + 1}. ${req.description} — ${statusLabel}\n`;
        });

        response += '\nReply with a number to view details.';

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

      default:
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
          { id: 'service_request', title: 'Make service request' },
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
      const localPhone = from.startsWith('234') ? '0' + from.slice(3) : from;

      const user = await this.usersRepo.findOne({
        where: [
          { phone_number: from, accounts: { role: RolesEnum.TENANT } },
          {
            phone_number: normalizedPhone,
            accounts: { role: RolesEnum.TENANT },
          },
          { phone_number: localPhone, accounts: { role: RolesEnum.TENANT } },
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
            });

            // await this.sendButtons(
            //   manager.phone_number,
            //   `Confirm request for request_id: ${request_id}`,
            //   [
            //     {
            //       id: 'acknowledge_request',
            //       title: 'Acknowledge',
            //     },
            //   ],
            // );

            // Add delay (e.g., 2 seconds)
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }

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
            });

            // Store context: this notification was sent to a landlord
            await this.cache.set(
              `notification_role_${admin_phone_number}`,
              'LANDLORD',
              24 * 60 * 60 * 1000, // 24 hours
            );
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
      const localPhone = from.startsWith('234') ? '0' + from.slice(3) : from;

      const user = await this.usersRepo.findOne({
        where: [
          { phone_number: from, accounts: { role: RolesEnum.TENANT } },
          {
            phone_number: normalizedPhone,
            accounts: { role: RolesEnum.TENANT },
          },
          { phone_number: localPhone, accounts: { role: RolesEnum.TENANT } },
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
            { id: 'service_request', title: 'Make service request' },
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
            { id: 'view_maintenance', title: 'maintenance requests' },
            { id: 'new_tenant', title: 'Add new tenant' },
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
        // FIXED: Use multi-format phone lookup
        const normalizedPhoneViewTenancy =
          this.utilService.normalizePhoneNumber(from);
        const localPhoneViewTenancy = from.startsWith('234')
          ? '0' + from.slice(3)
          : from;

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
          ],
          relations: ['accounts'],
        });

        if (!user?.accounts?.length) {
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

        await this.sendText(from, 'Here are your properties:');
        for (const [i, item] of properties.entries()) {
          const rent = item.property.rents[0];
          await this.sendText(
            from,
            `Property ${i + 1}: ${item.property.name}\n Amount: ${rent.rental_price.toLocaleString(
              'en-NG',
              {
                style: 'currency',
                currency: 'NGN',
              },
            )}\n Due Date: ${new Date(rent.lease_end_date).toLocaleDateString()}`,
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
            { tenant: { user: { phone_number: from } } },
            { tenant: { user: { phone_number: normalizedPhoneViewService } } },
            { tenant: { user: { phone_number: localPhoneViewService } } },
          ],
          relations: ['tenant'],
          order: { created_at: 'DESC' },
        });

        if (!serviceRequests.length) {
          await this.sendText(from, "You don't have any service requests yet.");
          return;
        }

        let response = 'Here are your recent service requests:\n';
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
          const statusEmoji =
            req.status === ServiceRequestStatusEnum.OPEN
              ? '(Open)'
              : req.status === ServiceRequestStatusEnum.RESOLVED
                ? '(Resolved)'
                : req.status === ServiceRequestStatusEnum.CLOSED
                  ? '(Closed)'
                  : req.status === ServiceRequestStatusEnum.REOPENED
                    ? '(Reopened)'
                    : '';
          response += `• ${formattedDate}, ${formattedTime} – ${req.description} ${statusEmoji}\n`;
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
          ],
          relations: ['accounts'],
        });

        if (!userNewRequest?.accounts?.length) {
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
              { id: 'service_request', title: 'Make service request' },
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
    property_name,
  }: {
    phone_number: string;
    tenant_name: string;
    landlord_name: string;
    property_name?: string;
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
                parameter_name: 'property_name',
                text: property_name || 'your property',
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
    property_name,
  }: {
    phone_number: string;
    tenant_name: string;
    landlord_name: string;
    property_name: string;
  }) {
    // Use the existing tenant welcome template
    await this.sendTenantWelcomeTemplate({
      phone_number,
      tenant_name,
      landlord_name,
      property_name,
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

  async sendFacilityServiceRequest({
    phone_number,
    manager_name,
    property_name,
    property_location,
    service_request,
    tenant_name,
    tenant_phone_number,
    date_created,
  }) {
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
      const phoneNumberId = this.config.get('WA_PHONE_NUMBER_ID');
      if (!phoneNumberId) {
        throw new Error('WhatsApp phone number ID is not configured.');
      }
      const response = await fetch(
        `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.get('CLOUD_API_ACCESS_TOKEN')}`,
          },
          body: JSON.stringify(payload),
        },
      );

      const data = await response.json();
      console.log('Response from WhatsApp API:', data);
      console.log('Response status:', response.status);

      if (!response.ok) {
        console.error('WhatsApp API Error:', data);
        throw new Error(`WhatsApp API Error: ${JSON.stringify(data)}`);
      }

      return data;
    } catch (error) {
      console.error('Error sending to WhatsApp API:', error);
      throw error;
    }
  }
}

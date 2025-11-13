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

    console.log('👤 User lookup result:', {
      found: !!user,
      userId: user?.id,
      userName: user ? `${user.first_name} ${user.last_name}` : 'N/A',
      phoneNumber: user?.phone_number,
      userTableRole: user?.role,
      accountsCount: user?.accounts?.length || 0,
      accountsIsArray: Array.isArray(user?.accounts),
      accountsRaw: user?.accounts,
      accounts: user?.accounts?.map((acc) => ({
        id: acc.id,
        role: acc.role,
        email: acc.email,
      })),
    });

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

    // FIXED: Check account role instead of user role
    // Users can have multiple accounts with different roles
    // Priority: LANDLORD > FACILITY_MANAGER > TENANT
    let role = user?.role; // Fallback to user.role if no accounts

    if (user?.accounts && user.accounts.length > 0) {
      console.log('🔍 Checking accounts for role...', {
        totalAccounts: user.accounts.length,
        accountRoles: user.accounts.map((acc) => acc.role),
        lookingFor: {
          landlord: RolesEnum.LANDLORD,
          facilityManager: RolesEnum.FACILITY_MANAGER,
          tenant: RolesEnum.TENANT,
        },
      });

      // Check for landlord account first
      const landlordAccount = user.accounts.find(
        (acc) => acc.role === RolesEnum.LANDLORD,
      );
      if (landlordAccount) {
        console.log('✅ Found LANDLORD account:', landlordAccount.id);
        role = RolesEnum.LANDLORD;
      } else {
        // Check for facility manager account
        const facilityAccount = user.accounts.find(
          (acc) => acc.role === RolesEnum.FACILITY_MANAGER,
        );
        if (facilityAccount) {
          console.log('✅ Found FACILITY_MANAGER account:', facilityAccount.id);
          role = RolesEnum.FACILITY_MANAGER;
        } else {
          // Check for tenant account
          const tenantAccount = user.accounts.find(
            (acc) => acc.role === RolesEnum.TENANT,
          );
          if (tenantAccount) {
            console.log('✅ Found TENANT account:', tenantAccount.id);
            role = RolesEnum.TENANT;
          } else {
            console.log('❌ No matching account role found!', {
              accountRoles: user.accounts.map((acc) => ({
                role: acc.role,
                typeOf: typeof acc.role,
              })),
            });
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
        if (message.type === 'interactive') {
          this.handleFacilityInteractive(message, from);
        }

        if (message.type === 'text') {
          console.log('in facility');
          this.handleFacilityText(message, from);
        }

        break;
      case RolesEnum.TENANT:
        console.log('In tenant');
        if (message.type === 'interactive') {
          this.handleInteractive(message, from);
        }

        if (message.type === 'text') {
          this.handleText(message, from);
        }
        break;
      case RolesEnum.LANDLORD:
        console.log('In Landlord');
        if (message.type === 'interactive') {
          this.flow.handleInteractive(message, from);
        }

        if (message.type === 'text') {
          this.flow.handleText(from, message.text?.body as any);
        }

        break;
      default:
        console.log('⚠️ Routing to DEFAULT handler (unrecognized role):', {
          role,
          messageType: message.type,
          from,
        });
        if (message.type === 'interactive') {
          this.handleDefaultInteractive(message, from);
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
      let option = default_state.split('property_owner_options')[1].slice(1);

      let waitlist = this.waitlistRepo.create({
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
      let [referral_name, referral_phone_number] = text.trim().split(':');

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
      serviceRequest.status = ServiceRequestStatusEnum.RESOLVED;
      serviceRequest.resolution_date = new Date();
      await this.serviceRequestRepo.save(serviceRequest);
      await this.sendText(
        from,
        `You have resolved service request ID: ${requestId}`,
      );
      await this.sendText(
        this.utilService.normalizePhoneNumber(
          serviceRequest.tenant.user.phone_number,
        ),
        `Your service request with ID: ${requestId} has been resolved by ${this.utilService.toSentenceCase(
          serviceRequest.facilityManager.account.profile_name,
        )}.`,
      );
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
            { id: 'service_request', title: 'Resolve request' },
            { id: 'view_account_info', title: 'View Account Info' },
            { id: 'visit_site', title: 'Visit our website' },
          ],
        );
      }
    }
  }

  async handleFacilityInteractive(message: any, from: string) {
    const buttonReply = message.interactive?.button_reply;
    if (!buttonReply) return;

    switch (buttonReply.id) {
      case 'service_request':
        let teamMemberInfo = await this.teamMemberRepo.findOne({
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
            status: Not(ServiceRequestStatusEnum.RESOLVED),
          },
        });

        let response = 'Here are the service requests:\n';
        serviceRequests.forEach((req: any, i) => {
          response += `- Request Id ${req.request_id} - \n Description: ${
            req.description
          }\n - Status: ${req.status}\n\n`;
        });

        await this.sendText(from, response);

        await this.cache.set(
          `service_request_state_facility_${from}`,
          'resolve-or-update',
          this.SESSION_TIMEOUT_MS, // now in ms,
        );

        await this.sendText(
          from,
          'Please type "update" to give update on the tenant request or "resolve" to resolve a request.',
        );
        break;

      case 'view_account_info':
        let teamMemberAccountInfo = await this.teamMemberRepo.findOne({
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

    console.log(text, 'tenant');

    if (text?.toLowerCase() === 'menu') {
      await this.sendButtons(from, 'Menu Options', [
        { id: 'service_request', title: 'Make service request' },
        { id: 'view_tenancy', title: 'View tenancy details' },
        // {
        //   id: 'view_notices_and_documents',
        //   title: 'See notices and documents',
        // },
        { id: 'visit_site', title: 'Visit our website' },
      ]);
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

    if (userState === 'awaiting_description') {
      const user = await this.usersRepo.findOne({
        where: {
          phone_number: `${from}`,
          accounts: { role: RolesEnum.TENANT },
        },
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
          } = new_service_request as any;
          await this.sendText(from, '✅ Your service request has been logged.');
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
                second: '2-digit',
                hour12: true,
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
                second: '2-digit',
                hour12: true,
              }),
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
      const serviceRequests = await this.serviceRequestRepo.find({
        where: {
          tenant: { user: { phone_number: `${from}` } },
          description: ILike(`%${text}%`),
        },
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
      const user = await this.usersRepo.findOne({
        where: {
          phone_number: `${from}`,
          accounts: { role: RolesEnum.TENANT },
        },
        relations: ['accounts'],
      });

      if (!user) {
        await this.sendToAgentWithTemplate(from);
      } else {
        await this.sendButtons(
          from,
          `Hello ${this.utilService.toSentenceCase(
            user.first_name,
          )} Welcome to Lizt by Property Kraft! What would you like to do today?`,
          [
            { id: 'service_request', title: 'Make service request' },
            { id: 'view_tenancy', title: 'View tenancy details' },
            // {
            //   id: 'view_notices_and_documents',
            //   title: 'See notices and documents',
            // },
            { id: 'visit_site', title: 'Visit our website' },
          ],
        );
      }
    }
  }

  async handleInteractive(message: any, from: string) {
    const buttonReply = message.interactive?.button_reply;
    if (!buttonReply) return;
    console.log(buttonReply.id, 'bID');

    switch (buttonReply.id) {
      case 'visit_site':
        await this.sendText(
          from,
          'Visit our website: https://propertykraft.africa',
        );
        break;

      case 'view_tenancy':
        const user = await this.usersRepo.findOne({
          where: {
            phone_number: `${from}`,
            accounts: { role: RolesEnum.TENANT },
          },
          relations: ['accounts'],
        });

        if (!user?.accounts?.length) {
          await this.sendText(from, 'No tenancy info available.');
          return;
        }

        const accountId = user.accounts[0].id;
        // const tenancy =
        //   await this.userService.getTenantAndPropertyInfo(accountId);

        const properties = await this.propertyTenantRepo.find({
          where: { tenant_id: accountId },
          relations: ['property', 'property.rents'],
        });

        if (!properties?.length) {
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

      case 'service_request':
        await this.sendButtons(from, 'What would you like to do?', [
          {
            id: 'new_service_request',
            title: 'New Request',
          },
          {
            id: 'view_service_request',
            title: 'Previous Requests',
          },
        ]);
        break;

      case 'view_service_request':
        const serviceRequests = await this.serviceRequestRepo.find({
          where: { tenant: { user: { phone_number: `${from}` } } },
          relations: ['tenant'],
        });

        if (!serviceRequests.length) {
          await this.sendText(from, 'You have no service requests.');
          return;
        }

        let response = 'Here are your recent maintenance requests:\n';
        serviceRequests.forEach((req: any, i) => {
          response += `${new Date(req.created_at).toLocaleDateString()} - \n Description: ${req.description}\n`;
        });

        await this.sendText(from, response);

        await this.cache.set(
          `service_request_state_${from}`,
          'view_single_service_request',
          this.SESSION_TIMEOUT_MS, // now in ms,
        );
        await this.sendText(
          from,
          'Type your service request description to view more info on service request or "done" to finish.',
        );
        break;

      case 'new_service_request':
        await this.cache.set(
          `service_request_state_${from}`,
          'awaiting_description',
          this.SESSION_TIMEOUT_MS, // now in ms,
        );
        await this.sendText(from, 'Please describe the issue you are facing.');
        break;

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
        name: 'facility_service_request', // Your template name
        language: {
          code: 'en', // must match the language you set in WhatsApp template
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                parameter_name: 'manager_name',
                text: manager_name,
              },
              {
                type: 'text',
                parameter_name: 'property_name',
                text: property_name,
              },
              {
                type: 'text',
                parameter_name: 'property_location',
                text: property_location,
              },
              {
                type: 'text',
                parameter_name: 'service_request',
                text: service_request,
              },
              {
                type: 'text',
                parameter_name: 'tenant_name',
                text: tenant_name,
              },
              {
                type: 'text',
                parameter_name: 'tenant_phone_number',
                text: tenant_phone_number,
              },
              {
                type: 'text',
                parameter_name: 'date_created',
                text: date_created,
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
  ) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text },
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

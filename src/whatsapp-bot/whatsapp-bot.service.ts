import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ILike, Not, In, Repository } from 'typeorm';
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
import {
  KYCApplication,
  ApplicationStatus,
} from 'src/kyc-links/entities/kyc-application.entity';
import {
  TemplateSenderService,
  SendTemplateParams,
  FMTemplateParams,
  PropertyCreatedParams,
  UserAddedParams,
  TenantWelcomeParams,
  TenantConfirmationParams,
  TenantAttachmentParams,
  KYCApplicationNotificationParams,
  KYCSubmissionConfirmationParams,
  AgentKYCNotificationParams,
  FacilityServiceRequestParams,
  KYCCompletionLinkParams,
  KYCCompletionNotificationParams,
  ButtonDefinition,
} from './template-sender';
import { TenantFlowService } from './tenant-flow';
import { LandlordFlowService } from './landlord-flow';

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

    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepo: Repository<KYCApplication>,

    private readonly flow: LandlordFlow,

    private readonly serviceRequestService: ServiceRequestsService,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
    private readonly utilService: UtilService,
    private readonly chatLogService: ChatLogService,
    private readonly eventEmitter: EventEmitter2,
    private readonly templateSenderService: TemplateSenderService,
    private readonly tenantFlowService: TenantFlowService,
    private readonly landlordFlowService: LandlordFlowService,
  ) {}

  /**
   * Module initialization - Add configuration validation and startup logging
   * Requirements: 6.1, 6.2, 6.3, 6.4
   */
  async onModuleInit() {
    this.logger.log('🚀 WhatsApp Bot Service initializing...');

    // Make EventEmitter available to WhatsappUtils
    const { WhatsappUtils } = await import('./utils/whatsapp');
    WhatsappUtils.setEventEmitter(this.eventEmitter);

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
   * Get normalized phone number format for lookup
   * All phone numbers are stored as 234XXXXXXXXXX in the database
   */
  private getPhoneNumberFormats(phoneNumber: string): string[] {
    const normalized = this.utilService.normalizePhoneNumber(phoneNumber);
    // Return just the normalized format since DB is now consistent
    return [normalized];
  }

  /**
   * Find user by phone number using normalized format
   */
  private async findUserByPhone(
    phoneNumber: string,
    role?: RolesEnum,
  ): Promise<Users | null> {
    const normalizedPhone = this.utilService.normalizePhoneNumber(phoneNumber);

    console.log('🔍 Phone number lookup:', {
      original: phoneNumber,
      normalized: normalizedPhone,
      role: role || 'any',
    });

    const whereCondition: any = { phone_number: normalizedPhone };
    if (role) {
      whereCondition.accounts = { role };
    }

    const user = await this.usersRepo.findOne({
      where: whereCondition,
      relations: ['accounts'],
    });

    console.log('👤 User lookup result:', {
      found: !!user,
      userId: user?.id,
      accountsCount: user?.accounts?.length || 0,
      matchedPhone: user?.phone_number,
      accountRoles: user?.accounts?.map((acc) => acc.role) || [],
    });

    return user;
  }

  /**
   * Find user by email address (for simulator)
   */
  private async findUserByEmail(
    email: string,
    role?: RolesEnum,
  ): Promise<Users | null> {
    console.log('📧 Email lookup:', {
      email,
      role: role || 'any',
    });

    // Look up user by account email
    const whereCondition: any = { email };
    if (role) {
      whereCondition.role = role;
    }

    const account = await this.accountRepo.findOne({
      where: whereCondition,
      relations: ['user'],
    });

    const user = account?.user || null;

    // CRITICAL: Populate the accounts array for role detection
    if (user && account) {
      user.accounts = [account];
    }

    console.log('👤 Email lookup result:', {
      found: !!user,
      userId: user?.id,
      userPhone: user?.phone_number,
      accountId: account?.id,
      accountRole: account?.role,
      accountsCount: user?.accounts?.length || 0,
    });

    return user;
  }

  /**
   * Convert email address to phone number for simulator mode
   * If the identifier is an email, look up the user's phone number
   * Otherwise, return the identifier as-is (assuming it's already a phone number)
   */
  private async getPhoneNumberFromIdentifier(
    identifier: string,
  ): Promise<string> {
    const isEmail = identifier.includes('@') && identifier.includes('.');

    if (isEmail) {
      console.log('🔄 Converting email to phone number for WhatsApp messaging');
      const user = await this.findUserByEmail(identifier);
      if (user?.phone_number) {
        const normalizedPhone = this.utilService.normalizePhoneNumber(
          user.phone_number,
        );
        console.log('📞 Converted email to phone:', {
          email: identifier,
          rawPhone: user.phone_number,
          normalizedPhone,
        });
        return normalizedPhone;
      } else {
        console.log('⚠️ Could not find phone number for email:', identifier);
        return identifier; // Fallback to original identifier
      }
    }

    return identifier; // Already a phone number
  }
  private async findUserByPhoneOrEmail(
    identifier: string,
    role?: RolesEnum,
  ): Promise<Users | null> {
    // Check if identifier looks like an email
    const isEmail = identifier.includes('@') && identifier.includes('.');

    if (isEmail) {
      console.log('🔍 Identifier appears to be email, using email lookup');
      return this.findUserByEmail(identifier, role);
    } else {
      console.log('🔍 Identifier appears to be phone, using phone lookup');
      return this.findUserByPhone(identifier, role);
    }
  }

  /**
   * Find KYC application by phone number using normalized format
   */
  private async findKYCApplicationByPhone(
    phoneNumber: string,
  ): Promise<KYCApplication | null> {
    const normalizedPhone = this.utilService.normalizePhoneNumber(phoneNumber);

    console.log('🔍 Looking up KYC application for phone:', {
      original: phoneNumber,
      normalized: normalizedPhone,
    });

    // Find the most recent pending or rejected application
    const application = await this.kycApplicationRepo.findOne({
      where: {
        phone_number: normalizedPhone,
        status: In([ApplicationStatus.PENDING, ApplicationStatus.REJECTED]),
      },
      order: { created_at: 'DESC' },
    });

    console.log('📋 KYC application lookup result:', {
      found: !!application,
      applicationId: application?.id,
      status: application?.status,
      applicantName: application
        ? `${application.first_name} ${application.last_name}`
        : 'N/A',
    });

    return application;
  }

  async handleMessage(messages: IncomingMessage[]) {
    console.log('🚀🚀🚀 handleMessage ENTRY POINT 🚀🚀🚀');
    console.log('📦 Raw messages array:', JSON.stringify(messages, null, 2));
    console.log('📦 Messages count:', messages?.length);

    const message = messages[0];
    const from = message?.from;

    console.log('📱 Extracted from:', from);
    console.log('📱 Message exists:', !!message);

    if (!from || !message) {
      console.log('❌❌❌ EARLY RETURN - no from or message ❌❌❌');
      console.log('   from:', from);
      console.log('   message:', message);
      return;
    }

    console.log('📱 Incoming WhatsApp message from:', from);
    console.log('📨 Full message object:', JSON.stringify(message, null, 2));
    console.log('📨 Message type:', message.type);
    console.log('📨 Message text:', message.text?.body);

    // NOTE: Inbound message logging is now handled by WebhookHandler.processIncomingMessage
    // to avoid duplicate database entries. This method now only processes the message logic.
    // DO NOT add logging here - it will duplicate messages when user refreshes the page.

    // CRITICAL: Check if this is a role selection button click BEFORE role detection
    const buttonReply =
      message.interactive?.button_reply || (message as any).button;
    const buttonId = buttonReply?.id || buttonReply?.payload;

    if (
      buttonId === 'select_role_fm' ||
      buttonId === 'select_role_landlord' ||
      buttonId === 'select_role_tenant'
    ) {
      console.log('🎯 Role selection button detected, handling directly');
      // Handle role selection in the appropriate handler based on message type
      if (message.type === 'interactive' || message.type === 'button') {
        // This will be handled by handleInteractive/handleFacilityInteractive
        // But we need to route it there without going through role detection
        const selectedRole =
          buttonId === 'select_role_fm'
            ? RolesEnum.FACILITY_MANAGER
            : buttonId === 'select_role_landlord'
              ? RolesEnum.LANDLORD
              : RolesEnum.TENANT;

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
        const user = await this.findUserByPhoneOrEmail(from);
        const userPhone = await this.getPhoneNumberFromIdentifier(from);

        if (selectedRole === RolesEnum.FACILITY_MANAGER) {
          await this.sendButtons(
            userPhone,
            `Hello Manager ${this.utilService.toSentenceCase(user?.first_name || '')} Welcome to Property Kraft! What would you like to do today?`,
            [
              { id: 'service_request', title: 'View requests' },
              { id: 'view_account_info', title: 'Account Info' },
              { id: 'visit_site', title: 'Visit website' },
            ],
          );
        } else if (selectedRole === RolesEnum.LANDLORD) {
          const landlordName = this.utilService.toSentenceCase(
            user?.first_name || 'there',
          );
          await this.sendLandlordMainMenu(userPhone, landlordName);
        } else {
          await this.sendButtons(
            userPhone,
            `Hello ${this.utilService.toSentenceCase(
              user?.first_name || '',
            )} What would you like to do?`,
            [
              { id: 'service_request', title: 'Service request' },
              { id: 'view_tenancy', title: 'View tenancy details' },
              { id: 'visit_site', title: 'Visit our website' },
            ],
            'Tap on any option to continue.',
          );
        }
        return; // Don't continue with role detection
      }
    }

    // CRITICAL FIX: Use unified lookup that handles both phone numbers and emails
    // WhatsApp sends international format (2348184350211) for real messages
    // But simulator might send email addresses for landlord chat
    console.log('🔍 Looking up user with identifier:', from);

    const user = await this.findUserByPhoneOrEmail(from);

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
        const hasTenant = user.accounts.some(
          (acc) => acc.role === RolesEnum.TENANT,
        );

        if (hasMultipleRoles && (hasFM || hasLandlord || hasTenant)) {
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
          if (hasTenant) {
            roleButtons.push({ id: 'select_role_tenant', title: 'Tenant' });
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
      case RolesEnum.FACILITY_MANAGER: {
        console.log('Facility Manager Message');

        // Convert email to phone number for WhatsApp messaging
        const facilityManagerPhone =
          await this.getPhoneNumberFromIdentifier(from);

        // Delegate to LandlordFlowService
        // Requirements: 3.5
        if (message.type === 'interactive' || message.type === 'button') {
          void this.landlordFlowService.handleFacilityInteractive(
            message,
            facilityManagerPhone,
          );
        }

        if (message.type === 'text') {
          console.log('in facility');
          void this.landlordFlowService.handleFacilityText(
            message,
            facilityManagerPhone,
          );
        }

        break;
      }
      case RolesEnum.TENANT: {
        console.log('In tenant');

        // Convert email to phone number for WhatsApp messaging
        const tenantPhone = await this.getPhoneNumberFromIdentifier(from);

        // Delegate to TenantFlowService
        // Requirements: 2.5
        if (message.type === 'interactive' || message.type === 'button') {
          void this.tenantFlowService.handleInteractive(message, tenantPhone);
        }

        if (message.type === 'text') {
          void this.tenantFlowService.handleText(message, tenantPhone);
        }
        break;
      }
      case RolesEnum.LANDLORD: {
        console.log('In Landlord');

        // Convert email to phone number for WhatsApp messaging
        const landlordPhone = await this.getPhoneNumberFromIdentifier(from);

        if (message.type === 'interactive' || message.type === 'button') {
          void this.flow.handleInteractive(message, landlordPhone);
        }

        if (message.type === 'text') {
          void this.flow.handleText(landlordPhone, message.text?.body as any);
        }

        break;
      }
      default: {
        console.log('⚠️ Routing to DEFAULT handler (unrecognized role):', {
          role,
          messageType: message.type,
          from,
        });

        // Convert email to phone number for WhatsApp messaging
        const defaultPhone = await this.getPhoneNumberFromIdentifier(from);

        // Check if this is a KYC applicant (tenant who submitted application but not yet approved)
        const kycApplication = await this.findKYCApplicationByPhone(from);

        if (kycApplication) {
          console.log('📋 Found KYC application for user:', {
            applicationId: kycApplication.id,
            status: kycApplication.status,
            applicantName: `${kycApplication.first_name} ${kycApplication.last_name}`,
          });

          // Handle KYC applicant based on application status
          await this.handleKYCApplicantMessage(defaultPhone, kycApplication);
          return;
        }

        if (message.type === 'interactive') {
          void this.handleDefaultInteractive(message, defaultPhone);
        }

        if (message.type === 'text') {
          void this.handleDefaultText(message, defaultPhone);
        }
      }
    }
  }

  /**
   * Handle messages from KYC applicants (prospective tenants who submitted applications)
   * Responds based on application status: pending or rejected
   */
  private async handleKYCApplicantMessage(
    phone: string,
    application: KYCApplication,
  ): Promise<void> {
    const applicantName = application.first_name || 'there';

    switch (application.status) {
      case ApplicationStatus.PENDING:
      case ApplicationStatus.PENDING_COMPLETION:
        console.log('📋 Responding to PENDING KYC applicant:', applicantName);
        await this.sendText(
          phone,
          `Thanks for reaching out, ${applicantName}!\n\nYour landlord is still reviewing your KYC and will get back to you.`,
        );
        break;

      case ApplicationStatus.REJECTED:
        console.log('📋 Responding to REJECTED KYC applicant:', applicantName);
        await this.sendText(
          phone,
          `Thanks for your message, ${applicantName}.\n\nUnfortunately, this property is no longer available on the market.`,
        );
        break;

      default:
        // This shouldn't happen since we only query for pending/rejected
        console.log(
          '⚠️ Unexpected KYC application status:',
          application.status,
        );
        break;
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

      const normalizedFrom = this.utilService.normalizePhoneNumber(from);
      const waitlist = await this.waitlistRepo.findOne({
        where: { phone_number: normalizedFrom },
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

  // ============================================================================
  // LANDLORD/FACILITY MANAGER FLOW DELEGATION METHODS
  // These methods delegate to LandlordFlowService for backward compatibility
  // Requirements: 3.5
  // ============================================================================

  /**
   * Handle text messages from facility managers
   * Delegates to LandlordFlowService
   */
  async handleFacilityText(
    message: IncomingMessage,
    from: string,
  ): Promise<void> {
    return this.landlordFlowService.handleFacilityText(message, from);
  }

  /**
   * Handle cached response for facility manager session state
   * Delegates to LandlordFlowService
   */
  async cachedFacilityResponse(from: string, text: string): Promise<void> {
    return this.landlordFlowService.cachedFacilityResponse(from, text);
  }

  /**
   * Handle interactive button messages from facility managers
   * Delegates to LandlordFlowService
   */
  async handleFacilityInteractive(
    message: IncomingMessage,
    from: string,
  ): Promise<void> {
    return this.landlordFlowService.handleFacilityInteractive(message, from);
  }

  // ============================================================================
  // TENANT FLOW DELEGATION METHODS
  // These methods delegate to TenantFlowService for backward compatibility
  // Requirements: 2.5
  // ============================================================================

  /**
   * Handle text messages from tenants
   * Delegates to TenantFlowService
   */
  async handleText(message: IncomingMessage, from: string): Promise<void> {
    return this.tenantFlowService.handleText(message, from);
  }

  /**
   * Handle cached response for tenant session state
   * Delegates to TenantFlowService
   */
  async cachedResponse(from: string, text: string): Promise<void> {
    return this.tenantFlowService.cachedResponse(from, text);
  }

  /**
   * Handle interactive button messages from tenants
   * Delegates to TenantFlowService
   */
  async handleInteractive(
    message: IncomingMessage,
    from: string,
  ): Promise<void> {
    return this.tenantFlowService.handleInteractive(message, from);
  }

  // ============================================================================
  // TEMPLATE SENDER DELEGATION METHODS
  // These methods delegate to TemplateSenderService for backward compatibility
  // Requirements: 1.4, 10.4, 10.5
  // ============================================================================

  async sendWhatsappMessageWithTemplate(
    params: SendTemplateParams,
  ): Promise<void> {
    return this.templateSenderService.sendWhatsappMessageWithTemplate(params);
  }

  async sendToUserWithTemplate(
    phone_number: string,
    customer_name: string,
  ): Promise<void> {
    return this.templateSenderService.sendToUserWithTemplate(
      phone_number,
      customer_name,
    );
  }

  async sendToAgentWithTemplate(phone_number: string): Promise<void> {
    return this.templateSenderService.sendToAgentWithTemplate(phone_number);
  }

  async sendToFacilityManagerWithTemplate(
    params: FMTemplateParams,
  ): Promise<void> {
    return this.templateSenderService.sendToFacilityManagerWithTemplate(params);
  }

  async sendToPropertiesCreatedTemplate(
    params: PropertyCreatedParams,
  ): Promise<void> {
    return this.templateSenderService.sendToPropertiesCreatedTemplate(params);
  }

  async sendUserAddedTemplate(params: UserAddedParams): Promise<void> {
    return this.templateSenderService.sendUserAddedTemplate(params);
  }

  async sendTenantWelcomeTemplate(params: TenantWelcomeParams): Promise<void> {
    return this.templateSenderService.sendTenantWelcomeTemplate(params);
  }

  async sendTenantConfirmationTemplate(
    params: TenantConfirmationParams,
  ): Promise<void> {
    return this.templateSenderService.sendTenantConfirmationTemplate(params);
  }

  /**
   * Send tenant attachment confirmation via WhatsApp
   * Delegates to TemplateSenderService
   */
  async sendTenantAttachmentNotification(
    params: TenantAttachmentParams,
  ): Promise<void> {
    return this.templateSenderService.sendTenantAttachmentNotification(params);
  }

  /**
   * Send KYC application notification to landlord via WhatsApp
   * Delegates to TemplateSenderService
   */
  async sendKYCApplicationNotification(
    params: KYCApplicationNotificationParams,
  ): Promise<void> {
    return this.templateSenderService.sendKYCApplicationNotification(params);
  }

  /**
   * Send KYC submission confirmation to tenant via WhatsApp
   * Delegates to TemplateSenderService
   */
  async sendKYCSubmissionConfirmation(
    params: KYCSubmissionConfirmationParams,
  ): Promise<void> {
    return this.templateSenderService.sendKYCSubmissionConfirmation(params);
  }

  /**
   * Send KYC application notification to referral agent via WhatsApp
   * Delegates to TemplateSenderService
   */
  async sendAgentKYCNotification(
    params: AgentKYCNotificationParams,
  ): Promise<void> {
    return this.templateSenderService.sendAgentKYCNotification(params);
  }

  async sendFacilityServiceRequest(
    params: FacilityServiceRequestParams,
  ): Promise<void> {
    return this.templateSenderService.sendFacilityServiceRequest(params);
  }

  /**
   * Send KYC completion link to existing tenant via WhatsApp
   * Delegates to TemplateSenderService
   */
  async sendKYCCompletionLink(params: KYCCompletionLinkParams): Promise<void> {
    return this.templateSenderService.sendKYCCompletionLink(params);
  }

  /**
   * Send KYC completion notification to landlord via WhatsApp
   * Delegates to TemplateSenderService
   */
  async sendKYCCompletionNotification(
    params: KYCCompletionNotificationParams,
  ): Promise<void> {
    return this.templateSenderService.sendKYCCompletionNotification(params);
  }

  async sendText(to: string, text: string): Promise<void> {
    return this.templateSenderService.sendText(to, text);
  }

  async sendButtons(
    to: string,
    text: string = 'Hello, welcome to Property Kraft',
    buttons: ButtonDefinition[],
    footer?: string,
  ): Promise<void> {
    return this.templateSenderService.sendButtons(to, text, buttons, footer);
  }

  /**
   * Send landlord main menu with URL buttons
   * Delegates to TemplateSenderService
   */
  async sendLandlordMainMenu(to: string, landlordName: string): Promise<void> {
    return this.templateSenderService.sendLandlordMainMenu(to, landlordName);
  }

  async sendFlow(recipientNumber: string): Promise<void> {
    return this.templateSenderService.sendFlow(recipientNumber);
  }

  /**
   * Core method to send messages to WhatsApp API
   * Delegates to TemplateSenderService
   */
  async sendToWhatsappAPI(payload: object): Promise<unknown> {
    return this.templateSenderService.sendToWhatsappAPI(payload as any);
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

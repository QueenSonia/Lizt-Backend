import { forwardRef, Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ArrayContains, ILike, Not, In, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import WhatsApp from 'whatsapp';
import { Users } from 'src/users/entities/user.entity';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import { CacheService } from 'src/lib/cache';
import {
  PasswordService,
  PASSWORD_RULE_REGEX,
  PASSWORD_RULE_MESSAGE,
} from 'src/users/password';

import { SCREEN_RESPONSES } from './flows';
import { RolesEnum } from 'src/base.entity';
import { UsersService } from 'src/users/users.service';
import { MaintenanceRequestStatusEnum } from 'src/maintenance-requests/dto/create-maintenance-request.dto';
import { UtilService } from 'src/utils/utility-service';
import { IncomingMessage } from './utils';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { MaintenanceRequestsService } from 'src/maintenance-requests/maintenance-requests.service';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { PropertiesService } from 'src/properties/properties.service';
import { Waitlist } from 'src/users/entities/waitlist.entity';
import { Property } from 'src/properties/entities/property.entity';
import { TenantStatusEnum } from 'src/properties/dto/create-property.dto';
import { Account, accountHasRole } from 'src/users/entities/account.entity';
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
  FMSetPasswordFlowParams,
  PropertyCreatedParams,
  UserAddedParams,
  TenantWelcomeParams,
  TenantConfirmationParams,
  TenantAttachmentParams,
  KYCApplicationNotificationParams,
  KYCSubmissionConfirmationParams,
  AgentKYCNotificationParams,
  FacilityMaintenanceRequestParams,
  KYCCompletionLinkParams,
  KYCCompletionNotificationParams,
  ButtonDefinition,
} from './template-sender';
import { TenantFlowService } from './tenant-flow';
import { LandlordFlowService } from './landlord-flow';
import { FlowTokenService, FlowTokenPayload } from './flow-token.service';
import { FlowMediaRef } from './whatsapp-media.service';
import { UnknownsAiService } from './unknowns-ai.service';

// ✅ Reusable buttons
const MAIN_MENU_BUTTONS = [
  { id: 'maintenance_request', title: 'Maintenance request' },
  { id: 'view_tenancy', title: 'View tenancy details' },
  { id: 'payment', title: 'Payment' },
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

    @InjectRepository(MaintenanceRequest)
    private readonly maintenanceRequestRepo: Repository<MaintenanceRequest>,

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

    private readonly maintenanceRequestService: MaintenanceRequestsService,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
    private readonly utilService: UtilService,
    private readonly chatLogService: ChatLogService,
    private readonly eventEmitter: EventEmitter2,
    private readonly templateSenderService: TemplateSenderService,
    private readonly tenantFlowService: TenantFlowService,
    private readonly landlordFlowService: LandlordFlowService,

    // UsersModule is already a forwardRef in WhatsappBotModule; PasswordService
    // lives there. Used by the FM password-setup Flow webhook (getNextScreen).
    @Inject(forwardRef(() => PasswordService))
    private readonly passwordService: PasswordService,

    private readonly flowTokenService: FlowTokenService,

    private readonly unknownsAiService: UnknownsAiService,
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
    const { screen, data, action, flow_token: flowToken } = decryptedBody;

    console.log('Received request body:', decryptedBody);

    if (action === 'ping') {
      return { data: { status: 'active' } };
    }

    if (data?.error) {
      console.warn('Received client error:', data);
      return { data: { acknowledged: true } };
    }

    // Tenant maintenance-request Flow. Its flow_token is a cache-backed opaque
    // token (FlowTokenService); FM password tokens are DB-backed and won't
    // resolve here, so they fall through to the FM logic below.
    if (flowToken) {
      const tokenPayload = await this.flowTokenService.resolve(flowToken);
      if (tokenPayload) {
        return this.handleTenantMaintenanceFlow(
          action,
          screen,
          data,
          tokenPayload,
        );
      }
    }

    // FM password-setup Flow: the flow_token is the PasswordResetToken value
    // minted in team.service.ts. On INIT, route to FM_LINK_EXPIRED instead of
    // Meta's generic 427 "message no longer available" copy when the token is
    // gone (expired or consumed by a successful prior submit).
    if (action === 'INIT' && flowToken) {
      const valid = await this.passwordService.isResetTokenStillValid(flowToken);
      if (valid) {
        return {
          ...SCREEN_RESPONSES.FM_SET_PASSWORD,
          data: { error_message: '', error_visible: false },
        };
      }
      // Token unknown/expired AND a flow_token was supplied: this is almost
      // certainly an FM invite click after the link expired (or after a
      // successful set — token was deleted). Show the friendly expired
      // screen.
      return { ...SCREEN_RESPONSES.FM_LINK_EXPIRED };
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
        case 'FM_SET_PASSWORD': {
          const newPassword = data?.new_password;
          const confirmPassword = data?.confirm_password;

          if (!newPassword || newPassword !== confirmPassword) {
            return {
              ...SCREEN_RESPONSES.FM_SET_PASSWORD,
              data: {
                error_message: 'Passwords do not match. Please try again.',
                error_visible: true,
              },
            };
          }

          // Enforce the same complexity rule as the HTTP /reset-password and
          // signup paths. Without this, the Flow would let the FM set a weak
          // password that they then can't use to log in (the login endpoint
          // validates the rule via class-validator and rejects).
          if (!PASSWORD_RULE_REGEX.test(newPassword)) {
            return {
              ...SCREEN_RESPONSES.FM_SET_PASSWORD,
              data: {
                error_message: PASSWORD_RULE_MESSAGE,
                error_visible: true,
              },
            };
          }

          const valid = await this.passwordService.isResetTokenStillValid(flowToken);
          if (!valid) {
            return { ...SCREEN_RESPONSES.FM_LINK_EXPIRED };
          }

          try {
            await this.passwordService.resetPasswordCore(
              flowToken,
              newPassword,
            );
          } catch (err) {
            this.logger.error('FM password reset failed', err as Error);
            return {
              ...SCREEN_RESPONSES.FM_SET_PASSWORD,
              data: {
                error_message:
                  'Something went wrong saving your password. Please try again.',
                error_visible: true,
              },
            };
          }

          // Welcome text is sent later, when the FM clicks "Done" on the
          // terminal screen and Meta posts an `nfm_reply` webhook. That path
          // is the only one with a guaranteed-open 24h customer service
          // window. See WebhookHandler.processIncomingMessage.
          return { ...SCREEN_RESPONSES.FM_PASSWORD_SUCCESS };
        }

        case 'WELCOME_SCREEN':
          return { ...SCREEN_RESPONSES.MAINTENANCE_REQUEST };

        case 'MAINTENANCE_REQUEST':
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
   * Tenant maintenance-request Flow handler. On INIT returns the REPORT_ISSUE
   * form seeded from the token; on the form submit it creates (or reopens) the
   * request, kicks off async photo ingest, arms the video window if asked, and
   * returns the MR_SUCCESS terminal screen with the real ticket number.
   */
  private async handleTenantMaintenanceFlow(
    action: string,
    screen: string,
    data: Record<string, any> | undefined,
    payload: FlowTokenPayload,
  ): Promise<any> {
    if (action === 'INIT') {
      const properties =
        payload.mode === 'create' ? payload.properties : [];
      return {
        screen: 'REPORT_ISSUE',
        data: {
          mode: payload.mode,
          heading:
            payload.mode === 'reopen'
              ? "Tell us what's still wrong"
              : 'Report a maintenance issue',
          description_label:
            payload.mode === 'reopen'
              ? 'What still needs fixing?'
              : 'Describe the issue',
          has_multiple_properties:
            payload.mode === 'create' && properties.length > 1,
          properties,
          error_message: '',
          error_visible: false,
        },
      };
    }

    if (action === 'data_exchange' && screen === 'REPORT_ISSUE') {
      return this.handleReportIssueSubmit(payload, data ?? {});
    }

    console.error('Unhandled tenant maintenance flow request:', {
      action,
      screen,
    });
    throw new Error('Unhandled endpoint request.');
  }

  private async handleReportIssueSubmit(
    payload: FlowTokenPayload,
    data: Record<string, any>,
  ): Promise<any> {
    const description = String(data.description ?? '').trim();
    // When the flow was launched from the stray-input "Add details" choice, the
    // tenant's original message rides on the token. Prepend it so the logged
    // request keeps the first message followed by whatever they added.
    const seed =
      payload.mode === 'create' ? (payload.seed_description ?? '').trim() : '';
    const fullText = [seed, description].filter(Boolean).join('\n');
    const reShow = (message: string) => ({
      screen: 'REPORT_ISSUE',
      data: {
        mode: payload.mode,
        heading:
          payload.mode === 'reopen'
            ? "Tell us what's still wrong"
            : seed
              ? 'Add details to your request'
              : 'Report a maintenance issue',
        description_label:
          payload.mode === 'reopen'
            ? 'What still needs fixing?'
            : seed
              ? 'Add more details'
              : 'Describe the issue',
        has_multiple_properties:
          payload.mode === 'create' && payload.properties.length > 1,
        properties: payload.mode === 'create' ? payload.properties : [],
        error_message: message,
        error_visible: true,
      },
    });

    if (!fullText) {
      return reShow('Please describe the issue.');
    }

    const photos = (data.photos ?? data.media ?? []) as FlowMediaRef[];
    const wantsVideo = data.wants_video === true || data.wants_video === 'true';

    let requestEntityId: string;
    let requestId: string;
    let attempt: number;

    try {
      if (payload.mode === 'create') {
        const propertyId =
          payload.properties.length === 1
            ? payload.properties[0].id
            : String(data.property_id ?? '');
        if (!payload.properties.some((p) => p.id === propertyId)) {
          return reShow('Please choose which property this is for.');
        }
        const created =
          await this.tenantFlowService.createTenantMaintenanceRequest({
            tenantUserId: payload.tenant_user_id,
            propertyId,
            text: fullText,
          });
        if (!created) {
          return reShow(
            'Sorry, we could not log your request. Please try again.',
          );
        }
        requestEntityId = created.id;
        requestId = created.request_id;
        attempt = 1;
      } else {
        // reopen: the request already flipped to REOPENED (and current_attempt
        // bumped) when the tenant tapped "No, not fixed". Record their detail
        // as a reopen note and tag this cycle's media.
        const request = await this.maintenanceRequestRepo.findOne({
          where: { id: payload.request_id },
        });
        if (!request) {
          return reShow('Sorry, we could not find your request.');
        }
        await this.maintenanceRequestService.appendReopenNoteWithDedup(
          payload.request_id,
          payload.tenant_user_id,
          'tenant',
          description,
        );
        requestEntityId = request.id;
        requestId = request.request_id;
        attempt = payload.attempt;
      }
    } catch (err) {
      this.logger.error('Tenant maintenance flow submit failed', err as Error);
      return reShow('Sorry, something went wrong. Please try again.');
    }

    // Async photo ingest (download → decrypt → Cloudinary → append). Fired,
    // not awaited, so the Flow response stays within Meta's endpoint timeout.
    if (photos.length) {
      this.eventEmitter.emit('maintenance.media.ingest', {
        request_id: requestEntityId,
        attempt,
        flowMedia: photos,
      });
    }

    // Arm the 10-minute video window keyed by the tenant's phone (carried on
    // the token — the Flow endpoint doesn't echo the sender number).
    if (wantsVideo) {
      await this.cache.setWithTtlSeconds(
        `awaiting_media_${payload.phone}`,
        { request_id: requestEntityId, attempt, description },
        600,
      );
    }

    // Also confirm in the chat thread. The Flow's SUCCESS screen only lives
    // inside the flow UI; this leaves a lasting message after the tenant exits
    // (and works in the simulator, whose "Done" sends no nfm_reply).
    const confirmation =
      payload.mode === 'reopen'
        ? wantsVideo
          ? "Thanks — I've reopened your request and added your note. Send your video here and I'll attach it."
          : "Thanks — I've reopened your request and added your note. Someone will take another look."
        : wantsVideo
          ? "Got it. I've noted your request. Send your video here and I'll attach it."
          : "Got it. I've noted your request — someone will take a look and reach out once it's being handled.";
    try {
      await this.templateSenderService.sendText(payload.phone, confirmation);
    } catch (err) {
      this.logger.error(
        'Failed to send tenant flow confirmation',
        err as Error,
      );
    }

    return {
      screen: 'MR_SUCCESS',
      data: {
        request_id: requestId,
        success_message: wantsVideo
          ? `Your ticket is ${requestId}. Tap Done, then send your video here in the chat and I'll attach it.`
          : `Your ticket is ${requestId}. Someone will take a look and reach out.`,
      },
    };
  }

  /**
   * Send the welcome text after an FM completes the password-set Flow and
   * clicks "Done" on the terminal screen. Called from
   * WebhookHandler when an `nfm_reply` arrives with the FM_SET_PASSWORD
   * success marker. Looks up the FM by phone for the personalised greeting
   * and silently no-ops if no FM account matches.
   */
  async sendFmWelcomeMessage(phoneNumber: string): Promise<void> {
    // Dedup: the welcome body's `Open your dashboard:` line is unique to
    // this send, so a prior outbound chat_log with that marker means we've
    // already delivered the welcome to this phone — skip to avoid double-
    // sends if the FM clicks "Done" twice or Meta re-delivers the nfm_reply.
    const FM_WELCOME_MARKER = 'Open your dashboard:';
    if (
      await this.chatLogService.hasOutboundContaining(
        phoneNumber,
        FM_WELCOME_MARKER,
      )
    ) {
      this.logger.log(`Skipping FM welcome — already sent to ${phoneNumber}`);
      return;
    }

    const fm = await this.findUserByPhone(
      phoneNumber,
      RolesEnum.FACILITY_MANAGER,
    );
    const profileName =
      fm?.accounts?.find((a) => accountHasRole(a, RolesEnum.FACILITY_MANAGER))
        ?.profile_name ||
      [fm?.first_name, fm?.last_name].filter(Boolean).join(' ').trim();
    const firstName = profileName?.split(' ')[0] || 'there';
    const frontendUrl = (
      process.env.FRONTEND_URL || 'http://localhost:3000'
    ).replace(/\/+$/, '');
    const signinUrl = `${frontendUrl}/signin`;
    const body =
      `Hi ${firstName} 👋\n\n` +
      `Your password has been set.\n\n` +
      `You can now sign in to Lizt using your phone number and the password you just chose.\n\n` +
      `${FM_WELCOME_MARKER} ${signinUrl}\n\n` +
      `Welcome aboard!`;
    await this.sendText(phoneNumber, body);
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
   * Find user by phone number using normalized format.
   *
   * Role filtering happens in JS, not SQL — `accounts.role` is a stale mirror
   * of `roles[0]`, so a `WHERE accounts.role = X` filter silently misses
   * multi-role accounts where X isn't first.
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

    const user = await this.usersRepo.findOne({
      where: { phone_number: normalizedPhone },
      relations: ['accounts'],
    });

    console.log('👤 User lookup result:', {
      found: !!user,
      userId: user?.id,
      accountsCount: user?.accounts?.length || 0,
      matchedPhone: user?.phone_number,
      accountRoles: user?.accounts?.map((acc) => acc.roles) || [],
    });

    if (!user) return null;
    if (role && !user.accounts?.some((acc) => accountHasRole(acc, role))) {
      return null;
    }
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
      whereCondition.roles = ArrayContains([role]);
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
      accountRoles: account?.roles,
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
    const message = messages[0];
    const from = message?.from;
    if (!from || !message) return;

    console.log('📱 Incoming WhatsApp message from:', from);
    console.log('📨 Full message object:', JSON.stringify(message, null, 2));

    // NOTE: Inbound message logging is now handled by WebhookHandler.processIncomingMessage
    // to avoid duplicate database entries. This method now only processes the message logic.
    // DO NOT add logging here - it will duplicate messages when user refreshes the page.

    // CRITICAL: Check if this is a role selection button click BEFORE role detection
    const buttonReply =
      message.interactive?.button_reply || (message as any).button;
    const buttonId = buttonReply?.id || buttonReply?.payload;

    // Check for tenant-specific actions BEFORE role routing.
    // Route directly to tenant flow — it uses findTenantByPhone internally which
    // correctly filters by phone + tenant role, handling multi-role users properly.
    if (buttonId && this.isTenantSpecificAction(buttonId)) {
      const tenantPhone = await this.getPhoneNumberFromIdentifier(from);
      if (message.type === 'interactive' || message.type === 'button') {
        void this.tenantFlowService.handleInteractive(message, tenantPhone);
      }
      return;
    }

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

        await this.cache.set(
          `selected_role_${from}`,
          selectedRole,
          24 * 60 * 60 * 1000,
        );

        // If a button click triggered the role prompt, resume that action
        // instead of dumping the user back at the main menu (the original
        // WhatsApp button is single-tap and can't be re-tapped).
        const pendingRaw = await this.cache.get(`pending_action_${from}`);
        if (pendingRaw) {
          let pending: IncomingMessage | null = null;
          try {
            pending = JSON.parse(pendingRaw as string) as IncomingMessage;
          } catch {
            pending = null;
          }

          const pendingBtn =
            (
              pending?.interactive as {
                button_reply?: { id?: string; payload?: string };
              }
            )?.button_reply ||
            (pending as unknown as { button?: { id?: string; payload?: string } })
              ?.button;
          const pendingBtnId = pendingBtn?.id || pendingBtn?.payload;
          const actionRoles = this.getActionRoles(pendingBtnId);

          // Replay when the action is role-agnostic, or the chosen role can do it.
          if (pending && (!actionRoles || actionRoles.includes(selectedRole))) {
            await this.cache.delete(`pending_action_${from}`);
            await this.cache.delete(`role_redirect_attempts_${from}`);
            await this.handleMessage([pending]);
            return;
          }

          // Mismatch: the picked role can't perform the stored action. Re-ask,
          // but offer ONLY the role(s) that can (plus Cancel) — so the next pick
          // is guaranteed valid and the prompt can't loop. A one-attempt counter
          // backstops it; Cancel lets the user keep the role they just picked.
          if (pending && actionRoles && !actionRoles.includes(selectedRole)) {
            const attempts = Number(
              (await this.cache.get(`role_redirect_attempts_${from}`)) || 0,
            );
            if (attempts < 1) {
              await this.cache.set(
                `role_redirect_attempts_${from}`,
                attempts + 1,
                10 * 60 * 1000,
              );
              const validRoleButtons = this.roleButtonsFor(actionRoles);
              const roleNames = validRoleButtons
                .map((b) => b.title)
                .join(' or ');
              await this.sendButtons(
                await this.getPhoneNumberFromIdentifier(from),
                `That action is only available to your ${roleNames} role. Switch to continue, or cancel.`,
                [
                  ...validRoleButtons,
                  { id: 'cancel_role_switch', title: 'Cancel' },
                ],
              );
              return;
            }
            // Backstop exhausted — abandon the replay and fall through to the menu.
            await this.cache.delete(`pending_action_${from}`);
            await this.cache.delete(`role_redirect_attempts_${from}`);
          }
        }

        // No pending action (or replay abandoned) — show the role's main menu.
        const user = await this.findUserByPhoneOrEmail(from);
        await this.sendMenuForRole(from, selectedRole, user);
        return; // Don't continue with role detection
      }
    }

    // Cancel from the mismatch re-ask: keep the role the user just picked,
    // drop the pending action, and show that role's main menu.
    if (buttonId === 'cancel_role_switch') {
      await this.cache.delete(`pending_action_${from}`);
      await this.cache.delete(`role_redirect_attempts_${from}`);
      const cancelRole = (await this.cache.get(`selected_role_${from}`)) as
        | RolesEnum
        | undefined;
      const cancelUser = await this.findUserByPhoneOrEmail(from);
      await this.sendMenuForRole(from, cancelRole, cancelUser);
      return;
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

    // FIXED: Check account role with role selection for multi-role users.
    // No fallback to Users.role — the column was removed. If accounts is
    // empty, role stays undefined and the no-accounts branch above already
    // logged the data-integrity warning.
    let role: RolesEnum | undefined;

    if (user?.accounts && user.accounts.length > 0) {
      console.log('🔍 Checking accounts for role...', {
        totalAccounts: user.accounts.length,
        accountRoles: user.accounts.map((acc) => acc.roles),
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
        // Use the shared `accountHasRole` helper (imported from account.entity)
        // — `accounts.role` is a stale mirror of `roles[0]`, so a multi-role
        // account like {tenant, facility_manager} has role='tenant' but
        // roles contains both; the helper checks `roles[]` with `role` as fallback.
        const hasFM = user.accounts.some((acc) =>
          accountHasRole(acc, RolesEnum.FACILITY_MANAGER),
        );
        const hasLandlord = user.accounts.some((acc) =>
          accountHasRole(acc, RolesEnum.LANDLORD),
        );
        let hasTenant = user.accounts.some((acc) =>
          accountHasRole(acc, RolesEnum.TENANT),
        );

        // The same phone number may map to a separate tenant user record.
        // Check for it so the Tenant option appears in the role menu.
        // Filter accounts in JS — `accounts.role` only mirrors `roles[0]`,
        // so a multi-role tenant whose tenant role isn't first is invisible
        // to a `WHERE accounts.role = 'tenant'` filter.
        if (!hasTenant && !from.includes('@')) {
          const normalizedPhone = this.utilService.normalizePhoneNumber(from);
          const tenantUser = await this.usersRepo.findOne({
            where: { phone_number: normalizedPhone },
            relations: ['accounts'],
          });
          hasTenant = !!tenantUser?.accounts?.some((acc) =>
            accountHasRole(acc, RolesEnum.TENANT),
          );
        }

        const roleCount = [hasFM, hasLandlord, hasTenant].filter(Boolean).length;

        if (roleCount > 1) {
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

          // Stash the button click that triggered this prompt so we can
          // resume it once a role is picked. WhatsApp interactive buttons are
          // single-tap, so dropping the user at a fresh menu means the original
          // button can't be tapped again. Only buttons are worth replaying —
          // plain text falls through to the chosen role's menu as before.
          if (buttonId) {
            await this.cache.set(
              `pending_action_${from}`,
              JSON.stringify(message),
              10 * 60 * 1000,
            );
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
        const facilityAccount = user.accounts.find((acc) =>
          accountHasRole(acc, RolesEnum.FACILITY_MANAGER),
        );
        if (facilityAccount) {
          console.log('✅ Found FACILITY_MANAGER account:', facilityAccount.id);
          role = RolesEnum.FACILITY_MANAGER;
        } else {
          const landlordAccount = user.accounts.find((acc) =>
            accountHasRole(acc, RolesEnum.LANDLORD),
          );
          if (landlordAccount) {
            console.log('✅ Found LANDLORD account:', landlordAccount.id);
            role = RolesEnum.LANDLORD;
          } else {
            const tenantAccount = user.accounts.find((acc) =>
              accountHasRole(acc, RolesEnum.TENANT),
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

    // Universal button interception — runs BEFORE role-based routing so
    // that applicants (no role) and any other recipient who taps a
    // payment-receipt Download button still get the PDF, instead of
    // falling through to the generic KYC-pending response in the default
    // branch. The button payload was minted by sendPaymentReceiptTenant
    // with format `send_payment_receipt:<receipt_token>`.
    const incomingBtn =
      (message as any).button ??
      (message as any).interactive?.button_reply;
    const incomingBtnPayload =
      incomingBtn?.payload || incomingBtn?.id || null;
    if (
      typeof incomingBtnPayload === 'string' &&
      incomingBtnPayload.startsWith('send_payment_receipt:')
    ) {
      const token = incomingBtnPayload.split(':')[1];
      const tenantPhone = await this.getPhoneNumberFromIdentifier(from);
      this.eventEmitter.emit('whatsapp.button.payment_receipt_download', {
        token,
        phone: tenantPhone,
      });
      return;
    }

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

        const tenantAccount = user?.accounts?.find((acc) =>
          accountHasRole(acc, RolesEnum.TENANT),
        );
        if (tenantAccount) {
          const activeCount = await this.propertyTenantRepo.count({
            where: {
              tenant_id: tenantAccount.id,
              status: TenantStatusEnum.ACTIVE,
            },
          });
          if (activeCount === 0) {
            console.log(
              `🔇 Tenant ${tenantAccount.id} has no active tenancies — replying and stopping`,
            );
            await this.sendText(
              tenantPhone,
              'No active tenancy found on your account. If you believe this is a mistake, please contact your landlord.',
            );
            return;
          }
        }

        // Delegate to TenantFlowService
        // Requirements: 2.5
        if (message.type === 'interactive' || message.type === 'button') {
          void this.tenantFlowService.handleInteractive(message, tenantPhone);
        }

        if (message.type === 'text') {
          void this.tenantFlowService.handleText(message, tenantPhone);
        }

        if (message.type === 'image' || message.type === 'video') {
          void this.tenantFlowService.handleInboundMedia(message, tenantPhone);
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
   * Roles that can handle a given entry-button id, used to decide whether a
   * pending action can be replayed after a multi-role user picks a role.
   * Returns null for shared/role-agnostic buttons (e.g. `maintenance_request`,
   * `visit_site`, `main_menu`) and unknown ids — those replay under any role,
   * letting the chosen role's own switch interpret them. Keep in sync with the
   * role-specific entry cases in handleInteractive (tenant), handleFacilityInteractive
   * (FM) and the landlord flow's handleInteractive.
   */
  private getActionRoles(buttonId?: string | null): RolesEnum[] | null {
    if (!buttonId) return null;
    const map: Record<string, RolesEnum[]> = {
      // Facility Manager
      view_all_maintenance_requests: [RolesEnum.FACILITY_MANAGER],
      view_account_info: [RolesEnum.FACILITY_MANAGER],
      // Tenant
      view_tenancy: [RolesEnum.TENANT],
      payment: [RolesEnum.TENANT],
      pay_rent: [RolesEnum.TENANT],
      pay_outstanding_balance: [RolesEnum.TENANT],
      new_maintenance_request: [RolesEnum.TENANT],
      // Landlord
      view_properties: [RolesEnum.LANDLORD],
      view_maintenance: [RolesEnum.LANDLORD],
      generate_kyc_link: [RolesEnum.LANDLORD],
    };
    return map[buttonId] ?? null;
  }

  /**
   * Send the main menu for a given role. Shared by the role-selection
   * fallthrough and the cancel-role-switch path.
   */
  private async sendMenuForRole(
    from: string,
    role: RolesEnum | undefined,
    user: { first_name?: string | null } | null,
  ): Promise<void> {
    const userPhone = await this.getPhoneNumberFromIdentifier(from);

    if (role === RolesEnum.FACILITY_MANAGER) {
      await this.sendFacilityManagerMainMenu(
        userPhone,
        this.utilService.toSentenceCase(user?.first_name || ''),
      );
    } else if (role === RolesEnum.LANDLORD) {
      await this.sendLandlordMainMenu(
        userPhone,
        this.utilService.toSentenceCase(user?.first_name || 'there'),
      );
    } else {
      await this.sendButtons(
        userPhone,
        `Hello ${this.utilService.toSentenceCase(
          user?.first_name || '',
        )} What would you like to do?`,
        [
          { id: 'maintenance_request', title: 'Maintenance request' },
          { id: 'view_tenancy', title: 'View tenancy details' },
          { id: 'payment', title: 'Payment' },
        ],
        'Tap on any option to continue.',
      );
    }
  }

  /**
   * Build select_role_* buttons for the given roles, used to re-ask which role
   * to switch to when the picked role can't perform a pending action.
   */
  private roleButtonsFor(
    roles: RolesEnum[],
  ): { id: string; title: string }[] {
    const byRole: Partial<Record<RolesEnum, { id: string; title: string }>> = {
      [RolesEnum.FACILITY_MANAGER]: {
        id: 'select_role_fm',
        title: 'Facility Manager',
      },
      [RolesEnum.LANDLORD]: { id: 'select_role_landlord', title: 'Landlord' },
      [RolesEnum.TENANT]: { id: 'select_role_tenant', title: 'Tenant' },
    };
    return roles.map((r) => byRole[r]).filter(Boolean) as {
      id: string;
      title: string;
    }[];
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

    // AI assistant for unknowns (gated by AI_ASSISTANT_ENABLED). Falls back to
    // the legacy button flow below if disabled/unconfigured or anything throws.
    if (await this.unknownsAiService.tryHandle(from, text)) {
      return;
    }

    if (text.toLowerCase() === 'done') {
      // Batch delete both keys in one call
      await this.cache.deleteMultiple([
        `maintenance_request_state_${from}`,
        `maintenance_request_state_default_${from}`,
      ]);
      await this.sendText(from, 'Thank you!  Your session has ended.');
      return;
    }
    void this.handleDefaultCachedResponse(from, text);
  }

  async handleDefaultCachedResponse(from, text) {
    const default_state = await this.cache.get(
      `maintenance_request_state_default_${from}`,
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
        `maintenance_request_state_default_${from}`,
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

      await this.cache.delete(`maintenance_request_state_default_${from}`);
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

    // AI assistant for unknowns: a tapped quick-reply is just another user turn.
    // Pass the button's visible label so the model sees what the person chose.
    if (await this.unknownsAiService.tryHandle(from, buttonReply.title || buttonReply.id)) {
      return;
    }

    switch (buttonReply.id) {
      case 'property_owner':
        await this.sendButtons(
          from,
          `Great! As a Property Owner, you can use Lizt to:\n 
     1. Rent Reminders & Lease Tracking – stay on top of rent due dates and lease expiries.\n 
     2. Rent Collection – receive rent payments directly into your bank account through us, while we track payment history and balances for you.\n 
     3. Maintenance Management – tenants can log maintenance requests with you for quick action. \n Please choose one of the options below:`,
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
          `maintenance_request_state_default_${from}`,
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

  async sendToFacilityManagerSetPasswordFlow(
    params: FMSetPasswordFlowParams,
  ): Promise<void> {
    return this.templateSenderService.sendToFacilityManagerSetPasswordFlow(
      params,
    );
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

  async sendFacilityMaintenanceRequest(
    params: FacilityMaintenanceRequestParams,
  ): Promise<void> {
    return this.templateSenderService.sendFacilityMaintenanceRequest(params);
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

  async sendFacilityManagerMainMenu(
    to: string,
    managerName: string,
  ): Promise<void> {
    return this.templateSenderService.sendFacilityManagerMainMenu(
      to,
      managerName,
    );
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

  /**
   * Determines if a button action is tenant-specific and should always route to tenant flow
   * regardless of the user's current role selection
   */
  private isTenantSpecificAction(buttonId: string): boolean {
    // Extract the action part if it contains a payload (e.g., "confirm_tenancy_details:property-id")
    const action = buttonId.includes(':') ? buttonId.split(':')[0] : buttonId;

    const tenantSpecificActions = [
      'confirm_tenancy_details',
      'tenancy_details_correct',
      'tenancy_details_incorrect',
      'confirm_pay_rent',
      'confirm_pay_ob',
      'main_menu',
      // Add other tenant-specific actions here as needed
    ];

    return tenantSpecificActions.includes(action);
  }

}

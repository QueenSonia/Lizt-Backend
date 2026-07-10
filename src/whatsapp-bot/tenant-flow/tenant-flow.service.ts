import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, Not, In, IsNull } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { Users } from 'src/users/entities/user.entity';
import { accountHasRole } from 'src/users/entities/account.entity';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Property } from 'src/properties/entities/property.entity';
import { Rent } from 'src/rents/entities/rent.entity';
import { RentStatusEnum } from 'src/rents/dto/create-rent.dto';
import {
  RenewalInvoice,
  RenewalLetterStatus,
  RenewalPaymentStatus,
} from 'src/tenancies/entities/renewal-invoice.entity';
import {
  NextPeriodStateResolver,
  NextPeriodState,
} from './next-period-state.resolver';
import { PaymentPlanScope } from 'src/payment-plans/entities/payment-plan.entity';
import { buildInstallmentPlanClause } from 'src/payment-plans/installment-description.util';
import { CacheService } from 'src/lib/cache';
import { UtilService } from 'src/utils/utility-service';
import { formatPhoneForDisplay } from 'src/utils/phone-number.transformer';
import { RolesEnum } from 'src/base.entity';
import {
  MaintenanceRequestCreatorTypeEnum,
  MaintenanceRequestStatusEnum,
} from 'src/maintenance-requests/dto/create-maintenance-request.dto';
import { mapMRStatusForTenant } from 'src/maintenance-requests/utils/tenant-view';
import { TenantStatusEnum } from 'src/properties/dto/create-property.dto';
import { MaintenanceRequestsService } from 'src/maintenance-requests/maintenance-requests.service';
import {
  TemplateSenderService,
  ButtonDefinition,
  FacilityMaintenanceRequestParams,
  TenancyDetailsReviewLandlordParams,
  TenancyDetailsDisputeReasonLandlordParams,
} from '../template-sender';
import { IncomingMessage } from '../utils';
import { WhatsAppNotificationLogService } from '../whatsapp-notification-log.service';
import { FlowTokenService, FlowProperty } from '../flow-token.service';
import { MaintenanceMediaService } from '../maintenance-media.service';
import {
  TenantAiService,
  TenantAiContext,
  TenantProp,
} from '../tenant-ai.service';
import { TenantBalancesService } from 'src/tenant-balances/tenant-balances.service';
import {
  Fee,
  rentToFees,
  renewalInvoiceToFees,
  nextPeriodFees,
  sumRecurring,
  sumOneTime,
} from 'src/common/billing/fees';
import { computeRenewalFold } from 'src/common/billing/renewal-fold';
import { nextPeriodEndInclusive } from 'src/common/utils/rent-date.util';
import { NotificationRecipientsService } from 'src/common/notify/notification-recipients.service';
import { NotificationCategory } from 'src/common/notify/notification-category.enum';

/** Verified lease facts for the AI tenancy-info branch (amounts pre-formatted). */
export interface TenancyDetails {
  propertyName: string;
  location: string;
  paymentFrequency: string;
  /** Formatted "dd Mmm yyyy". */
  startDate: string;
  endDate: string;
  /** Every fee on the lease, recurring and one-time, amounts pre-formatted. */
  fees: Array<{ label: string; amount: string; recurring: boolean }>;
  /** Sum of recurring fees per payment period, pre-formatted. */
  totalRecurring: string;
  /** Plain-English time until the end date, precomputed. */
  timeToExpiry: string;
}

/** A media item to attach once a deferred stray-input request is created. */
interface PendingMediaRef {
  /** Meta media id (real inbound), resolved via the Graph API. */
  id?: string;
  /** Pre-hosted public URL (simulator), used in place of the Meta id. */
  link?: string;
  type: 'image' | 'video';
}

/**
 * A stray input the bot offered to turn into a maintenance request. Creation is
 * deferred through a short guided intake — the bot collects extra details, then
 * photos/videos — so the request is logged once with the full picture (and the
 * FM/landlord notification carries the complete description). Stashed in
 * `pending_create_<phone>` until the intake finishes.
 */
interface PendingCreate {
  kind: 'text' | 'media';
  /** The accumulated description (seed text/caption + any extra details). */
  description?: string;
  /** Caption sent with seed media; used as the description if no other given. */
  caption?: string;
  /** Resolved once the tenant picks a property (single-property auto-fills). */
  property_id?: string;
  /** Media to attach on create — the seed media plus any added during intake. */
  media?: PendingMediaRef[];
  /**
   * Set once the tenant taps "Yes" — we're collecting the details/photos before
   * logging. Absent during the initial Yes/No offer stage.
   */
  phase?: 'collecting';
}

// Words that end an intake step ("no, that's all").
const INTAKE_NEGATIVES = new Set([
  'no',
  'nope',
  'nah',
  'none',
  'nothing',
  'done',
  'no thanks',
  'no thank you',
  "that's all",
  "that's it",
  'thats all',
  'thats it',
]);

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
    { id: 'maintenance_request', title: 'Maintenance request' },
    { id: 'view_tenancy', title: 'View tenancy details' },
    { id: 'payment', title: 'Payment' },
  ];

  constructor(
    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,

    @InjectRepository(MaintenanceRequest)
    private readonly maintenanceRequestRepo: Repository<MaintenanceRequest>,

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
    private readonly maintenanceRequestService: MaintenanceRequestsService,
    private readonly templateSenderService: TemplateSenderService,
    private readonly notificationLogService: WhatsAppNotificationLogService,
    private readonly flowTokenService: FlowTokenService,
    private readonly maintenanceMediaService: MaintenanceMediaService,
    private readonly tenantBalancesService: TenantBalancesService,
    private readonly nextPeriodStateResolver: NextPeriodStateResolver,
    private readonly eventEmitter: EventEmitter2,
    private readonly notificationRecipients: NotificationRecipientsService,
    @Inject(forwardRef(() => TenantAiService))
    private readonly tenantAiService: TenantAiService,
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
      await this.cache.delete(`maintenance_request_state_${from}`);
      await this.cache.delete(`tenant_deny_state_${from}`);
      await this.cache.delete(`awaiting_media_${from}`);
      await this.cache.delete(`pending_create_${from}`);
      await this.cache.delete(`pending_create_property_${from}`);
      await this.templateSenderService.sendText(
        from,
        'Thank you!  Your session has ended.',
      );
      return;
    }

    // While a video window is open (tenant opted into adding a video on the
    // Flow), free text isn't a request description — nudge or close. Reserved
    // keywords above (done/menu/switch) still take precedence.
    const awaitingMedia = await this.cache.get(`awaiting_media_${from}`);
    if (awaitingMedia) {
      if (lowerText === 'skip') {
        await this.cache.delete(`awaiting_media_${from}`);
        await this.templateSenderService.sendText(
          from,
          'No problem — your request is logged.',
        );
      } else {
        await this.templateSenderService.sendText(
          from,
          'Send your video here and I’ll attach it to your request, or reply *skip* if you’re done.',
        );
      }
      return;
    }

    // Pending denial-reason capture takes priority over the generic state
    // machine — the tenant tapped Deny on an FM-filed MR confirmation prompt
    // and we're waiting on their reason (or 'skip').
    const denyState = await this.cache.get(`tenant_deny_state_${from}`);
    if (denyState) {
      await this.handleTenantDenyReasonReply(from, text, denyState);
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
    const userState = await this.cache.get(`maintenance_request_state_${from}`);

    // Handle property selection for tenancy details
    const tenancyDetailsSelection = await this.cache.get<string[]>(
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

    // Numbered property pick for a multi-property "create from stray input"
    // offer. Checked before the intake handler because the pending payload
    // still carries its intake phase while we wait for the property number.
    const pendingCreateProperty = await this.cache.get<string[]>(
      `pending_create_property_${from}`,
    );
    if (pendingCreateProperty) {
      await this.handleCreatePropertySelection(
        from,
        text,
        pendingCreateProperty,
      );
      return;
    }

    // Guided intake after a confirmed stray-input offer ("anything else?" /
    // "any photos?"). Only active once a phase is set (post-confirmation).
    const pendingCreate = await this.cache.get<PendingCreate>(
      `pending_create_${from}`,
    );
    if (pendingCreate?.phase) {
      await this.handleIntakeReply(from, text, pendingCreate);
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
      await this.handleMaintenanceRequestDescription(from, text, userState);
      return;
    }

    if (userState?.startsWith('awaiting_tenancy_dispute_reason:')) {
      await this.handleTenancyDisputeReason(from, text, userState);
      return;
    }

    if (userState?.startsWith('awaiting_reopen_followup:')) {
      await this.handleReopenFollowup(from, text, userState);
      return;
    }

    if (userState === 'view_single_maintenance_request') {
      await this.handleViewSingleMaintenanceRequest(from, text);
      return;
    }

    // Stray free text with no active state. When the AI receptionist is
    // enabled, let it drive the conversation (capture issue/notice, ask for
    // media, file via tool). It falls back to the legacy Yes/No button offer if
    // disabled or anything throws.
    if (this.tenantAiService.isEnabled()) {
      const ctx = await this.resolveTenantContext(from);
      if (ctx && (await this.tenantAiService.tryHandleText(from, text, ctx))) {
        return;
      }
    }

    // Default: offer to log the stray text as a maintenance request.
    await this.offerCreateFromText(from, text);
  }

  /**
   * Resolve a tenant's user id + their active properties from a phone number,
   * for the AI receptionist. Returns null if there's no tenant account or no
   * active tenancy (the caller then falls back to the legacy offer).
   */
  private async resolveTenantContext(
    from: string,
  ): Promise<TenantAiContext | null> {
    const user = await this.findTenantByPhone(from);
    if (!user?.accounts?.length) return null;
    const accountId = user.accounts[0].id;
    const propertyTenants = await this.propertyTenantRepo.find({
      where: { tenant_id: accountId, status: TenantStatusEnum.ACTIVE },
      relations: ['property'],
    });
    if (!propertyTenants?.length) return null;
    const properties: TenantProp[] = propertyTenants.map((pt) => ({
      id: pt.property_id,
      name: pt.property?.name ?? 'Your property',
    }));
    const pendingConfirmations = await this.findResolvedAwaitingConfirmation(
      user.id,
    );
    return {
      tenantUserId: user.id,
      firstName:
        this.utilService.toSentenceCase(user.first_name ?? '') || undefined,
      properties,
      pendingConfirmations,
    };
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
    cachedPropertyIds: string[],
  ): Promise<void> {
    // CacheService.get already deserializes the stored JSON, so this is
    // already a string[] — re-parsing it would coerce the array to a
    // comma-joined string and throw a JSON SyntaxError.
    const propertyIds = cachedPropertyIds;
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

    // Show details for the selected property. Menu-driven view is read-only —
    // no "Are these details correct?" confirmation prompt.
    await this.showTenancyDetailsForProperty(
      from,
      accountId,
      propertyTenant,
      false,
    );
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
      `maintenance_request_state_${from}`,
      `awaiting_description:${selectedPropertyId}`,
      this.SESSION_TIMEOUT_MS,
    );

    await this.templateSenderService.sendText(
      from,
      'Sure! Please tell me what needs to be fixed.',
    );
  }

  /**
   * Handle maintenance request description submission
   */
  private async handleMaintenanceRequestDescription(
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
      await this.cache.delete(`maintenance_request_state_${from}`);
      return;
    }

    // Fix #20: Prevent duplicate submissions within a short window
    const dedupeKey = `maintenance_request_dedup_${from}`;
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

    if (!selectedPropertyId) {
      await this.templateSenderService.sendText(
        from,
        'We could not determine which property this request is for. Please try again.',
      );
      await this.cache.delete(`maintenance_request_state_${from}`);
      return;
    }

    try {
      const new_maintenance_request =
        await this.maintenanceRequestService.createMaintenanceRequest(
          {
            property_id: selectedPropertyId,
            text,
          },
          { id: user.id, role: RolesEnum.TENANT },
        );

      if (new_maintenance_request) {
        const {
          created_at,
          facility_managers,
          property_name,
          property_location,
          property_id,
        } = new_maintenance_request;

        await this.templateSenderService.sendText(
          from,
          "Got it. I've noted your request — someone will take a look and reach out once it's being handled.",
        );

        // Send navigation options after completing request
        await this.templateSenderService.sendButtons(
          from,
          'Want to do something else?',
          [
            { id: 'new_maintenance_request', title: 'Request a service' },
            { id: 'main_menu', title: 'Go back to main menu' },
          ],
        );

        await this.cache.delete(`maintenance_request_state_${from}`);

        // Fix #11: Notifications are queued independently — failures don't affect the tenant
        try {
          await this.queueFacilityManagerNotifications(
            facility_managers,
            user,
            property_name,
            property_location,
            text,
            created_at,
            new_maintenance_request.id,
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
            new_maintenance_request.id,
          );
        } catch (err) {
          this.logger.error('Failed to queue landlord notification:', err);
        }
      }
      await this.cache.delete(`maintenance_request_state_${from}`);
    } catch (error) {
      // Fix #10: Never expose raw error messages to tenants
      this.logger.error(
        'Maintenance request creation failed:',
        (error as Error).message,
      );
      await this.templateSenderService.sendText(
        from,
        'Sorry, we could not log your request right now. Please try again shortly.',
      );
      await this.cache.delete(`maintenance_request_state_${from}`);
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
    maintenanceRequest: string,
    createdAt: Date,
    maintenanceRequestId?: string,
  ): Promise<void> {
    if (!facilityManagers?.length) return;

    const tenantLocalPhone = this.toLocalPhone(user.phone_number);
    const tenantName = `${this.utilService.toSentenceCase(user.first_name)} ${this.utilService.toSentenceCase(user.last_name)}`;
    const formattedDate = this.formatDateLagos(createdAt);
    const safeRequest =
      this.utilService.sanitizeTemplateParam(maintenanceRequest);

    for (const manager of facilityManagers) {
      const params: FacilityMaintenanceRequestParams = {
        phone_number: manager.phone_number,
        manager_name: manager.name,
        property_name: propertyName,
        property_location: propertyLocation,
        maintenance_request: safeRequest,
        tenant_name: tenantName,
        tenant_phone_number: tenantLocalPhone,
        date_created: formattedDate,
        is_landlord: false,
      };

      await this.notificationLogService.queue(
        'sendFacilityMaintenanceRequest',
        params,
        maintenanceRequestId,
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
    maintenanceRequest: string,
    createdAt: Date,
    maintenanceRequestId?: string,
  ): Promise<void> {
    const property = await this.propertyRepo.findOne({
      where: { id: propertyId },
      select: { id: true, owner_id: true },
    });

    if (!property) {
      this.logger.warn(
        `Cannot notify landlord: property ${propertyId} not found`,
      );
      return;
    }

    const recipients = await this.notificationRecipients.resolveRecipients(
      property.owner_id,
      NotificationCategory.MAINTENANCE,
    );
    if (!recipients.length) {
      this.logger.warn(
        `Cannot notify landlord: owner data missing for property ${propertyId}`,
      );
      return;
    }

    const tenantLocalPhone = this.toLocalPhone(user.phone_number);

    if (!maintenanceRequestId) {
      // Without the request id we can't build the landlord template's
      // Assign/Reject button payloads. Bail rather than send a broken
      // template — this should never happen in the WhatsApp create path
      // (the id is available before notifications fire) but the type
      // signature still allows it.
      this.logger.warn(
        `Cannot notify landlord: missing maintenance_request_id for property ${propertyId}`,
      );
      return;
    }

    for (const [index, recipient] of recipients.entries()) {
      if (!recipient.phone) continue;
      const params: FacilityMaintenanceRequestParams = {
        phone_number: recipient.phone,
        manager_name: this.utilService.toSentenceCase(recipient.name),
        property_name: propertyName,
        property_location: propertyLocation,
        maintenance_request:
          this.utilService.sanitizeTemplateParam(maintenanceRequest),
        tenant_name: `${this.utilService.toSentenceCase(user.first_name)} ${this.utilService.toSentenceCase(user.last_name)}`,
        tenant_phone_number: tenantLocalPhone,
        date_created: this.formatDateLagos(createdAt),
        is_landlord: true,
        maintenance_request_id: maintenanceRequestId,
      };

      // Primary recipient keeps the bare reference id (existing dedup keys
      // on it); any additional recipient gets an account-suffixed one.
      await this.notificationLogService.queue(
        'sendFacilityMaintenanceRequest',
        params,
        index === 0
          ? maintenanceRequestId
          : `${maintenanceRequestId}:${recipient.accountId}`,
      );
    }
  }

  /**
   * Format a phone number for display: NG in local 0xxx form, other countries
   * in full international form.
   */
  private toLocalPhone(phone: string): string {
    return formatPhoneForDisplay(phone, '');
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
   * Handle viewing a single maintenance request
   */
  private async handleViewSingleMaintenanceRequest(
    from: string,
    text: string,
  ): Promise<void> {
    const normalizedPhone = this.utilService.normalizePhoneNumber(from);

    // Fix #18: Escape LIKE special characters to prevent pattern injection
    const escapedText = text.replace(/[%_]/g, '\\$&');
    const maintenanceRequests = await this.maintenanceRequestRepo.find({
      where: {
        creator: { phone_number: normalizedPhone },
        creator_type: MaintenanceRequestCreatorTypeEnum.TENANT,
        description: ILike(`%${escapedText}%`),
        status: Not(
          In([
            MaintenanceRequestStatusEnum.CLOSED,
            MaintenanceRequestStatusEnum.REJECTED,
          ]),
        ),
      },
      relations: ['tenant', 'creator'],
    });

    if (!maintenanceRequests.length) {
      await this.templateSenderService.sendText(
        from,
        'No maintenance requests found matching that description.',
      );
      await this.cache.delete(`maintenance_request_state_${from}`);
      return;
    }

    let response = 'Here are the matching maintenance requests:\n';
    maintenanceRequests.forEach((req) => {
      const createdDate = req.created_at
        ? new Date(req.created_at).toLocaleDateString()
        : 'Unknown date';
      response += `${req.description} (${createdDate}) \n Status: ${mapMRStatusForTenant(req.status)}\n Notes: ${
        req.notes || '——'
      }\n\n`;
    });

    await this.templateSenderService.sendText(from, response);
    await this.cache.delete(`maintenance_request_state_${from}`);

    await this.templateSenderService.sendButtons(from, 'back', [
      {
        id: 'maintenance_request',
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
    let maintenanceRequestId: string | null = null;

    if (buttonId?.includes(':')) {
      const [action, payload] = buttonId.split(':');
      if (
        action === 'confirm_resolution_yes' ||
        action === 'confirm_resolution_no'
      ) {
        cleanButtonId = action;
        maintenanceRequestId = payload; // The MR the card was sent for
      }
      if (action === 'confirm_pay_ob') {
        await this.handleConfirmPayOB(from, payload);
        return;
      }
      if (action === 'confirm_pay_rent') {
        await this.handleConfirmPayRent(from, payload);
        return;
      }
      if (action === 'send_payment_receipt') {
        // Tenant tapped "Download receipt" on the payment_receipt_tenant
        // template. Delegate to PaymentHistoryPdfService via event-emitter
        // so this module doesn't need a direct dependency on PropertyHistoryModule
        // (which already depends on us for TemplateSenderService).
        this.eventEmitter.emit('whatsapp.button.payment_receipt_download', {
          token: payload,
          phone: from,
        });
        return;
      }
      if (action === 'confirm_tenancy_details') {
        cleanButtonId = action;
        propertyId = payload; // Extract the property ID
      }
      if (
        action === 'tenancy_details_correct' ||
        action === 'tenancy_details_incorrect'
      ) {
        cleanButtonId = action;
        propertyId = payload; // Property under review, embedded at send time
      }
      if (action === 'tenant_confirm_mr') {
        await this.handleTenantConfirmMaintenanceRequest(from, payload);
        return;
      }
      if (action === 'tenant_deny_mr') {
        await this.handleTenantDenyMaintenanceRequestPrompt(from, payload);
        return;
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

      case 'maintenance_request':
      case 'new_maintenance_request':
        await this.handleNewMaintenanceRequest(from);
        break;

      case 'main_menu':
        await this.handleMainMenu(from);
        break;

      case 'confirm_resolution_yes':
        await this.handleConfirmResolutionYes(from, maintenanceRequestId);
        break;

      case 'confirm_resolution_no':
        await this.handleConfirmResolutionNo(from, maintenanceRequestId);
        break;

      case 'create_mr_yes':
        await this.offerCreateChoice(from);
        break;

      case 'create_mr_flow':
        await this.handleAddDetails(from);
        break;

      case 'create_mr_asis':
        await this.resolvePropertyAndCreate(from);
        break;

      case 'create_mr_no':
        await this.cache.delete(`pending_create_${from}`);
        await this.cache.delete(`pending_create_property_${from}`);
        await this.templateSenderService.sendButtons(
          from,
          'No problem. Please choose from the menu below so we can assist you with the right service.',
          this.MAIN_MENU_BUTTONS,
        );
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
        await this.handleTenancyDetailsCorrect(from, propertyId);
        break;

      case 'tenancy_details_incorrect':
        await this.handleTenancyDetailsIncorrect(from, propertyId);
        break;

      default:
        await this.templateSenderService.sendText(
          from,
          'Unknown option selected.',
        );
    }
  }

  /**
   * Gate the bot for tenants who haven't confirmed their tenancy details.
   *
   * Called once before the tenant message-type dispatch, so it covers text,
   * interactive/button, and media in a single deterministic check (no AI).
   * Rule: if the tenant has ANY active tenancy with `details_confirmed_at`
   * still NULL, block the turn and re-show the confirm card (throttled to once
   * per session). Returns true when it blocked — the caller then stops.
   *
   * The confirm/dispute flow is exempt (otherwise a blocked tenant could never
   * escape), and the check is FAIL-OPEN: any error — including the column not
   * existing before the migration runs — serves the tenant rather than locking
   * everyone out. See plan: gate unconfirmed tenants out of the WhatsApp bot.
   */
  async gateUnconfirmedTenant(
    message: IncomingMessage,
    from: string,
  ): Promise<boolean> {
    try {
      // 1. Let the escape hatch through (confirm/dispute interactions).
      if (await this.isConfirmFlowInteraction(message, from)) return false;

      // 2. Any unconfirmed ACTIVE tenancy? Selection mirrors the migration's
      //    grandfather backfill (status = ACTIVE), so existing tenants — whose
      //    rows were backfilled non-NULL — are never gated.
      const user = await this.findTenantByPhone(from);
      if (!user?.accounts?.length) return false;
      const accountIds = user.accounts.map((a) => a.id);
      const unconfirmed = await this.propertyTenantRepo.find({
        where: {
          tenant_id: In(accountIds),
          status: TenantStatusEnum.ACTIVE,
          details_confirmed_at: IsNull(),
        },
        order: { created_at: 'ASC' },
      });
      if (!unconfirmed.length) return false;

      // 3. Blocked. Re-show the confirm card for the oldest unconfirmed
      //    property once per session; a brief nudge on repeats avoids spamming.
      const shownKey = `tenancy_gate_card_shown_${from}`;
      if (await this.cache.get(shownKey)) {
        await this.templateSenderService.sendText(
          from,
          'Please confirm your tenancy details using the buttons above to continue.',
        );
      } else {
        await this.handleConfirmTenancyDetails(
          from,
          unconfirmed[0].property_id,
        );
        await this.cache.set(shownKey, '1', this.SESSION_TIMEOUT_MS);
      }
      return true;
    } catch (err) {
      this.logger.error(
        `Tenant confirmation gate failed for ${from}; failing open:`,
        err,
      );
      return false;
    }
  }

  /**
   * True when this inbound is part of the tenancy-confirm/dispute escape hatch
   * and must bypass the gate: the multi-property confirm picker, the free-text
   * dispute reply, or one of the confirm/dispute buttons.
   */
  private async isConfirmFlowInteraction(
    message: IncomingMessage,
    from: string,
  ): Promise<boolean> {
    // Mid-flow states: choosing which property to confirm, or typing what's wrong.
    if (await this.cache.get(`tenancy_details_selection_${from}`)) return true;
    const mrState = await this.cache.get<string>(
      `maintenance_request_state_${from}`,
    );
    if (
      typeof mrState === 'string' &&
      mrState.startsWith('awaiting_tenancy_dispute_reason')
    ) {
      return true;
    }

    // Confirm/dispute buttons (same extraction as handleInteractive).
    const buttonReply =
      (
        message.interactive as {
          button_reply?: { id?: string; payload?: string };
        }
      )?.button_reply ||
      (message as unknown as { button?: { id?: string; payload?: string } })
        .button;
    const buttonId = buttonReply?.id || buttonReply?.payload;
    if (!buttonId) return false;
    const action = buttonId.includes(':') ? buttonId.split(':')[0] : buttonId;
    return (
      action === 'confirm_tenancy_details' ||
      action === 'tenancy_details_correct' ||
      action === 'tenancy_details_incorrect'
    );
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

      await this.templateSenderService.sendFacilityManagerMainMenu(
        from,
        this.utilService.toSentenceCase(user?.first_name || ''),
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

    const tenantAccount = user.accounts.find((a) =>
      accountHasRole(a, RolesEnum.TENANT),
    );

    if (!tenantAccount) {
      this.logger.error('No tenant account found for user');
      return;
    }

    const accountId = tenantAccount.id;
    this.logger.log('🏠 Looking for properties for account:', accountId);

    const properties = await this.propertyTenantRepo.find({
      where: { tenant_id: accountId, status: TenantStatusEnum.ACTIVE },
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

    // Single property → skip the picker and show its details directly. Menu-
    // driven view is read-only — no confirmation prompt.
    if (properties.length === 1) {
      await this.showTenancyDetailsForProperty(
        from,
        accountId,
        properties[0],
        false,
      );
      return;
    }

    // Multiple properties → ask which one. The numbered reply is handled by
    // handleTenancyDetailsPropertySelection, gated on this cache key.
    let list = 'Which property would you like to view?\n\n';
    properties.forEach((item, i) => {
      list += `${i + 1}. ${item.property?.name ?? 'Property'}\n`;
    });
    list += '\nReply with the number of the property.';

    await this.cache.set(
      `tenancy_details_selection_${from}`,
      properties.map((item) => item.property_id),
      this.SESSION_TIMEOUT_MS,
    );

    await this.templateSenderService.sendText(from, list);
  }

  /**
   * Handle new maintenance request button
   */
  /**
   * Tenant tapped "Maintenance request". Mints a create-mode flow token
   * (carrying their phone, user id, and active properties for the in-flow
   * dropdown) and launches the `maintenance_request_tenant` Flow template.
   * Replaces the old free-text property-pick + description state machine.
   */
  private async handleNewMaintenanceRequest(from: string): Promise<void> {
    await this.launchMaintenanceCreateFlow(from);
  }

  /**
   * Send the tenant maintenance-request Flow in "create" mode. Shared by the
   * main-menu entry (no seed) and the stray-input "Add details" choice, which
   * passes the tenant's original message as `seedDescription` — that text is
   * carried on the flow token and prepended to whatever they type in the flow,
   * so the logged request keeps the first message. When seeded, the first
   * screen's copy switches from "describe the issue" to "add details".
   */
  private async launchMaintenanceCreateFlow(
    from: string,
    seedDescription?: string,
  ): Promise<void> {
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
    const propertyTenants = await this.propertyTenantRepo.find({
      where: {
        tenant_id: accountId,
        status: TenantStatusEnum.ACTIVE,
      },
      relations: ['property'],
    });

    if (!propertyTenants?.length) {
      await this.templateSenderService.sendText(
        from,
        'No active properties found for your account.',
      );
      return;
    }

    const properties: FlowProperty[] = propertyTenants.map((pt) => ({
      id: pt.property_id,
      title: pt.property?.name ?? 'Your property',
    }));

    const seed = (seedDescription ?? '').trim();

    const flowToken = await this.flowTokenService.mint({
      mode: 'create',
      phone: from,
      tenant_user_id: user.id,
      properties,
      ...(seed ? { seed_description: seed } : {}),
    });

    try {
      await this.templateSenderService.sendTenantMaintenanceRequestFlow({
        phone_number: from,
        name:
          this.utilService.formatPersonName(user.first_name, user.last_name) ||
          'there',
        flow_token: flowToken,
        // Seed the REPORT_ISSUE screen inline (navigate-mode launch) so the
        // property dropdown is populated without an endpoint INIT round-trip.
        flow_action_data: {
          mode: 'create',
          heading: seed
            ? 'Add details to your request'
            : 'Report a maintenance issue',
          description_label: seed ? 'Add more details' : 'Describe the issue',
          has_multiple_properties: properties.length > 1,
          properties,
          error_message: '',
          error_visible: false,
        },
      });
    } catch (err) {
      // The Flow template can fail to send (e.g. while it is still under review
      // at Meta, code 132001). Don't leave the tenant with no response — send a
      // plain-text fallback so they know to retry.
      this.logger.error(
        '❌ Failed to send maintenance-request Flow; sending fallback text:',
        err instanceof Error ? err.message : err,
      );
      await this.templateSenderService.sendText(
        from,
        "Sorry, we couldn't open the maintenance request form just now. Please try again in a little while.",
      );
    }
  }

  /**
   * Create a tenant maintenance request and queue the FM + landlord
   * notifications (same pipeline as the legacy text path). Shared by the
   * WhatsApp Flow submit and the stray-input "Yes, create" path. Returns the
   * new request's ids, or null if the tenant/create failed. Callers own the
   * tenant-facing confirmation (the Flow shows its SUCCESS screen; the
   * stray-input path sends a text), so none is sent here.
   */
  async createTenantMaintenanceRequest(params: {
    tenantUserId: string;
    propertyId: string;
    text: string;
  }): Promise<{ id: string; request_id: string } | null> {
    const user = await this.usersRepo.findOne({
      where: { id: params.tenantUserId },
    });
    if (!user) {
      this.logger.warn(
        `createTenantMaintenanceRequest: user ${params.tenantUserId} not found`,
      );
      return null;
    }

    const created =
      await this.maintenanceRequestService.createMaintenanceRequest(
        { property_id: params.propertyId, text: params.text },
        { id: params.tenantUserId, role: RolesEnum.TENANT },
      );
    if (!created) return null;

    const {
      created_at,
      facility_managers,
      property_name,
      property_location,
      property_id,
      id,
      request_id,
    } = created;

    try {
      await this.queueFacilityManagerNotifications(
        facility_managers,
        user,
        property_name,
        property_location,
        params.text,
        created_at,
        id,
      );
    } catch (err) {
      this.logger.error('Failed to queue FM notifications (flow):', err);
    }

    try {
      await this.queueLandlordNotification(
        property_id,
        user,
        property_name,
        property_location,
        params.text,
        created_at,
        id,
      );
    } catch (err) {
      this.logger.error('Failed to queue landlord notification (flow):', err);
    }

    return { id, request_id };
  }

  /**
   * Append tenant-provided detail to an existing request they just filed (used
   * by the AI receptionist when a follow-up message elaborates on the same
   * issue rather than raising a new one). Returns true if the append landed.
   */
  async updateTenantMaintenanceRequest(params: {
    tenantUserId: string;
    requestId: string;
    addition: string;
  }): Promise<boolean> {
    const updated =
      await this.maintenanceRequestService.appendTenantRequestDetail(
        params.requestId,
        params.tenantUserId,
        params.addition,
      );
    return !!updated;
  }

  /**
   * Requests the FM has marked RESOLVED that are awaiting this tenant's
   * confirmation — i.e. the ones a free-text "it's fixed" / "still broken" reply
   * could be about. Injected into the AI context so it can map an ambiguous
   * reply to the right request and either confirm (close) or reopen it.
   */
  async findResolvedAwaitingConfirmation(
    tenantUserId: string,
  ): Promise<
    Array<{ requestId: string; description: string; resolvedOn: string }>
  > {
    const rows = await this.maintenanceRequestRepo.find({
      where: {
        tenant: { user: { id: tenantUserId } },
        status: MaintenanceRequestStatusEnum.RESOLVED,
      },
      relations: ['tenant', 'tenant.user'],
      order: { resolution_date: 'DESC' },
      take: 10,
    });
    return rows.map((r) => ({
      requestId: r.request_id,
      description: r.description,
      resolvedOn: r.resolution_date
        ? new Date(r.resolution_date).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : '—',
    }));
  }

  /**
   * AI-driven "Yes, it's fixed": close a resolved request the tenant confirms is
   * sorted, by its human request_id (SR…). Mirrors handleConfirmResolutionYes —
   * closes via the service then pings landlord + FMs with the closed template.
   */
  async confirmTenantRequestFixed(params: {
    tenantUserId: string;
    requestId: string;
  }): Promise<boolean> {
    const row = await this.maintenanceRequestRepo.findOne({
      where: {
        request_id: params.requestId,
        tenant: { user: { id: params.tenantUserId } },
      },
      relations: ['tenant', 'tenant.user'],
    });
    if (!row) return false;
    const ok =
      await this.maintenanceRequestService.confirmTenantRequestResolved(
        row.id,
        params.tenantUserId,
      );
    if (ok && row.property_id) {
      const safe = this.utilService.sanitizeTemplateParam(row.description);
      await this.notifyPropertyStakeholders(row.property_id, (phone) =>
        this.templateSenderService.sendMaintenanceRequestClosedNotification({
          phone_number: phone,
          maintenance_request: safe,
        }),
      );
    }
    return ok;
  }

  /**
   * AI-driven "No, not fixed": reopen a resolved request by its human request_id
   * (SR…). Mirrors handleConfirmResolutionNo — reopens via the service (which
   * bumps the attempt and emits the event) then pings landlord + FMs with the
   * reopened template. Returns the new attempt + uuid so fresh media can attach.
   */
  async reopenTenantRequestForTenant(params: {
    tenantUserId: string;
    requestId: string;
    reason: string;
  }): Promise<{ ok: boolean; attempt?: number; id?: string }> {
    const row = await this.maintenanceRequestRepo.findOne({
      where: {
        request_id: params.requestId,
        tenant: { user: { id: params.tenantUserId } },
      },
      relations: ['tenant', 'tenant.user'],
    });
    if (!row) return { ok: false };
    const res = await this.maintenanceRequestService.reopenTenantRequest(
      row.id,
      params.tenantUserId,
      params.reason,
    );
    if (!res) return { ok: false };
    if (row.property_id) {
      const safe = this.utilService.sanitizeTemplateParam(row.description);
      await this.notifyPropertyStakeholders(row.property_id, (phone) =>
        this.templateSenderService.sendMaintenanceRequestReopenedNotification({
          phone_number: phone,
          maintenance_request: safe,
        }),
      );
    }
    return { ok: true, attempt: res.attempt, id: row.id };
  }

  /**
   * Verified, read-only lease facts for the AI receptionist's tenancy-info
   * branch. Same source as the "View tenancy details" card — the ACTIVE Rent row
   * for this tenant + property — but returned as a structured object with ALL
   * fees (recurring AND one-time) and a couple of precomputed values (total
   * recurring per period, time-to-expiry) so the assistant never does its own
   * maths. Deliberately omits payment status / balances — that's a separate
   * branch. Returns null when there's no active tenancy or rent on file.
   */
  async getTenancyDetails(
    tenantUserId: string,
    propertyId: string,
  ): Promise<TenancyDetails | null> {
    const propertyTenant = await this.propertyTenantRepo.findOne({
      where: {
        tenant: { user: { id: tenantUserId } },
        property_id: propertyId,
        status: TenantStatusEnum.ACTIVE,
      },
      relations: ['property', 'tenant', 'tenant.user'],
    });
    if (!propertyTenant?.property) return null;

    const rent = await this.rentRepo.findOne({
      where: {
        tenant_id: propertyTenant.tenant_id,
        property_id: propertyId,
        rent_status: RentStatusEnum.ACTIVE,
      },
    });
    if (!rent) return null;

    const formatNGN = (amount: number) =>
      amount != null
        ? amount.toLocaleString('en-NG', { style: 'currency', currency: 'NGN' })
        : '—';
    const formatDate = (date: Date | string | null | undefined) =>
      date
        ? new Date(date).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : '—';

    const allFees = rentToFees(rent);
    const totalRecurring = allFees
      .filter((f) => f.recurring)
      .reduce((sum, f) => sum + (f.amount ?? 0), 0);

    return {
      propertyName: propertyTenant.property.name,
      location: propertyTenant.property.location ?? '—',
      paymentFrequency: rent.payment_frequency ?? '—',
      startDate: formatDate(rent.rent_start_date),
      endDate: formatDate(rent.expiry_date),
      fees: allFees.map((f) => ({
        label: f.label,
        amount: formatNGN(f.amount),
        recurring: f.recurring,
      })),
      totalRecurring: formatNGN(totalRecurring),
      timeToExpiry: this.describeTimeToExpiry(rent.expiry_date),
    };
  }

  /** Plain-English time remaining until a tenancy's end date (precomputed so
   * the AI never does date maths). */
  private describeTimeToExpiry(expiry?: Date | string | null): string {
    if (!expiry) return 'no end date on file';
    const days = Math.round(
      (new Date(expiry).getTime() - Date.now()) / 86_400_000,
    );
    if (days < 0) return `ended ${Math.abs(days)} day(s) ago`;
    if (days === 0) return 'ends today';
    if (days < 14) return `about ${days} day(s) away`;
    if (days < 60) return `about ${Math.round(days / 7)} week(s) away`;
    return `about ${Math.round(days / 30)} month(s) away`;
  }

  /**
   * Inbound photo/video from a tenant. If a video window is open (armed when a
   * tenant opts into "I also have a video" in the Flow), attach the media to
   * that request. Otherwise treat it as a stray attachment and offer to create
   * a new maintenance request with it attached.
   */
  async handleInboundMedia(
    message: IncomingMessage,
    from: string,
  ): Promise<void> {
    const media = message.image ?? message.video;
    if (!media?.id && !media?.link) return;
    const mediaType: 'image' | 'video' = message.video ? 'video' : 'image';

    // Dedup: Meta can redeliver the same media webhook.
    const dedupKey = `media_msg_${message.id}`;
    if (await this.cache.get(dedupKey)) return;
    await this.cache.setWithTtlSeconds(dedupKey, '1', 3600);

    const windowKey = `awaiting_media_${from}`;
    const openWindow = await this.cache.get<{
      request_id: string;
      attempt: number;
      description?: string;
    }>(windowKey);

    if (openWindow) {
      const item = await this.maintenanceMediaService.ingestInboundMedia(
        openWindow.request_id,
        { id: media.id, link: media.link, type: mediaType },
        openWindow.attempt,
      );
      if (item) {
        // Keep the window open (refresh TTL) so they can send several.
        await this.cache.setWithTtlSeconds(windowKey, openWindow, 600);
        await this.templateSenderService.sendText(
          from,
          '✅ Added to your request. Send another, or reply *done* when finished.',
        );
      } else {
        await this.templateSenderService.sendText(
          from,
          "Sorry, I couldn't save that file. Please try sending it again.",
        );
      }
      return;
    }

    // Media sent during a guided intake (after the tenant confirmed) — stash it
    // to attach when the request is created. If we now have a description, log
    // the request; otherwise ask for one first.
    const pendingCreate = await this.cache.get<PendingCreate>(
      `pending_create_${from}`,
    );
    if (pendingCreate?.phase) {
      const caption = (media.caption ?? '').trim();
      pendingCreate.media = [
        ...(pendingCreate.media ?? []),
        { id: media.id, link: media.link, type: mediaType },
      ];
      if (caption) {
        pendingCreate.description = [pendingCreate.description, caption]
          .filter((s) => (s ?? '').trim())
          .join('\n');
      }
      await this.cache.setWithTtlSeconds(
        `pending_create_${from}`,
        pendingCreate,
        900,
      );
      if ((pendingCreate.description ?? '').trim()) {
        await this.resolvePropertyAndCreate(from);
      } else {
        await this.templateSenderService.sendText(
          from,
          'Got it. Please add a short description of the issue so we can log your request.',
        );
      }
      return;
    }

    // Stray media — no active window. When the AI receptionist is enabled, eagerly
    // re-host the media to Cloudinary (Meta's download URLs are short-lived),
    // buffer it for the eventual report tool, and hand the AI a breadcrumb so it
    // can acknowledge and continue the conversation. Falls back to the legacy
    // offer if disabled, the upload fails, or the AI declines the turn.
    if (this.tenantAiService.isEnabled()) {
      const item = await this.maintenanceMediaService.uploadStrayInbound({
        id: media.id,
        link: media.link,
        type: mediaType,
      });
      if (item) {
        await this.tenantAiService.bufferMedia(from, {
          type: item.type,
          url: item.url,
        });
      }
      const caption = (media.caption ?? '').trim();
      const breadcrumb = caption
        ? `[tenant attached a ${mediaType}] ${caption}`
        : `[tenant attached a ${mediaType}]`;
      const ctx = await this.resolveTenantContext(from);
      if (
        ctx &&
        (await this.tenantAiService.tryHandleMedia(from, breadcrumb, ctx))
      ) {
        return;
      }
    }

    // Stray media — no active window. Offer to log a new request with it.
    await this.offerCreateFromMedia(from, message);
  }

  /** "Is this a maintenance request?" Yes/No offer for a stray message. */
  private async sendMaintenanceOffer(from: string): Promise<void> {
    await this.templateSenderService.sendButtons(
      from,
      'Hello! We received your message.\n\nIs your message related to a maintenance issue or service request?',
      [
        { id: 'create_mr_yes', title: 'Yes' },
        { id: 'create_mr_no', title: 'No' },
      ],
    );
  }

  /**
   * Stray free text the bot couldn't otherwise place: stash it as the seed
   * description and ask whether it's a maintenance request.
   */
  async offerCreateFromText(from: string, text: string): Promise<void> {
    await this.cache.setWithTtlSeconds(
      `pending_create_${from}`,
      { kind: 'text', description: text },
      900,
    );
    await this.sendMaintenanceOffer(from);
  }

  /**
   * Stray photo/video: stash it as the seed media (caption kept as an initial
   * description) and ask whether it's a maintenance request.
   */
  private async offerCreateFromMedia(
    from: string,
    message: IncomingMessage,
  ): Promise<void> {
    const media = message.image ?? message.video;
    if (!media?.id && !media?.link) return;
    const kind: 'image' | 'video' = message.video ? 'video' : 'image';
    const caption = (media.caption ?? '').trim();

    await this.cache.setWithTtlSeconds(
      `pending_create_${from}`,
      {
        kind: 'media',
        description: caption,
        caption,
        media: [{ id: media.id, link: media.link, type: kind }],
      },
      900,
    );
    await this.sendMaintenanceOffer(from);
  }

  /**
   * Tenant tapped "Yes" on the maintenance-request offer. Give them the choice
   * to add details (opens the maintenance Flow, seeded with their original
   * message) or log their message as is (one tap, no flow). For stray media we
   * keep the guided text intake instead of the Flow so the already-captured
   * photo/video isn't lost.
   */
  private async offerCreateChoice(from: string): Promise<void> {
    const pending = await this.cache.get<PendingCreate>(
      `pending_create_${from}`,
    );
    if (!pending) {
      await this.templateSenderService.sendText(
        from,
        "That offer expired. Send your message again and I'll offer to log it.",
      );
      return;
    }

    const seed = (pending.description ?? '').trim();
    // Quote the tenant's own words back when we have them (text path); media has
    // no first message to quote. Collapse whitespace and cap the length so the
    // preview stays readable and within the interactive body limit.
    const preview =
      seed.replace(/\s+/g, ' ').length > 240
        ? `${seed.replace(/\s+/g, ' ').slice(0, 240).trimEnd()}…`
        : seed.replace(/\s+/g, ' ');
    const prompt =
      pending.kind === 'text' && seed
        ? `Got it. Want to add details to "${preview}", or report your message as is?`
        : 'Got it. Want to add details, or report your message as is?';

    await this.templateSenderService.sendButtons(from, prompt, [
      { id: 'create_mr_flow', title: 'Add details' },
      { id: 'create_mr_asis', title: 'Report as is' },
    ]);
  }

  /**
   * Tenant tapped "Add details". For a text seed we open the maintenance Flow
   * (same one the main menu uses), carrying the original message so the flow's
   * input is appended to it on submit. For media we fall back to the guided
   * text intake, which preserves the stashed photo/video.
   */
  private async handleAddDetails(from: string): Promise<void> {
    const pending = await this.cache.get<PendingCreate>(
      `pending_create_${from}`,
    );
    if (!pending) {
      await this.templateSenderService.sendText(
        from,
        "That offer expired. Send your message again and I'll offer to log it.",
      );
      return;
    }

    if (pending.kind === 'media') {
      await this.beginIntake(from);
      return;
    }

    // Text seed → hand off to the Flow. The seed now lives on the flow token,
    // so drop the pending payload to avoid a stale intake intercepting replies.
    await this.cache.delete(`pending_create_${from}`);
    await this.cache.delete(`pending_create_property_${from}`);
    await this.launchMaintenanceCreateFlow(from, pending.description);
  }

  /**
   * Start the guided text intake (used for the stray-media "Add details" path).
   * Asks for the issue details and optional photos/videos before the request is
   * created.
   */
  async beginIntake(from: string): Promise<void> {
    const pending = await this.cache.get<PendingCreate>(
      `pending_create_${from}`,
    );
    if (!pending) {
      await this.templateSenderService.sendText(
        from,
        "That offer expired. Send your message again and I'll offer to log it.",
      );
      return;
    }
    pending.phase = 'collecting';
    await this.cache.setWithTtlSeconds(`pending_create_${from}`, pending, 900);
    await this.templateSenderService.sendText(
      from,
      'Thank you. Please provide any additional details about the issue. You may also attach photos or videos if they will help us better understand the problem.',
    );
  }

  /**
   * Tenant's text reply while collecting intake details. The text becomes (part
   * of) the description and the request is then logged. A bare "no" is treated
   * as "nothing to add" rather than appended to the description.
   */
  private async handleIntakeReply(
    from: string,
    text: string,
    pending: PendingCreate,
  ): Promise<void> {
    const trimmed = text.trim();
    const isNegative = INTAKE_NEGATIVES.has(trimmed.toLowerCase());

    if (trimmed && !(isNegative && (pending.description ?? '').trim())) {
      pending.description = [pending.description, trimmed]
        .filter((s) => (s ?? '').trim())
        .join('\n');
      await this.cache.setWithTtlSeconds(
        `pending_create_${from}`,
        pending,
        900,
      );
    }
    await this.resolvePropertyAndCreate(from);
  }

  /**
   * Final step of the guided intake: resolve the tenant's property (single
   * auto-fills; multiple prompt a numbered pick) then create the request.
   */
  private async resolvePropertyAndCreate(from: string): Promise<void> {
    const pending = await this.cache.get<PendingCreate>(
      `pending_create_${from}`,
    );
    if (!pending) {
      await this.templateSenderService.sendText(
        from,
        "That offer expired. Send your message again and I'll offer to log it.",
      );
      return;
    }

    const user = await this.findTenantByPhone(from);
    if (!user?.accounts?.length) {
      await this.cache.delete(`pending_create_${from}`);
      await this.templateSenderService.sendText(
        from,
        'No tenancy info available.',
      );
      return;
    }

    const accountId = user.accounts[0].id;
    const propertyTenants = await this.propertyTenantRepo.find({
      where: { tenant_id: accountId, status: TenantStatusEnum.ACTIVE },
      relations: ['property'],
    });
    if (!propertyTenants?.length) {
      await this.cache.delete(`pending_create_${from}`);
      await this.templateSenderService.sendText(
        from,
        'No active properties found for your account.',
      );
      return;
    }

    if (propertyTenants.length === 1) {
      await this.createFromPending(
        from,
        user.id,
        propertyTenants[0].property_id,
        pending,
      );
      return;
    }

    // Multiple properties → ask which one. Keep the pending payload around.
    let list = 'Which property is this for?\n\n';
    propertyTenants.forEach((pt, i) => {
      list += `${i + 1}. ${pt.property?.name ?? 'Property'}\n`;
    });
    list += '\nReply with the number of the property.';
    await this.cache.setWithTtlSeconds(
      `pending_create_property_${from}`,
      propertyTenants.map((pt) => pt.property_id),
      600,
    );
    await this.templateSenderService.sendText(from, list);
  }

  /**
   * Numbered property reply for a multi-property create-from-stray-input flow.
   */
  async handleCreatePropertySelection(
    from: string,
    text: string,
    propertyIds: string[],
  ): Promise<void> {
    const index = parseInt(text.trim(), 10) - 1;
    if (Number.isNaN(index) || index < 0 || index >= propertyIds.length) {
      await this.templateSenderService.sendText(
        from,
        `Please reply with a number between 1 and ${propertyIds.length}.`,
      );
      return;
    }
    const pending = await this.cache.get<PendingCreate>(
      `pending_create_${from}`,
    );
    const user = await this.findTenantByPhone(from);
    if (!pending || !user) {
      await this.cache.delete(`pending_create_${from}`);
      await this.cache.delete(`pending_create_property_${from}`);
      await this.templateSenderService.sendText(
        from,
        'That offer expired. Send your message again.',
      );
      return;
    }
    await this.createFromPending(from, user.id, propertyIds[index], pending);
  }

  /**
   * Create the request captured by a stray-input offer, then attach the stashed
   * media if there was any. Clears the pending caches first.
   */
  private async createFromPending(
    from: string,
    tenantUserId: string,
    propertyId: string,
    pending: PendingCreate,
  ): Promise<void> {
    await this.cache.delete(`pending_create_${from}`);
    await this.cache.delete(`pending_create_property_${from}`);

    const description =
      (pending.description ?? '').trim() ||
      pending.caption?.trim() ||
      (pending.kind === 'media'
        ? `Issue reported via ${pending.media?.[0]?.type ?? 'photo'}`
        : '');

    if (!description) {
      await this.templateSenderService.sendText(
        from,
        "I couldn't read the issue. Please try again.",
      );
      return;
    }

    let created: { id: string; request_id: string } | null = null;
    try {
      created = await this.createTenantMaintenanceRequest({
        tenantUserId,
        propertyId,
        text: description,
      });
    } catch (err) {
      this.logger.error('Create-from-stray-input failed', err as Error);
    }
    if (!created) {
      await this.templateSenderService.sendText(
        from,
        'Sorry, we could not log your request right now. Please try again shortly.',
      );
      return;
    }

    // Attach everything gathered during the intake (seed media + any added).
    for (const ref of pending.media ?? []) {
      if (!ref.id && !ref.link) continue;
      await this.maintenanceMediaService.ingestInboundMedia(
        created.id,
        { id: ref.id, link: ref.link, type: ref.type },
        1,
      );
    }

    await this.templateSenderService.sendText(
      from,
      'Thank you. Your maintenance request has been received and logged successfully.\n\nA member of our maintenance team will review the information provided and begin the resolution process. We will keep you updated on the status of your request.',
    );
  }

  /**
   * Handle main menu button
   */
  private async handleMainMenu(from: string): Promise<void> {
    // Clear any cached state and return to main menu
    await this.cache.delete(`maintenance_request_state_${from}`);

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
   * Resolve which maintenance request a resolution-confirmation tap refers
   * to. The card's button IDs carry the request id (`:request_id` payload);
   * the lookup is still scoped to the tapping tenant's phone so a payload can
   * only ever act on that tenant's own request. Falls back to the latest
   * RESOLVED request when no payload is present (legacy shapes/simulator) —
   * the pre-payload behavior.
   */
  private async findResolutionRequest(
    from: string,
    requestId?: string | null,
  ): Promise<MaintenanceRequest | null> {
    const normalizedPhone = this.utilService.normalizePhoneNumber(from);
    return this.maintenanceRequestRepo.findOne({
      where: {
        ...(requestId
          ? { id: requestId }
          : { status: MaintenanceRequestStatusEnum.RESOLVED }),
        tenant: { user: { phone_number: normalizedPhone } },
      },
      relations: ['tenant', 'tenant.user', 'property'],
      order: { resolution_date: 'DESC' },
    });
  }

  /**
   * A late tap can land on a request that has since moved on (already
   * CLOSED by an earlier tap, REOPENED, auto-closed…). Say so honestly
   * instead of mutating a request that is no longer awaiting confirmation.
   */
  private async sendResolutionRequestMovedOn(
    from: string,
    status: MaintenanceRequestStatusEnum,
  ): Promise<void> {
    const message =
      status === MaintenanceRequestStatusEnum.CLOSED
        ? 'This request has already been closed. If the issue has come back, please create a new maintenance request from the menu.'
        : "This request is back with the team and no longer awaiting your confirmation — we'll check in again once it's marked resolved.";
    await this.templateSenderService.sendText(from, message);
  }

  /**
   * Handle confirm resolution yes button
   */
  private async handleConfirmResolutionYes(
    from: string,
    requestId?: string | null,
  ): Promise<void> {
    const latestResolvedRequest = await this.findResolutionRequest(
      from,
      requestId,
    );

    if (
      latestResolvedRequest &&
      latestResolvedRequest.status !== MaintenanceRequestStatusEnum.RESOLVED
    ) {
      await this.sendResolutionRequestMovedOn(
        from,
        latestResolvedRequest.status,
      );
      return;
    }

    if (latestResolvedRequest) {
      // The query filters by tenant.user.phone_number, so for matched rows
      // tenant + tenant.user are guaranteed populated despite the nullable
      // tenant column on the entity.
      const tenantUser = latestResolvedRequest.tenant?.user;
      await this.maintenanceRequestService.updateStatus(
        latestResolvedRequest.id,
        MaintenanceRequestStatusEnum.CLOSED,
        'Tenant confirmed issue is fully resolved via WhatsApp',
        {
          id: tenantUser?.id ?? 'system',
          role: 'tenant',
          name: tenantUser
            ? `${tenantUser.first_name} ${tenantUser.last_name}`
            : 'Tenant',
        },
      );

      await this.templateSenderService.sendText(
        from,
        "Fantastic! Glad that's sorted 😊",
      );

      if (latestResolvedRequest.property_id) {
        const safeRequest = this.utilService.sanitizeTemplateParam(
          latestResolvedRequest.description,
        );
        await this.notifyPropertyStakeholders(
          latestResolvedRequest.property_id,
          (phone) =>
            this.templateSenderService.sendMaintenanceRequestClosedNotification(
              { phone_number: phone, maintenance_request: safeRequest },
            ),
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
  private async handleConfirmResolutionNo(
    from: string,
    requestId?: string | null,
  ): Promise<void> {
    const latestResolvedRequest = await this.findResolutionRequest(
      from,
      requestId,
    );

    if (
      latestResolvedRequest &&
      latestResolvedRequest.status !== MaintenanceRequestStatusEnum.RESOLVED
    ) {
      await this.sendResolutionRequestMovedOn(
        from,
        latestResolvedRequest.status,
      );
      return;
    }

    if (latestResolvedRequest) {
      const tenantUser = latestResolvedRequest.tenant?.user;
      await this.maintenanceRequestService.updateStatus(
        latestResolvedRequest.id,
        MaintenanceRequestStatusEnum.REOPENED,
        'Tenant reported issue is not fully resolved via WhatsApp',
        {
          id: tenantUser?.id ?? 'system',
          role: 'tenant',
          name: tenantUser
            ? `${tenantUser.first_name} ${tenantUser.last_name}`
            : 'Tenant',
        },
      );

      // updateStatus bumped current_attempt on the REOPENED transition; re-read
      // so the reopen Flow tags new evidence with the correct cycle.
      const reopened = await this.maintenanceRequestRepo.findOne({
        where: { id: latestResolvedRequest.id },
      });
      const attempt = reopened?.current_attempt ?? 2;

      // Relaunch the Flow in reopen mode so the tenant describes what's still
      // wrong and attaches fresh photos/video under the new attempt — instead
      // of the old free-text "reply with a description" capture.
      if (tenantUser?.id) {
        const flowToken = await this.flowTokenService.mint({
          mode: 'reopen',
          phone: from,
          tenant_user_id: tenantUser.id,
          request_id: latestResolvedRequest.id,
          attempt,
        });
        await this.templateSenderService.sendTenantMaintenanceRequestFlow({
          phone_number: from,
          name:
            this.utilService.formatPersonName(
              tenantUser.first_name,
              tenantUser.last_name,
            ) || 'there',
          flow_token: flowToken,
          // Reopen: property is fixed (hide the dropdown); reword for context.
          flow_action_data: {
            mode: 'reopen',
            heading: "Tell us what's still wrong",
            description_label: 'What still needs fixing?',
            has_multiple_properties: false,
            properties: [],
            error_message: '',
            error_visible: false,
          },
        });
      }

      if (latestResolvedRequest.property_id) {
        const safeRequest = this.utilService.sanitizeTemplateParam(
          latestResolvedRequest.description,
        );
        await this.notifyPropertyStakeholders(
          latestResolvedRequest.property_id,
          (phone) =>
            this.templateSenderService.sendMaintenanceRequestReopenedNotification(
              { phone_number: phone, maintenance_request: safeRequest },
            ),
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
   * Tenant's free-text reply after tapping "No, not yet" on a resolved MR.
   * The reopen + stakeholder notify already happened on the button tap (and
   * the reopen itself flipped the latest resolution-attempt row's outcome
   * to REOPENED); this just patches that attempt row's tenant_denial_reason
   * so the FM's Resolution History card renders the tenant's quote. The
   * reply is optional — if it never arrives the cache key expires and the
   * denial_reason stays NULL.
   */
  private async handleReopenFollowup(
    from: string,
    text: string,
    userState: string,
  ): Promise<void> {
    await this.cache.delete(`maintenance_request_state_${from}`);

    const [, requestId, tenantAccountId] = userState.split(':');
    const trimmed = text.trim();
    if (!requestId || !tenantAccountId || !trimmed) {
      await this.showTenantMenu(from);
      return;
    }

    try {
      await this.maintenanceRequestService.patchLatestAttemptDenialReason(
        requestId,
        tenantAccountId,
        trimmed,
      );
    } catch (err) {
      // Forbidden / not-found means the cached state pointed at an MR this
      // phone no longer owns (tenant moved out, etc). Don't surface the
      // backend error to the tenant — silently drop the follow-up.
      this.logger.warn(
        `Failed to attach reopen follow-up for request ${requestId}: ${
          (err as Error).message
        }`,
      );
      await this.showTenantMenu(from);
      return;
    }

    await this.templateSenderService.sendText(
      from,
      "Got it — I've added that to the request.",
    );
  }

  /**
   * Fan out a per-recipient send to the property's owner-side recipients
   * (the managing admin — and, once subscribed, the landlord) + every FM on
   * the team. The caller passes a closure that knows which template (and
   * params) to send for each normalized phone — this keeps the fan-out
   * logic template-agnostic so new MR-status notifications can reuse it
   * without piling on overloads. Phones are de-duped across legs (an admin
   * who is also on the FM team gets one message).
   */
  private async notifyPropertyStakeholders(
    propertyId: string,
    send: (phone: string) => Promise<void>,
  ): Promise<void> {
    try {
      const property = await this.propertyRepo.findOne({
        where: { id: propertyId },
        select: { id: true, owner_id: true },
      });

      if (!property) return;

      const seenPhones = new Set<string>();

      const recipients = await this.notificationRecipients.resolveRecipients(
        property.owner_id,
        NotificationCategory.MAINTENANCE,
      );
      for (const recipient of recipients) {
        if (!recipient.phone || seenPhones.has(recipient.phone)) continue;
        seenPhones.add(recipient.phone);
        await send(recipient.phone);
      }

      const fms = await this.maintenanceRequestService.findTeamFmsForLandlord(
        property.owner_id,
      );
      for (const fm of fms) {
        if (!fm.account?.user?.phone_number) continue;
        const phone = this.utilService.normalizePhoneNumber(
          fm.account.user.phone_number,
        );
        if (seenPhones.has(phone)) continue;
        seenPhones.add(phone);
        await send(phone);
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
        `maintenance_request_state_${from}`,
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

    await this.cache.delete(`maintenance_request_state_${from}`);

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

    // Exclude wallet OB already owned by an active wallet-backed plan — that
    // slice is collected by the plan's installments, so this link must only
    // charge the UN-planned OB (matches refreshInvoiceTotals' OB branch). If a
    // plan already covers it all, there is nothing to pay here.
    const claimedByPlans =
      await this.tenantBalancesService.sumActiveWalletBackedPlanClaims(
        accountId,
        rent.property.owner_id,
      );
    outstandingBalance = Math.max(0, outstandingBalance - claimedByPlans);
    if (outstandingBalance <= 0) {
      await this.templateSenderService.sendText(
        from,
        'Your outstanding balance is being settled by a payment plan — no separate payment is needed.',
      );
      return;
    }

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

    // Reuse an existing live OB invoice for this tenant if one is already
    // pending. Tapping "pay outstanding balance" in WhatsApp is trivial, and
    // without this guard each tap creates a parallel ₦X row (seen in prod:
    // 3× identical rows for the same tenant over two days).
    const existing = await this.renewalInvoiceRepo.findOne({
      where: {
        property_tenant_id: propertyTenant.id,
        token_type: 'tenant',
        payment_status: RenewalPaymentStatus.UNPAID,
        rent_amount: 0,
      },
      order: { created_at: 'DESC' },
    });

    // Canonical OB shape: a single Fee carrying the outstanding amount with
    // externalId 'outstanding_balance'. Several consumers (refreshInvoiceTotals
    // auto-PAID flip, payment-plan-requests source classification, payment-plan
    // charge resolution) discriminate on this shape. Without it OB invoices
    // get misclassified as payment-plan invoices.
    const obFee: Fee = {
      kind: 'other',
      label: 'Outstanding Balance',
      amount: outstandingBalance,
      recurring: false,
      externalId: 'outstanding_balance',
    };

    let token: string;
    if (existing) {
      existing.outstanding_balance = outstandingBalance;
      existing.total_amount = outstandingBalance;
      // Backfill legacy rows (created before fee_breakdown was populated)
      // and sync the amount on already-canonical rows.
      const breakdown = Array.isArray(existing.fee_breakdown)
        ? existing.fee_breakdown
        : [];
      existing.fee_breakdown = breakdown.some(
        (f) => f.externalId === 'outstanding_balance',
      )
        ? breakdown.map((f) =>
            f.externalId === 'outstanding_balance'
              ? { ...f, amount: outstandingBalance }
              : f,
          )
        : [obFee];
      await this.renewalInvoiceRepo.save(existing);
      token = existing.token;
    } else {
      token = uuidv4();
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
        fee_breakdown: [obFee],
        total_amount: outstandingBalance,
        outstanding_balance: outstandingBalance,
        token_type: 'tenant',
        payment_status: RenewalPaymentStatus.UNPAID,
        payment_frequency: rent.payment_frequency,
      });
      await this.renewalInvoiceRepo.save(invoice);
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const tenantName =
      this.utilService.formatPersonName(user.first_name, user.last_name) ||
      'there';

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
        `maintenance_request_state_${from}`,
        `select_property_rent:${JSON.stringify(activeRents.map((r) => r.property_id))}`,
        this.SESSION_TIMEOUT_MS,
      );
    } else {
      await this.dispatchPayRent(from, activeRents[0]);
    }
  }

  /**
   * Inspect the next-period state and route the tenant to one of:
   *   - direct installment / invoice / paid-up notice (short-circuits)
   *   - "we've nudged the landlord again" (existing pending request)
   *   - bare confirmation card (DRAFT / SENT / nothing — runs request flow)
   *
   * Centralises the branching for both the single-rent path in
   * `handlePayRent` and the multi-property selector in
   * `handlePropertySelectionForRent`.
   */
  private async dispatchPayRent(from: string, rent: Rent): Promise<void> {
    const propertyTenant = await this.propertyTenantRepo.findOne({
      where: {
        property_id: rent.property_id,
        tenant_id: rent.tenant_id,
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

    const state = await this.nextPeriodStateResolver.resolve(
      propertyTenant,
      rent,
    );

    switch (state.kind) {
      case 'ACTIVE_PLAN_LINK':
        await this.sendActivePlanLink(from, rent, state);
        return;
      case 'UNPAID_INVOICE_LINK':
        await this.sendUnpaidInvoiceLink(from, rent, state.invoice);
        return;
      case 'ALREADY_PAID':
        await this.sendAlreadyPaidNotice(from, rent, state.invoice);
        return;
      case 'EXISTING_REQUEST':
        await this.sendExistingRequestNudge(from, rent, state.invoice);
        return;
      case 'DRAFT_LETTER_PENDING':
      case 'SENT_LETTER_PENDING':
      case 'NEW_REQUEST':
        await this.sendRentConfirmation(from, rent);
        return;
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

    await this.cache.delete(`maintenance_request_state_${from}`);

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

    await this.dispatchPayRent(from, rent);
  }

  /**
   * Resolve the next-period charges for a tenant's active rent.
   *
   * Prefers a pending landlord-set renewal invoice (created via "Edit next
   * period" or a silent initiate-renewal) so the prompt and the eventual
   * invoice agree. Falls back to rolling the current rent's recurring fees
   * forward when no pre-set invoice exists.
   */
  private async resolveNextPeriodCharges(rent: Rent): Promise<{
    fees: Fee[];
    paymentFrequency: string;
    startDate: Date;
    endDate: Date;
    sourceInvoice: RenewalInvoice | null;
  }> {
    const propertyTenant = await this.propertyTenantRepo.findOne({
      where: {
        property_id: rent.property_id,
        tenant_id: rent.tenant_id,
        status: TenantStatusEnum.ACTIVE,
      },
    });

    const pending = propertyTenant
      ? await this.renewalInvoiceRepo.findOne({
          where: {
            property_tenant_id: propertyTenant.id,
            token_type: 'landlord',
            payment_status: RenewalPaymentStatus.UNPAID,
          },
          order: { created_at: 'DESC' },
        })
      : null;

    if (pending) {
      return {
        fees: renewalInvoiceToFees(pending),
        paymentFrequency:
          pending.payment_frequency || rent.payment_frequency || 'Annually',
        startDate: new Date(pending.start_date),
        endDate: new Date(pending.end_date),
        sourceInvoice: pending,
      };
    }

    const paymentFrequency = rent.payment_frequency || 'Annually';
    const startDate = new Date(rent.expiry_date || new Date());
    startDate.setDate(startDate.getDate() + 1);
    const endDate = nextPeriodEndInclusive(startDate, rent);

    // No landlord pre-set: roll forward only the recurring fees from the
    // current rent. One-time fees (caution, legal, agency, one-time others)
    // were collected at move-in and shouldn't be re-billed every period.
    return {
      fees: nextPeriodFees(rentToFees(rent)),
      paymentFrequency,
      startDate,
      endDate,
      sourceInvoice: null,
    };
  }

  /**
   * Bare confirmation card the tenant sees when tapping "Pay Rent". No
   * terms, no totals, no wallet credit — the landlord sets/edits terms via
   * the dashboard before approving (they can also let defaults stand).
   */
  private async sendRentConfirmation(from: string, rent: Rent): Promise<void> {
    const message = `Do you want to send a rent renewal request to your landlord for ${rent.property.name}?`;

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
   *
   * Wraps the body in a Redis lock keyed by property_tenant id so a
   * double-tap from the tenant doesn't race two concurrent requests
   * past the resolver's EXISTING_REQUEST short-circuit. The lock TTL
   * (10s) is long enough to absorb any reasonable network latency but
   * short enough to release on its own if anything goes wrong.
   */
  private async handleConfirmPayRent(
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

    if (!rent) {
      await this.templateSenderService.sendText(
        from,
        'No active rent found for that property.',
      );
      return;
    }

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

    const lockKey = `tenant_pay_request:${propertyTenant.id}`;
    const acquired = await this.cache.setNx(lockKey, '1', 10);
    if (!acquired) {
      await this.templateSenderService.sendText(
        from,
        `We're already processing your last request for ${rent.property.name}. Please wait a moment.`,
      );
      return;
    }

    try {
      // Re-resolve state inside the lock — between card-render and confirm
      // the landlord may have edited terms, sent a letter from the
      // dashboard, or the cron may have flipped a SENT row. Trust the
      // current state, not the state when the card was rendered.
      const state = await this.nextPeriodStateResolver.resolve(
        propertyTenant,
        rent,
      );

      switch (state.kind) {
        case 'ACTIVE_PLAN_LINK':
          await this.sendActivePlanLink(from, rent, state);
          return;
        case 'UNPAID_INVOICE_LINK':
          await this.sendUnpaidInvoiceLink(from, rent, state.invoice);
          return;
        case 'ALREADY_PAID':
          await this.sendAlreadyPaidNotice(from, rent, state.invoice);
          return;
        case 'EXISTING_REQUEST':
          await this.sendExistingRequestNudge(from, rent, state.invoice);
          return;
        case 'DRAFT_LETTER_PENDING':
        case 'SENT_LETTER_PENDING':
          await this.markRequestPendingAndDmLandlord(
            from,
            rent,
            propertyTenant,
            user,
            state.invoice,
          );
          return;
        case 'NEW_REQUEST':
          await this.createRequestRowAndDmLandlord(
            from,
            rent,
            propertyTenant,
            accountId,
            user,
          );
          return;
      }
    } finally {
      await this.cache.delete(lockKey);
    }
  }

  // ─── Tap-Pay short-circuit handlers ──────────────────────────────────

  private async sendActivePlanLink(
    from: string,
    rent: Rent,
    state: Extract<NextPeriodState, { kind: 'ACTIVE_PLAN_LINK' }>,
  ): Promise<void> {
    const user = await this.findTenantByPhone(from);
    if (!user?.accounts?.length) return;

    const tenantName =
      this.utilService.formatPersonName(user.first_name, user.last_name) ||
      'there';
    const totalInstallments = state.plan.installments?.length ?? 0;
    const installmentLabel = `${state.nextInstallment.sequence} of ${totalInstallments}`;
    const amount = Number(state.nextInstallment.amount).toLocaleString(
      'en-NG',
      { style: 'currency', currency: 'NGN' },
    );
    const fmtDate = (d: Date | string) =>
      new Date(d).toLocaleDateString('en-GB');
    const dueDateStr = fmtDate(state.nextInstallment.due_date);

    // Relative-day word for "...is due {{3}}, {{4}}." — computed off UTC
    // midnight to match the cron. A tap-pay of an already-due installment
    // collapses to "today" (daysUntilDue <= 0).
    const dueMidnight = new Date(state.nextInstallment.due_date);
    dueMidnight.setUTCHours(0, 0, 0, 0);
    const todayMidnight = new Date();
    todayMidnight.setUTCHours(0, 0, 0, 0);
    const daysUntilDue = Math.round(
      (dueMidnight.getTime() - todayMidnight.getTime()) / (24 * 60 * 60 * 1000),
    );
    const duePhrase =
      daysUntilDue <= 0
        ? 'today'
        : daysUntilDue === 1
          ? 'tomorrow'
          : `in ${daysUntilDue} days`;

    // Same folded clause as the cron — period comes from the rent in hand.
    const tenancyPeriod =
      state.plan.scope === PaymentPlanScope.TENANCY &&
      rent.rent_start_date &&
      rent.expiry_date
        ? `${fmtDate(rent.rent_start_date)} – ${fmtDate(rent.expiry_date)}`
        : null;
    const planDescription = buildInstallmentPlanClause({
      scope: state.plan.scope,
      chargeName: state.plan.charge_name,
      propertyName: rent.property.name,
      location: rent.property?.location,
      tenancyPeriod,
    });

    await this.notificationLogService.queue('sendInstallmentReminderTemplate', {
      phone_number: from,
      tenant_name: tenantName,
      amount,
      due_phrase: duePhrase,
      due_date: dueDateStr,
      installment_label: installmentLabel,
      plan_description: planDescription,
      pay_token: state.nextInstallment.id,
    });
  }

  private async sendUnpaidInvoiceLink(
    from: string,
    rent: Rent,
    invoice: RenewalInvoice,
  ): Promise<void> {
    const user = await this.findTenantByPhone(from);
    if (!user) return;

    const fmtDate = (d: Date | string) =>
      new Date(d).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });

    await this.notificationLogService.queue('sendRenewalLink', {
      phone_number: from,
      tenant_name:
        this.utilService.formatPersonName(user.first_name, user.last_name) ||
        'there',
      property_name: rent.property.name,
      start_date: fmtDate(invoice.start_date),
      end_date: fmtDate(invoice.end_date),
      renewal_token: invoice.token,
      frontend_url: process.env.FRONTEND_URL || 'http://localhost:3000',
    });
  }

  private async sendAlreadyPaidNotice(
    from: string,
    rent: Rent,
    invoice: RenewalInvoice,
  ): Promise<void> {
    const endStr = new Date(invoice.end_date).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    await this.templateSenderService.sendText(
      from,
      `You're already paid up for ${rent.property.name} through ${endStr}. No action needed.`,
    );
  }

  private async sendExistingRequestNudge(
    from: string,
    rent: Rent,
    invoice: RenewalInvoice,
  ): Promise<void> {
    const propertyTenant = await this.propertyTenantRepo.findOne({
      where: { id: invoice.property_tenant_id },
    });
    const user = await this.findTenantByPhone(from);

    await this.templateSenderService.sendText(
      from,
      `You already have a rent payment request for ${rent.property.name} that's still being reviewed by your landlord. We've nudged them again — you'll be notified once they respond.`,
    );

    if (propertyTenant && user) {
      await this.queueLandlordRequest(rent, user, invoice.id);
    }
  }

  // ─── Request-flow handlers (DRAFT / SENT / NEW) ──────────────────────

  /**
   * Mark an existing DRAFT or SENT row as awaiting landlord approval, then
   * DM the landlord with the bare request template. The row's snapshot
   * stays as-is — it's refreshed on the approve side from
   * resolveNextPeriodCharges so dashboard edits between request and
   * approve flow into the letter.
   */
  private async markRequestPendingAndDmLandlord(
    from: string,
    rent: Rent,
    propertyTenant: PropertyTenant,
    user: Users,
    invoice: RenewalInvoice,
  ): Promise<void> {
    invoice.approval_status = 'pending';
    await this.renewalInvoiceRepo.save(invoice);

    const queued = await this.queueLandlordRequest(rent, user, invoice.id);
    if (!queued) {
      await this.templateSenderService.sendText(
        from,
        'We could not reach your landlord. Please contact them directly.',
      );
      return;
    }

    await this.templateSenderService.sendText(
      from,
      `Your rent payment request for ${rent.property.name} has been sent to your landlord for approval. You'll be notified once they respond.`,
    );
  }

  /**
   * Create a fresh DRAFT row and DM the landlord with the request. The
   * row's terms are seeded from resolveNextPeriodCharges as a placeholder;
   * the approve handler re-snapshots before the letter is sent.
   */
  private async createRequestRowAndDmLandlord(
    from: string,
    rent: Rent,
    propertyTenant: PropertyTenant,
    accountId: string,
    user: Users,
  ): Promise<void> {
    const { fees, paymentFrequency, startDate, endDate } =
      await this.resolveNextPeriodCharges(rent);

    const periodCharge = sumRecurring(fees) + sumOneTime(fees);
    const findAmount = (kind: Fee['kind']): number =>
      fees.find((f) => f.kind === kind)?.amount ?? 0;
    const otherFeesPayload = fees
      .filter((f) => f.kind === 'other')
      .map((f) => ({
        externalId: f.externalId ?? '',
        name: f.label,
        amount: f.amount,
        recurring: f.recurring,
      }));

    const walletBal = rent.property?.owner_id
      ? await this.tenantBalancesService.getBalance(
          accountId,
          rent.property.owner_id,
        )
      : 0;
    // Exclude wallet OB owned by an active wallet-backed plan from the fold —
    // route through the single source of truth like every other fold site so
    // this request row never double-counts plan-owned debt (no ownLetterCharge:
    // brand-new request, no letter_accepted_charge yet).
    const claimedByPlans = rent.property?.owner_id
      ? await this.tenantBalancesService.sumActiveWalletBackedPlanClaims(
          accountId,
          rent.property.owner_id,
        )
      : 0;
    const { totalAmount, outstandingBalance } = computeRenewalFold({
      periodCharge,
      walletBalance: walletBal,
      claimedByPlans,
    });

    const invoice = this.renewalInvoiceRepo.create({
      token: uuidv4(),
      property_tenant_id: propertyTenant.id,
      property_id: rent.property_id,
      tenant_id: accountId,
      start_date: startDate,
      end_date: endDate,
      rent_amount: findAmount('rent'),
      service_charge: findAmount('service'),
      legal_fee: findAmount('legal'),
      agency_fee: findAmount('agency'),
      caution_deposit: findAmount('caution'),
      other_charges: 0,
      other_fees: otherFeesPayload,
      fee_breakdown: fees,
      total_amount: totalAmount,
      outstanding_balance: outstandingBalance,
      wallet_balance: walletBal,
      token_type: 'tenant',
      payment_status: RenewalPaymentStatus.UNPAID,
      approval_status: 'pending',
      letter_status: RenewalLetterStatus.DRAFT,
      payment_frequency: paymentFrequency,
    });
    await this.renewalInvoiceRepo.save(invoice);

    const queued = await this.queueLandlordRequest(rent, user, invoice.id);
    if (!queued) {
      await this.templateSenderService.sendText(
        from,
        'We could not reach your landlord. Please contact them directly.',
      );
      return;
    }

    await this.templateSenderService.sendText(
      from,
      `Your rent payment request for ${rent.property.name} has been sent to your landlord for approval. You'll be notified once they respond.`,
    );
  }

  /**
   * Queue the bare `renewal_request_landlord` template to the landlord.
   * Returns false if the landlord's phone can't be resolved (caller
   * surfaces a tenant-facing fallback in that case).
   */
  private async queueLandlordRequest(
    rent: Rent,
    user: Users,
    invoiceId: string,
  ): Promise<boolean> {
    const property = await this.propertyRepo.findOne({
      where: { id: rent.property_id },
      select: { id: true, owner_id: true },
    });

    const recipients = property
      ? await this.notificationRecipients.resolveRecipients(
          property.owner_id,
          NotificationCategory.RENEWALS,
        )
      : [];
    const reachable = recipients.filter((r) => r.phone);
    if (!reachable.length) {
      this.logger.warn(
        `Cannot send approval request: owner data missing for property ${rent.property_id}`,
      );
      return false;
    }

    const tenantName = `${this.utilService.toSentenceCase(user.first_name)} ${this.utilService.toSentenceCase(user.last_name)}`;

    for (const [index, recipient] of reachable.entries()) {
      await this.notificationLogService.queue(
        'sendRenewalRequestLandlord',
        {
          phone_number: recipient.phone,
          landlord_name: this.utilService.toSentenceCase(recipient.name),
          tenant_name: tenantName,
          property_name: rent.property.name,
          invoice_id: invoiceId,
        },
        index === 0 ? undefined : `${invoiceId}:${recipient.accountId}`,
      );
    }
    return true;
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
    askConfirmation = true,
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

    const recurringFees = rentToFees(rent).filter((f) => f.recurring);
    const feeLines = recurringFees
      .map((f) => `• ${f.label}: ${formatNGN(f.amount)}`)
      .join('\n');

    const detailsMessage =
      `Here are your tenancy details:\n\n` +
      `• Property: ${property.name}\n` +
      `• Location: ${property.location}\n` +
      `${feeLines}\n` +
      `• Tenancy start date: ${formatDate(rent.rent_start_date)}\n` +
      `• Tenancy end date: ${formatDate(rent.expiry_date)}`;

    console.log(
      '🔍 DEBUG: Sending details message for property:',
      property.name,
    );

    // Read-only view (e.g. the main-menu "View tenancy details") just shows
    // the details. The confirmation Yes/No prompt is reserved for onboarding,
    // where the tenant is being asked to verify their details for the first
    // time.
    if (!askConfirmation) {
      await this.templateSenderService.sendText(from, detailsMessage);
      return;
    }

    // The property under review rides in the button reply IDs (same
    // `action:payload` convention as confirm_tenancy_details), so the tap
    // still resolves no matter how long the tenant takes to answer. The cache
    // key stays only as a fallback for cards sent before IDs carried a payload.
    await this.cache.set(
      `tenancy_confirmation_pending_${from}`,
      property.id,
      this.SESSION_TIMEOUT_MS,
    );

    await this.templateSenderService.sendButtons(
      from,
      `${detailsMessage}\n\nAre these details correct?`,
      [
        {
          id: `tenancy_details_correct:${property.id}`,
          title: 'Yes, correct',
        },
        {
          id: `tenancy_details_incorrect:${property.id}`,
          title: 'No, not correct',
        },
      ],
    );
  }

  /**
   * Resolve which property a Yes/No confirmation tap refers to.
   * Priority: id embedded in the button reply ID (durable — survives any
   * delay between card and tap) → legacy pending-confirmation cache key
   * (cards sent before the IDs carried a payload; 5-minute TTL) → the
   * tenant's oldest ACTIVE unconfirmed tenancy (the same row the bot gate
   * would surface, so a stale pre-payload card still lands somewhere sane).
   */
  private async resolveTenancyUnderReview(
    from: string,
    buttonPropertyId?: string | null,
  ): Promise<string | null> {
    const cached = await this.cache.get<string>(
      `tenancy_confirmation_pending_${from}`,
    );
    await this.cache.delete(`tenancy_confirmation_pending_${from}`);

    if (buttonPropertyId) return buttonPropertyId;
    if (cached) return cached;

    const user = await this.findTenantByPhone(from);
    if (!user?.accounts?.length) return null;
    const oldestUnconfirmed = await this.propertyTenantRepo.findOne({
      where: {
        tenant_id: In(user.accounts.map((a) => a.id)),
        status: TenantStatusEnum.ACTIVE,
        details_confirmed_at: IsNull(),
      },
      order: { created_at: 'ASC' },
    });
    return oldestUnconfirmed?.property_id ?? null;
  }

  /**
   * Handle "Yes, correct" response — tenant confirmed their tenancy details.
   * Also notifies the landlord with status "Confirmed correct".
   */
  private async handleTenancyDetailsCorrect(
    from: string,
    buttonPropertyId?: string | null,
  ): Promise<void> {
    const propertyId = await this.resolveTenancyUnderReview(
      from,
      buttonPropertyId,
    );

    if (propertyId) {
      // Persist the confirmation so the bot gate (gateUnconfirmedTenant) lets
      // this tenant through. Clearing the per-session throttle key means that,
      // for a multi-property tenant, the next unconfirmed property's card shows
      // straight away on their next message.
      let newlyConfirmed = false;
      try {
        newlyConfirmed = await this.markTenancyDetailsConfirmed(
          from,
          propertyId,
        );
        await this.cache.delete(`tenancy_gate_card_shown_${from}`);
      } catch (err) {
        this.logger.error(
          'Failed to persist tenancy-details confirmation:',
          err,
        );
      }

      // Only notify on the NULL→confirmed transition — button payloads make
      // re-taps on the same card resolvable forever, and the landlord should
      // hear about a confirmation exactly once.
      if (newlyConfirmed) {
        try {
          await this.queueTenancyReviewLandlordNotification(
            from,
            propertyId,
            'Confirmed correct',
          );
        } catch (err) {
          this.logger.error(
            'Failed to queue landlord tenancy-review notification:',
            err,
          );
        }
      }
    }

    await this.templateSenderService.sendButtons(
      from,
      `Great, you're all set.\n\nYou can now use Lizt to report issues, make payments and stay updated.\n\nSimply tap Hi to get started.`,
      [{ id: 'main_menu', title: 'Hi' }],
    );
  }

  /**
   * Stamp `details_confirmed_at` on the tenant's ACTIVE tenancy for this
   * property — the durable record the bot gate reads. Resolved from the phone
   * the same way handleConfirmTenancyDetails does (tenant accounts + property +
   * ACTIVE), so the gate and this write agree on which row.
   */
  private async markTenancyDetailsConfirmed(
    from: string,
    propertyId: string,
  ): Promise<boolean> {
    const user = await this.findTenantByPhone(from);
    if (!user?.accounts?.length) return false;
    // details_confirmed_at IS NULL keeps a re-tap on an old card from
    // overwriting the original confirmation time; the affected count tells
    // the caller whether this tap was the NULL→confirmed transition.
    const result = await this.propertyTenantRepo.update(
      {
        tenant_id: In(user.accounts.map((a) => a.id)),
        property_id: propertyId,
        status: TenantStatusEnum.ACTIVE,
        details_confirmed_at: IsNull(),
      },
      { details_confirmed_at: new Date() },
    );
    return (result.affected ?? 0) > 0;
  }

  /**
   * Handle "No, not correct" response — tenant says details are wrong.
   * Notifies the landlord (status "Flagged as incorrect"), then prompts the
   * tenant for a free-text description of what's wrong. The reply is routed
   * by `cachedResponse` via the `awaiting_tenancy_dispute_reason:<id>` state.
   */
  private async handleTenancyDetailsIncorrect(
    from: string,
    buttonPropertyId?: string | null,
  ): Promise<void> {
    const propertyId = await this.resolveTenancyUnderReview(
      from,
      buttonPropertyId,
    );

    if (propertyId) {
      try {
        await this.queueTenancyReviewLandlordNotification(
          from,
          propertyId,
          'Flagged as incorrect',
        );
      } catch (err) {
        this.logger.error(
          'Failed to queue landlord tenancy-review notification:',
          err,
        );
      }

      await this.cache.set(
        `maintenance_request_state_${from}`,
        `awaiting_tenancy_dispute_reason:${propertyId}`,
        this.SESSION_TIMEOUT_MS,
      );
    }

    await this.templateSenderService.sendText(
      from,
      `Thanks for letting us know. Could you briefly tell us what's incorrect? Just type a short description.`,
    );
  }

  /**
   * Resolve landlord + tenant for the given phone/property and queue a
   * `tenancy_details_review_landlord` template via the notification log.
   * No-ops silently if either side is missing — caller logs at outer scope.
   */
  private async queueTenancyReviewLandlordNotification(
    from: string,
    propertyId: string,
    status: 'Confirmed correct' | 'Flagged as incorrect',
  ): Promise<void> {
    const property = await this.propertyRepo.findOne({
      where: { id: propertyId },
      select: { id: true, owner_id: true, name: true },
    });

    const recipients = property
      ? await this.notificationRecipients.resolveRecipients(
          property.owner_id,
          NotificationCategory.TENANCY,
        )
      : [];
    if (!recipients.some((r) => r.phone)) {
      this.logger.warn(
        `Cannot notify landlord of tenancy review: owner data missing for property ${propertyId}`,
      );
      return;
    }

    const tenant = await this.findTenantByPhone(from);
    if (!tenant) {
      this.logger.warn(
        `Cannot notify landlord of tenancy review: tenant not found for ${from}`,
      );
      return;
    }

    for (const recipient of recipients) {
      if (!recipient.phone) continue;
      const params: TenancyDetailsReviewLandlordParams = {
        phone_number: recipient.phone,
        landlord_name: this.utilService.toSentenceCase(recipient.name),
        tenant_name: `${this.utilService.toSentenceCase(
          tenant.first_name,
        )} ${this.utilService.toSentenceCase(tenant.last_name)}`,
        tenant_phone_number: this.toLocalPhone(tenant.phone_number),
        property_name: property!.name,
        status,
      };

      await this.notificationLogService.queue(
        'sendTenancyDetailsReviewLandlord',
        params,
      );
    }
  }

  /**
   * Handle the tenant's free-text dispute reason (Option B).
   * Sanitizes input — caps length, strips URLs and phone-shaped digit runs
   * — to keep the rendered Meta template within accepted bounds.
   */
  private async handleTenancyDisputeReason(
    from: string,
    text: string,
    userState: string,
  ): Promise<void> {
    const propertyId = userState.split(':')[1];
    if (!propertyId) {
      await this.cache.delete(`maintenance_request_state_${from}`);
      await this.showTenantMenu(from);
      return;
    }

    const sanitized = this.sanitizeDisputeReason(text);
    if (!sanitized) {
      // Keep the state so the next reply still routes here.
      await this.templateSenderService.sendText(
        from,
        `Sorry, we couldn't read that. Could you describe what's incorrect in a short sentence (no links or phone numbers please)?`,
      );
      return;
    }

    await this.cache.delete(`maintenance_request_state_${from}`);

    try {
      await this.queueTenancyDisputeReasonLandlordNotification(
        from,
        propertyId,
        sanitized,
      );
    } catch (err) {
      this.logger.error(
        'Failed to queue landlord dispute-reason notification:',
        err,
      );
    }

    await this.templateSenderService.sendText(
      from,
      `Thanks. We've shared this with your landlord — they'll be in touch.`,
    );
  }

  /**
   * Cap to 250 chars, strip URLs and any 7+ digit run (likely a phone
   * number), collapse whitespace. Returns trimmed string, or empty if
   * nothing usable remains.
   */
  private sanitizeDisputeReason(raw: string): string {
    if (!raw) return '';
    const stripped = raw
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/\bwww\.\S+/gi, '')
      .replace(/\b[a-z0-9-]+\.[a-z]{2,}\b/gi, '')
      .replace(/\d{7,}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!stripped) return '';
    return stripped.length > 250 ? `${stripped.slice(0, 247)}...` : stripped;
  }

  /**
   * Resolve landlord + tenant and queue a
   * `tenancy_details_dispute_reason_landlord` template.
   */
  private async queueTenancyDisputeReasonLandlordNotification(
    from: string,
    propertyId: string,
    reason: string,
  ): Promise<void> {
    const property = await this.propertyRepo.findOne({
      where: { id: propertyId },
      select: { id: true, owner_id: true, name: true },
    });

    const recipients = property
      ? await this.notificationRecipients.resolveRecipients(
          property.owner_id,
          NotificationCategory.TENANCY,
        )
      : [];
    if (!recipients.some((r) => r.phone)) {
      this.logger.warn(
        `Cannot notify landlord of dispute reason: owner data missing for property ${propertyId}`,
      );
      return;
    }

    const tenant = await this.findTenantByPhone(from);
    if (!tenant) {
      this.logger.warn(
        `Cannot notify landlord of dispute reason: tenant not found for ${from}`,
      );
      return;
    }

    for (const recipient of recipients) {
      if (!recipient.phone) continue;
      const params: TenancyDetailsDisputeReasonLandlordParams = {
        phone_number: recipient.phone,
        landlord_name: this.utilService.toSentenceCase(recipient.name),
        tenant_name: `${this.utilService.toSentenceCase(
          tenant.first_name,
        )} ${this.utilService.toSentenceCase(tenant.last_name)}`,
        property_name: property!.name,
        reason,
        tenant_phone_number: this.toLocalPhone(tenant.phone_number),
      };

      await this.notificationLogService.queue(
        'sendTenancyDetailsDisputeReasonLandlord',
        params,
      );
    }
  }

  /**
   * Tenant tapped "Yes, confirm" on a tenant_confirm_fm_request prompt.
   * Resolves tenant account from phone, calls
   * `confirmTenantMaintenanceRequest`, and renders a stale-tap reply on 409.
   */
  private async handleTenantConfirmMaintenanceRequest(
    from: string,
    requestId: string,
  ): Promise<void> {
    if (!requestId) return;

    const tenant = await this.findTenantByPhone(from);
    const tenantAccountId = tenant?.accounts?.[0]?.id;
    if (!tenantAccountId) {
      await this.templateSenderService.sendText(
        from,
        'We could not match this request to your account. Please contact your landlord.',
      );
      return;
    }

    const tenantFirstName =
      this.utilService.toSentenceCase(tenant?.first_name ?? '') || 'there';

    try {
      await this.maintenanceRequestService.confirmTenantMaintenanceRequest(
        requestId,
        tenantAccountId,
        'whatsapp',
      );
      await this.templateSenderService.sendText(
        from,
        `Thanks ${tenantFirstName} — we've let your landlord know.`,
      );
    } catch (err) {
      const message = (err as { message?: string })?.message ?? '';
      const status = (err as { status?: number })?.status;
      if (
        status === 409 ||
        message.toLowerCase().includes('no longer awaiting')
      ) {
        await this.templateSenderService.sendText(
          from,
          "This one's already been sorted — no need to respond.",
        );
        return;
      }
      if (status === 403) {
        await this.templateSenderService.sendText(
          from,
          'You cannot act on this request.',
        );
        return;
      }
      this.logger.warn(
        `Tenant confirm via WhatsApp failed for ${requestId}: ${message || err}`,
      );
      await this.templateSenderService.sendText(
        from,
        'Sorry, we could not record your response. Please try again shortly.',
      );
    }
  }

  /**
   * Tenant tapped "No, deny". Commits the denial immediately (no reason)
   * and notifies the landlord — the tenant shouldn't have to keep typing
   * for their tap to "stick". Caches an optional reason-capture state for
   * 5 min so the next reply (if any) becomes a follow-up reason patched
   * into the existing row. If the tenant never replies, the denial is
   * already complete — the cache key just expires.
   */
  private async handleTenantDenyMaintenanceRequestPrompt(
    from: string,
    requestId: string,
  ): Promise<void> {
    if (!requestId) return;

    const tenant = await this.findTenantByPhone(from);
    const tenantAccountId = tenant?.accounts?.[0]?.id;
    if (!tenantAccountId) {
      await this.templateSenderService.sendText(
        from,
        'We could not match this request to your account. Please contact your landlord.',
      );
      return;
    }

    const tenantFirstName =
      this.utilService.toSentenceCase(tenant?.first_name ?? '') || 'there';

    try {
      await this.maintenanceRequestService.denyTenantMaintenanceRequest(
        requestId,
        tenantAccountId,
        null,
        'whatsapp',
      );
    } catch (err) {
      const message = (err as { message?: string })?.message ?? '';
      const status = (err as { status?: number })?.status;
      if (
        status === 409 ||
        message.toLowerCase().includes('no longer awaiting')
      ) {
        await this.templateSenderService.sendText(
          from,
          "This one's already been sorted — no need to respond.",
        );
        return;
      }
      if (status === 404) {
        await this.templateSenderService.sendText(
          from,
          'This request was not found.',
        );
        return;
      }
      if (status === 403) {
        await this.templateSenderService.sendText(
          from,
          'You cannot act on this request.',
        );
        return;
      }
      this.logger.warn(
        `Tenant deny via WhatsApp failed for ${requestId}: ${message || err}`,
      );
      await this.templateSenderService.sendText(
        from,
        'Sorry, we could not record your response. Please try again shortly.',
      );
      return;
    }

    // Cache the optional reason-capture state. If the tenant never replies
    // the key expires after 5 min and the denial stands as-is.
    await this.cache.set(
      `tenant_deny_state_${from}`,
      { type: 'awaiting_tenant_deny_reason', requestId },
      this.SESSION_TIMEOUT_MS,
    );

    await this.templateSenderService.sendText(
      from,
      `Got it ${tenantFirstName} — your landlord has been notified.\n\nWant to add a quick reason? Reply now, or type 'skip' to wrap up.`,
    );
  }

  /**
   * Optional follow-up after a deny tap. Treats 'skip' / empty as a no-op;
   * a real reason gets patched into the already-denied MR's rejection_reason
   * column via `updateTenantDenialReason`. No second landlord WA ping —
   * the dashboard activity feed renders the reason once it lands.
   */
  private async handleTenantDenyReasonReply(
    from: string,
    text: string,
    state: { type?: string; requestId?: string },
  ): Promise<void> {
    if (state?.type !== 'awaiting_tenant_deny_reason' || !state.requestId) {
      await this.cache.delete(`tenant_deny_state_${from}`);
      return;
    }

    const trimmed = text.trim();
    const isSkip = trimmed.toLowerCase() === 'skip';

    if (isSkip || trimmed.length === 0) {
      await this.templateSenderService.sendText(from, 'All set.');
      await this.cache.delete(`tenant_deny_state_${from}`);
      return;
    }

    const tenant = await this.findTenantByPhone(from);
    const tenantAccountId = tenant?.accounts?.[0]?.id;
    if (!tenantAccountId) {
      await this.cache.delete(`tenant_deny_state_${from}`);
      await this.templateSenderService.sendText(
        from,
        'We could not match this request to your account. Please contact your landlord.',
      );
      return;
    }

    const tenantFirstName =
      this.utilService.toSentenceCase(tenant?.first_name ?? '') || 'there';

    try {
      await this.maintenanceRequestService.updateTenantDenialReason(
        state.requestId,
        tenantAccountId,
        trimmed,
      );
      await this.templateSenderService.sendText(
        from,
        `Thanks ${tenantFirstName} — we've added your reason to the record.`,
      );
      await this.cache.delete(`tenant_deny_state_${from}`);
    } catch (err) {
      const message = (err as { message?: string })?.message ?? '';
      this.logger.warn(
        `Tenant deny reason update failed for ${state.requestId}: ${message || err}`,
      );
      await this.templateSenderService.sendText(
        from,
        "We couldn't attach your reason just now — but the denial itself went through. You can mention this to your landlord directly.",
      );
      await this.cache.delete(`tenant_deny_state_${from}`);
    }
  }

  /**
   * Find tenant by phone number.
   * Hard-filters user.accounts to TENANT-role accounts that also appear as
   * tenant_id in PropertyTenant. Returns null if no account survives, so
   * callers can trust accounts[0] is a real, role-correct tenant account.
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
      accounts: user?.accounts?.map((a) => ({ id: a.id, roles: a.roles })),
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

    user.accounts = user.accounts.filter(
      (a) => accountHasRole(a, RolesEnum.TENANT) && tenantAccountIds.has(a.id),
    );
    if (!user.accounts.length) return null;
    return user;
  }
}

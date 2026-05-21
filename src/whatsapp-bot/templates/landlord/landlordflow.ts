import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { RolesEnum } from 'src/base.entity';
import { CacheService } from 'src/lib/cache';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import { Users } from 'src/users/entities/user.entity';
import { WhatsappUtils } from 'src/whatsapp-bot/utils/whatsapp';
import { Repository } from 'typeorm';
import { LandlordLookup } from './landlordlookup';
import { MaintenanceRequestsService } from 'src/maintenance-requests/maintenance-requests.service';
import { MaintenanceRequestStatusEnum } from 'src/maintenance-requests/dto/create-maintenance-request.dto';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { Account, accountHasRole } from 'src/users/entities/account.entity';
import { Property } from 'src/properties/entities/property.entity';
import {
  PropertyStatusEnum,
  TenantStatusEnum,
} from 'src/properties/dto/create-property.dto';
import { UtilService } from 'src/utils/utility-service';
import {
  RentPaymentStatusEnum,
  RentStatusEnum,
} from 'src/rents/dto/create-rent.dto';
import { Rent } from 'src/rents/entities/rent.entity';
import {
  RenewalInvoice,
  RenewalLetterStatus,
  RenewalPaymentStatus,
} from 'src/tenancies/entities/renewal-invoice.entity';
import { KYCLinksService } from 'src/kyc-links/kyc-links.service';
import { ChatLogService } from 'src/whatsapp-bot/chat-log.service';
import { ChatService } from 'src/chat/chat.service';
import { TemplateSenderService } from 'src/whatsapp-bot/template-sender';
import { WhatsAppNotificationLogService } from 'src/whatsapp-bot/whatsapp-notification-log.service';
import { TenantBalancesService } from 'src/tenant-balances/tenant-balances.service';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  rentToFees,
  nextPeriodFees,
  Fee,
} from 'src/common/billing/fees';

@Injectable()
export class LandlordFlow {
  private readonly logger = new Logger(LandlordFlow.name);
  private whatsappUtil: WhatsappUtils;
  private lookup: LandlordLookup;
  constructor(
    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,

    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,

    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,

    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepo: Repository<PropertyTenant>,

    @InjectRepository(MaintenanceRequest)
    private readonly maintenanceRequestRepo: Repository<MaintenanceRequest>,

    @InjectRepository(Rent)
    private readonly rentRepo: Repository<Rent>,

    @InjectRepository(RenewalInvoice)
    private readonly renewalInvoiceRepo: Repository<RenewalInvoice>,

    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepo: Repository<PropertyHistory>,

    private readonly cache: CacheService,
    private readonly utilService: UtilService,
    @Inject(forwardRef(() => KYCLinksService))
    private readonly kycLinksService: KYCLinksService,
    private readonly chatLogService: ChatLogService,
    private readonly templateSenderService: TemplateSenderService,
    private readonly notificationLogService: WhatsAppNotificationLogService,
    private readonly tenantBalancesService: TenantBalancesService,
    private readonly eventEmitter: EventEmitter2,
    private readonly maintenanceRequestsService: MaintenanceRequestsService,
    private readonly chatService: ChatService,
  ) {
    const config = new ConfigService();
    this.whatsappUtil = new WhatsappUtils(config, chatLogService);
    this.lookup = new LandlordLookup(
      cache,
      propertyRepo,
      usersRepo,
      accountRepo,
      propertyTenantRepo,
      maintenanceRequestRepo,
      utilService,
      kycLinksService,
      chatLogService,
    );
  }

  /**
   * Handle landlord TEXT input
   */
  async handleText(from: string, text: string) {
    // Handle "switch role" command for multi-role users
    if (
      text?.toLowerCase() === 'switch role' ||
      text?.toLowerCase() === 'switch'
    ) {
      await this.cache.delete(`selected_role_${from}`);
      await this.whatsappUtil.sendText(
        from,
        'Role cleared. Send any message to select a new role.',
      );
      return;
    }

    if (['done', 'menu'].includes(text?.toLowerCase())) {
      await this.cache.delete(`maintenance_approve_state_${from}`);
      await this.cache.delete(`maintenance_reject_state_${from}`);
      await this.cache.delete(`chat_awaiting_reply_${from}`);
      await this.lookup.handleExitOrMenu(from, text);
      return;
    }

    // Pending MR chat reply: the user tapped "Quick reply" on
    // mr_new_chat_message within the last 10 minutes. Treat this text as
    // their thread reply, post it via ChatService, and confirm. Done first
    // because it shadows every other state — once the user starts a reply
    // they almost certainly mean to finish it, and the alternative
    // (treating their text as a digit reply) is confusing.
    const chatReplyState = await this.cache.get(
      `chat_awaiting_reply_${from}`,
    );
    if (chatReplyState) {
      await this.handleMrChatReplyText(from, text, chatReplyState);
      return;
    }

    // Pending FM selection for an Approve tap takes priority over the
    // generic landlord state machine — the digit reply only makes sense
    // in this context.
    const approveState = await this.cache.get(
      `maintenance_approve_state_${from}`,
    );
    if (approveState) {
      await this.handleApproveFmDigitReply(from, text, approveState);
      return;
    }

    // Pending reason capture for a Reject confirm.
    const rejectState = await this.cache.get(
      `maintenance_reject_state_${from}`,
    );
    if (rejectState) {
      await this.handleRejectReasonReply(from, text, rejectState);
      return;
    }

    const raw = await this.cache.get(`maintenance_request_state_landlord_${from}`);
    if (!raw) {
      await this.lookup.handleExitOrMenu(from, text);
      return;
    }

    const state = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const { type, ids } = state ?? {};

    if (type === 'generate_kyc_link') {
      await this.lookup.handleGenerateKYCLinkText(from, text);
    } else if (type === 'maintenance') {
      await this.handleMaintenanceDigitReply(from, text, ids);
    } else if (type === 'tenancy') {
      await this.handleTenancyDigitReply(from, text, ids);
    } else {
      await this.lookup.handleExitOrMenu(from, text);
    }
  }

  /**
   * Resolve digit reply against the cached maintenance request id list,
   * show the picked request's detail, and (if still NOT_APPROVED) offer
   * Approve / Reject buttons that reuse the existing button-handler
   * payloads. Clears the cache when done so the next text falls back to
   * the menu instead of looping here.
   */
  private async handleMaintenanceDigitReply(
    from: string,
    text: string,
    ids: string[] | undefined,
  ): Promise<void> {
    if (!Array.isArray(ids) || ids.length === 0) {
      await this.cache.delete(`maintenance_request_state_landlord_${from}`);
      await this.lookup.handleExitOrMenu(from, text);
      return;
    }

    const idx = parseInt(text.trim(), 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= ids.length) {
      await this.whatsappUtil.sendText(
        from,
        'Invalid selection. Please reply with a valid number from the list.',
      );
      return;
    }

    const sr = await this.maintenanceRequestRepo.findOne({
      where: { id: ids[idx] },
      relations: ['property', 'tenant', 'tenant.user', 'facilityManager', 'facilityManager.account', 'facilityManager.account.user'],
    });

    if (!sr) {
      await this.cache.delete(`maintenance_request_state_landlord_${from}`);
      await this.whatsappUtil.sendText(from, 'That request was not found.');
      return;
    }

    const reportedDate = new Date(sr.date_reported).toLocaleDateString(
      'en-NG',
      { year: 'numeric', month: 'short', day: 'numeric' },
    );
    const reporter = sr.tenant?.user
      ? `${sr.tenant.user.first_name} ${sr.tenant.user.last_name}`.trim()
      : sr.tenant_name || 'Facility manager';
    const assignee = sr.facilityManager?.account?.profile_name
      || [sr.facilityManager?.account?.user?.first_name, sr.facilityManager?.account?.user?.last_name].filter(Boolean).join(' ')
      || null;

    const lines = [
      `*${sr.description}*`,
      '',
      `Property: ${sr.property?.name ?? sr.property_name ?? '—'}`,
      `Category: ${sr.issue_category}`,
      `Reporter: ${reporter}`,
      `Reported: ${reportedDate}`,
      `Status: ${sr.status}`,
    ];
    if (assignee) lines.push(`Assigned to: ${assignee}`);

    await this.whatsappUtil.sendText(from, lines.join('\n'));

    if (sr.status === MaintenanceRequestStatusEnum.NOT_APPROVED) {
      await this.whatsappUtil.sendButtons(
        from,
        'What would you like to do with this request?',
        [
          { id: `landlord_approve_mr:${sr.id}`, title: 'Approve' },
          { id: `landlord_reject_mr:${sr.id}`, title: 'Reject' },
        ],
      );
    }

    await this.cache.delete(`maintenance_request_state_landlord_${from}`);
  }

  /**
   * Resolve digit reply against the cached property-tenant id list and
   * show a one-shot summary for the picked tenancy. View-only; the
   * landlord acts on tenancies from the web app.
   */
  private async handleTenancyDigitReply(
    from: string,
    text: string,
    ids: string[] | undefined,
  ): Promise<void> {
    if (!Array.isArray(ids) || ids.length === 0) {
      await this.cache.delete(`maintenance_request_state_landlord_${from}`);
      await this.lookup.handleExitOrMenu(from, text);
      return;
    }

    const idx = parseInt(text.trim(), 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= ids.length) {
      await this.whatsappUtil.sendText(
        from,
        'Invalid selection. Please reply with a valid number from the list.',
      );
      return;
    }

    const pt = await this.propertyTenantRepo.findOne({
      where: { id: ids[idx] },
      relations: ['property', 'property.rents', 'tenant', 'tenant.user'],
    });

    if (!pt) {
      await this.cache.delete(`maintenance_request_state_landlord_${from}`);
      await this.whatsappUtil.sendText(from, 'That tenancy was not found.');
      return;
    }

    const latestRent = pt.property?.rents?.[pt.property.rents.length - 1] || null;
    const tenantName = pt.tenant?.user
      ? `${pt.tenant.user.first_name} ${pt.tenant.user.last_name}`.trim()
      : 'Vacant';
    const tenantPhone = pt.tenant?.user?.phone_number || '—';
    const rentAmount = latestRent?.rental_price
      ? Number(latestRent.rental_price).toLocaleString('en-NG', { style: 'currency', currency: 'NGN' })
      : '——';
    const expiry = latestRent?.expiry_date
      ? new Date(latestRent.expiry_date).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })
      : '——';

    const lines = [
      `*${pt.property?.name ?? 'Tenancy'}*`,
      '',
      `Tenant: ${tenantName}`,
      `Phone: ${tenantPhone}`,
      `Rent: ${rentAmount}/yr`,
      `Next rent due: ${expiry}`,
      `Status: ${pt.status}`,
    ];

    await this.whatsappUtil.sendText(from, lines.join('\n'));
    await this.cache.delete(`maintenance_request_state_landlord_${from}`);
  }

  /**
   * Handle landlord INTERACTIVE button clicks
   */
  async handleInteractive(message: any, from: string) {
    // Handle both interactive button_reply and direct button formats
    const buttonReply = message.interactive?.button_reply || message.button;
    const buttonId = buttonReply?.id || buttonReply?.payload;

    console.log('🔘 Landlord Button clicked:', {
      messageType: message.type,
      buttonReply,
      buttonId,
      from,
    });

    if (!buttonReply || !buttonId) {
      console.log('❌ No button reply found in message');
      return;
    }

    // Handle dynamic approval/decline buttons (id contains invoice UUID)
    if (buttonId.startsWith('approve_rent_request:')) {
      await this.handleApproveRentRequest(from, buttonId);
      return;
    }
    if (buttonId.startsWith('decline_rent_request:')) {
      await this.handleDeclineRentRequest(from, buttonId);
      return;
    }
    // Landlord tapped Download KYC on tenant_application_notification.
    // Hand off via event-emitter so this file doesn't depend on
    // KYCLinksModule (which would create a cycle). KycPdfService listens
    // and ships the kyc_application_attachment_landlord template (Msg 2).
    if (buttonId.startsWith('download_kyc:')) {
      const applicationId = buttonId.split('download_kyc:')[1];
      this.eventEmitter.emit('whatsapp.button.kyc_application_download', {
        applicationId,
        phone: from,
      });
      return;
    }

    // Maintenance request action buttons fired by the landlord notification.
    if (buttonId.startsWith('landlord_approve_mr:')) {
      const requestId = buttonId.split('landlord_approve_mr:')[1];
      await this.handleApproveMaintenanceRequest(from, requestId);
      return;
    }
    if (buttonId.startsWith('landlord_reject_mr:')) {
      const requestId = buttonId.split('landlord_reject_mr:')[1];
      await this.handleRejectMaintenanceRequestPrompt(from, requestId);
      return;
    }
    if (buttonId.startsWith('landlord_reject_confirm:')) {
      // payload shape: landlord_reject_confirm:<requestId>:<yes|no>
      const parts = buttonId.split(':');
      const requestId = parts[1];
      const answer = parts[2];
      if (answer === 'yes') {
        await this.handleRejectMaintenanceRequestConfirm(from, requestId);
      } else {
        await this.handleRejectMaintenanceRequestCancel(from, requestId);
      }
      return;
    }

    // Quick-reply tap on mr_new_chat_message — sets a 10-minute capture
    // window. The user's NEXT text inbound (handled in handleText) becomes
    // their reply in the MR thread. We use cache instead of a dedicated
    // state machine because the window is short and the payload is small.
    if (buttonId.startsWith('mr_chat_quick_reply:')) {
      const requestId = buttonId.split('mr_chat_quick_reply:')[1];
      await this.handleMrChatQuickReply(from, requestId);
      return;
    }

    const handlers: Record<string, () => Promise<void>> = {
      // URL buttons (view_properties, view_maintenance) redirect automatically
      // Only handle the quick reply button
      generate_kyc_link: () => this.lookup.startGenerateKYCLinkFlow(from),
      view_tenancies: () => this.lookup.handleViewTenancies(from),
      view_maintenance: () => this.lookup.handleViewMaintenance(from),
    };

    const handler = handlers[buttonId];
    console.log('🔍 Handler lookup:', {
      buttonId: buttonId,
      handlerFound: !!handler,
      availableHandlers: Object.keys(handlers),
    });

    if (handler) {
      console.log('✅ Executing handler for:', buttonId);
      await handler();
    } else {
      console.log('❌ No handler found for button:', buttonId);
    }
  }

  // ------------------------
  // RENT REQUEST APPROVAL FLOW
  // ------------------------

  /**
   * Handle landlord approving a tenant's rent payment request.
   *
   * Refreshes wallet/fee snapshot (so any dashboard edits the landlord made
   * between request and approve flow into the letter), flips
   * approval_status='approved', then routes by current letter_status:
   *   - DRAFT  → set letter_status=SENT, write history, emit event, queue
   *              renewal_request_approved template (URL → /renewal-letters)
   *   - SENT   → refresh letter_sent_at + queue renewal_request_approved
   *              again (re-pinging the tenant is the point — they didn't act
   *              on the prior letter)
   *   - ACCEPTED (cron auto-flip race) → queue renewal_link directly so the
   *              tenant skips the OTP they no longer need
   */
  private async handleApproveRentRequest(
    from: string,
    buttonId: string,
  ): Promise<void> {
    const invoiceId = buttonId.split('approve_rent_request:')[1];

    const invoice = await this.renewalInvoiceRepo.findOne({
      where: { id: invoiceId },
      relations: ['tenant', 'tenant.user', 'property', 'property.owner'],
    });

    if (!invoice) {
      await this.whatsappUtil.sendText(from, 'This request was not found.');
      return;
    }

    if (invoice.superseded_by_id) {
      await this.whatsappUtil.sendText(
        from,
        'This request has been replaced by a newer one.',
      );
      return;
    }

    // approval_status guard is the webhook idempotency token — second click
    // sees `'approved'`/`'declined'` and bails before re-firing the template.
    // Legacy (pre-migration) rows still use payment_status='pending_approval'.
    const isPending =
      invoice.approval_status === 'pending' ||
      invoice.payment_status === RenewalPaymentStatus.PENDING_APPROVAL;
    if (!isPending) {
      await this.whatsappUtil.sendText(
        from,
        'This request is no longer pending approval.',
      );
      return;
    }

    if (
      invoice.letter_status === RenewalLetterStatus.ACCEPTED &&
      invoice.payment_status === RenewalPaymentStatus.PAID
    ) {
      await this.whatsappUtil.sendText(
        from,
        `This rent payment for ${invoice.property.name} has already been completed.`,
      );
      return;
    }

    // Refresh fees + wallet so the letter reflects the latest terms. Only
    // re-snapshot the fees for tenant-originated rows (token_type='tenant')
    // — landlord-authored rows (token_type='landlord' or 'draft') already
    // carry intentional fee edits we mustn't blow away.
    const activeRent = await this.rentRepo.findOne({
      where: {
        property_id: invoice.property_id,
        tenant_id: invoice.tenant_id,
        rent_status: RentStatusEnum.ACTIVE,
      },
    });

    if (invoice.token_type === 'tenant' && activeRent) {
      const refreshed = nextPeriodFees(rentToFees(activeRent));
      const findAmount = (kind: Fee['kind']): number =>
        refreshed.find((f) => f.kind === kind)?.amount ?? 0;
      invoice.fee_breakdown = refreshed;
      invoice.rent_amount = findAmount('rent');
      invoice.service_charge = findAmount('service');
      invoice.legal_fee = findAmount('legal');
      invoice.agency_fee = findAmount('agency');
      invoice.caution_deposit = findAmount('caution');
      invoice.other_fees = refreshed
        .filter((f) => f.kind === 'other')
        .map((f) => ({
          externalId: f.externalId ?? '',
          name: f.label,
          amount: f.amount,
          recurring: f.recurring,
        }));
      invoice.payment_frequency =
        activeRent.payment_frequency || invoice.payment_frequency;
    }

    // Refresh wallet/OB always — tenant may have paid OB elsewhere between
    // request and approve. Running totals come from the refreshed
    // fee_breakdown (or kept snapshot for non-tenant rows).
    const ownerId = invoice.property.owner?.id ?? null;
    const periodCharge = (invoice.fee_breakdown ?? []).reduce(
      (acc: number, f: Fee) => acc + Number(f.amount ?? 0),
      0,
    );
    const walletBalance = ownerId
      ? await this.tenantBalancesService.getBalance(invoice.tenant_id, ownerId)
      : 0;
    invoice.wallet_balance = walletBalance;
    invoice.outstanding_balance = walletBalance < 0 ? -walletBalance : 0;
    invoice.total_amount = Math.max(0, periodCharge - walletBalance);

    invoice.approval_status = 'approved';

    const nowDate = new Date();
    let firedSentTransition = false;

    if (invoice.letter_status === RenewalLetterStatus.DRAFT) {
      invoice.letter_status = RenewalLetterStatus.SENT;
      invoice.letter_sent_at = nowDate;
      invoice.token_type = 'landlord';
      firedSentTransition = true;
    } else if (invoice.letter_status === RenewalLetterStatus.SENT) {
      // Re-pinging on re-request: refresh letter_sent_at so reminder
      // crons that key on it don't double-send.
      invoice.letter_sent_at = nowDate;
    }

    // Legacy: if the row still carries payment_status='pending_approval'
    // (pre-migration) flip it to UNPAID alongside approval_status.
    if (invoice.payment_status === RenewalPaymentStatus.PENDING_APPROVAL) {
      invoice.payment_status = RenewalPaymentStatus.UNPAID;
    }

    await this.renewalInvoiceRepo.save(invoice);

    if (firedSentTransition) {
      const tenantName = `${invoice.tenant.user.first_name} ${invoice.tenant.user.last_name}`;
      await this.propertyHistoryRepo.save(
        this.propertyHistoryRepo.create({
          property_id: invoice.property_id,
          tenant_id: invoice.tenant_id,
          event_type: 'renewal_letter_sent',
          event_description: `Tenancy renewal letter sent to ${tenantName} (tenant-initiated request).`,
          owner_comment: `Renewal letter dispatched after landlord approved bot-initiated rent request.`,
          related_entity_id: invoice.id,
          related_entity_type: 'renewal_invoice',
        }),
      );

      this.eventEmitter.emit('renewal.letter.sent', {
        property_id: invoice.property_id,
        property_name: invoice.property.name,
        tenant_id: invoice.tenant_id,
        tenant_name: tenantName,
        user_id: invoice.property.owner?.id ?? null,
        amount: invoice.total_amount,
        timestamp: nowDate.toISOString(),
      });
    }

    const tenantPhone = this.utilService.normalizePhoneNumber(
      invoice.tenant.user.phone_number,
    );
    const tenantFirstName = this.utilService.toSentenceCase(
      invoice.tenant.user.first_name,
    );

    if (invoice.letter_status === RenewalLetterStatus.ACCEPTED) {
      // Cron auto-flipped the letter to ACCEPTED between request and
      // approve — the tenant doesn't need to OTP, just pay.
      const fmtDate = (d: Date | string) =>
        new Date(d).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
      await this.notificationLogService.queue('sendRenewalLink', {
        phone_number: tenantPhone,
        tenant_name: tenantFirstName,
        property_name: invoice.property.name,
        start_date: fmtDate(invoice.start_date),
        end_date: fmtDate(invoice.end_date),
        renewal_token: invoice.token,
        frontend_url: process.env.FRONTEND_URL || 'http://localhost:3000',
      });
    } else {
      await this.notificationLogService.queue('sendRenewalRequestApproved', {
        phone_number: tenantPhone,
        tenant_name: tenantFirstName,
        property_name: invoice.property.name,
        renewal_token: invoice.token,
      });
    }

    await this.whatsappUtil.sendText(
      from,
      `You've approved the rent payment request for ${invoice.property.name}. The renewal letter has been sent to the tenant.`,
    );

    this.logger.log(
      `Rent request approved for invoice ${invoiceId}; tenant=${tenantPhone}, letter_status=${invoice.letter_status}`,
    );
  }

  /**
   * Handle landlord declining a tenant's rent payment request.
   *
   * A declined *request* is not a declined *letter* — `letter_status` is
   * left untouched. A DRAFT row stays DRAFT (landlord can still send via
   * dashboard); a SENT row stays SENT (the tenant still has the prior
   * letter link in their WhatsApp history).
   */
  private async handleDeclineRentRequest(
    from: string,
    buttonId: string,
  ): Promise<void> {
    const invoiceId = buttonId.split('decline_rent_request:')[1];

    const invoice = await this.renewalInvoiceRepo.findOne({
      where: { id: invoiceId },
      relations: ['tenant', 'tenant.user', 'property'],
    });

    if (!invoice) {
      await this.whatsappUtil.sendText(from, 'This request was not found.');
      return;
    }

    if (invoice.superseded_by_id) {
      await this.whatsappUtil.sendText(
        from,
        'This request has been replaced by a newer one.',
      );
      return;
    }

    const isPending =
      invoice.approval_status === 'pending' ||
      invoice.payment_status === RenewalPaymentStatus.PENDING_APPROVAL;
    if (!isPending) {
      await this.whatsappUtil.sendText(
        from,
        'This request is no longer pending approval.',
      );
      return;
    }

    invoice.approval_status = 'declined';
    // Legacy rows: clear the pending_approval marker on payment_status too.
    if (invoice.payment_status === RenewalPaymentStatus.PENDING_APPROVAL) {
      invoice.payment_status = RenewalPaymentStatus.UNPAID;
    }
    await this.renewalInvoiceRepo.save(invoice);

    await this.whatsappUtil.sendText(
      from,
      `You've declined the rent payment request for ${invoice.property.name}.`,
    );

    const tenantPhone = this.utilService.normalizePhoneNumber(
      invoice.tenant.user.phone_number,
    );
    const tenantFirstName = this.utilService.toSentenceCase(
      invoice.tenant.user.first_name,
    );

    await this.notificationLogService.queue('sendRenewalRequestDeclined', {
      phone_number: tenantPhone,
      tenant_name: tenantFirstName,
      property_name: invoice.property.name,
    });

    this.logger.log(`Rent request declined for invoice ${invoiceId}`);
  }

  // ------------------------
  // MAINTENANCE REQUEST ACTION FLOW (Assign / Reject)
  // ------------------------

  /**
   * Resolve the landlord's Account (and underlying Users row) from the
   * inbound phone number. Returns null if no landlord account is wired
   * up for that phone.
   */
  private async resolveLandlordAccount(
    from: string,
  ): Promise<{ accountId: string; user: Users; account: Account } | null> {
    const normalizedPhone = this.utilService.normalizePhoneNumber(from);
    const user = await this.usersRepo.findOne({
      where: { phone_number: normalizedPhone },
      relations: ['accounts'],
    });
    if (!user) return null;
    const landlordAccount = user.accounts?.find((a) =>
      accountHasRole(a, RolesEnum.LANDLORD),
    );
    if (!landlordAccount) return null;
    return { accountId: landlordAccount.id, user, account: landlordAccount };
  }

  /**
   * Stale-tap reply text. The landlord tapped a button on a notification
   * for a request that has already moved past NOT_APPROVED.
   */
  private staleTapReply(
    sr: MaintenanceRequest,
    assigneeName: string | null,
  ): string {
    switch (sr.status) {
      case MaintenanceRequestStatusEnum.APPROVED:
        return assigneeName
          ? `This request is already assigned to ${assigneeName}.`
          : 'This request has already been approved.';
      case MaintenanceRequestStatusEnum.RESOLVED:
        return 'This request has already been marked resolved.';
      case MaintenanceRequestStatusEnum.REOPENED:
        return 'This request has been reopened — manage it from the web app.';
      case MaintenanceRequestStatusEnum.CLOSED:
        return 'This request is already closed.';
      case MaintenanceRequestStatusEnum.REJECTED:
        return 'This request is already rejected.';
      default:
        return 'This request is no longer pending action.';
    }
  }

  private fmDisplayName(fm: TeamMember): string {
    const user = fm.account?.user;
    return (
      fm.account?.profile_name ||
      [user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
      'Facility Manager'
    );
  }

  private async handleApproveMaintenanceRequest(
    from: string,
    requestId: string,
  ): Promise<void> {
    const landlord = await this.resolveLandlordAccount(from);
    if (!landlord) {
      await this.whatsappUtil.sendText(
        from,
        'We could not find your landlord account. Please try again.',
      );
      return;
    }

    const sr = await this.maintenanceRequestRepo.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area', 'facilityManager', 'facilityManager.account', 'facilityManager.account.user'],
    });
    if (!sr) {
      await this.whatsappUtil.sendText(from, 'This request was not found.');
      return;
    }

    const ownerAccountId =
      sr.property?.owner_id ?? sr.common_area?.owner_id ?? null;
    if (ownerAccountId !== landlord.accountId) {
      await this.whatsappUtil.sendText(
        from,
        'You do not have access to this request.',
      );
      return;
    }

    if (sr.status !== MaintenanceRequestStatusEnum.NOT_APPROVED) {
      const assigneeName = sr.facilityManager
        ? this.fmDisplayName(sr.facilityManager)
        : null;
      await this.whatsappUtil.sendText(from, this.staleTapReply(sr, assigneeName));
      return;
    }

    const teamFms =
      await this.maintenanceRequestsService.findTeamFmsForLandlord(
        landlord.accountId,
      );

    if (!teamFms.length) {
      await this.whatsappUtil.sendText(
        from,
        "You don't have any facility managers yet. Add one in the web app before approving requests.",
      );
      return;
    }

    let response = 'Who should this request be assigned to?\n\n';
    teamFms.forEach((fm, i) => {
      response += `${i + 1}. ${this.fmDisplayName(fm)}\n`;
    });
    response += '\nReply with the number of the facility manager.';

    await this.whatsappUtil.sendText(from, response);

    await this.cache.set(
      `maintenance_approve_state_${from}`,
      {
        type: 'approve_fm',
        requestId,
        fmIds: teamFms.map((fm) => fm.id),
      },
      5 * 60 * 1000,
    );
  }

  private async handleApproveFmDigitReply(
    from: string,
    text: string,
    state: { type?: string; requestId?: string; fmIds?: string[] },
  ): Promise<void> {
    if (
      state?.type !== 'approve_fm' ||
      !state.requestId ||
      !Array.isArray(state.fmIds) ||
      state.fmIds.length === 0
    ) {
      // Corrupted state — clear and bail back to the main menu.
      await this.cache.delete(`maintenance_approve_state_${from}`);
      await this.lookup.handleExitOrMenu(from, text);
      return;
    }

    const selectedIndex = parseInt(text.trim(), 10) - 1;
    if (
      isNaN(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= state.fmIds.length
    ) {
      await this.whatsappUtil.sendText(
        from,
        'Invalid selection. Please reply with a valid number.',
      );
      return;
    }

    const teamMemberId = state.fmIds[selectedIndex];

    const landlord = await this.resolveLandlordAccount(from);
    if (!landlord) {
      await this.cache.delete(`maintenance_approve_state_${from}`);
      await this.whatsappUtil.sendText(
        from,
        'We could not find your landlord account. Please try again.',
      );
      return;
    }

    try {
      const updated =
        await this.maintenanceRequestsService.approveAndAssignMaintenanceRequest(
          state.requestId,
          teamMemberId,
          landlord.accountId,
          'whatsapp',
        );
      const assigneeName = updated.facilityManager
        ? this.fmDisplayName(updated.facilityManager)
        : 'the facility manager';
      await this.whatsappUtil.sendText(
        from,
        `Approved and assigned to ${assigneeName}.`,
      );
      await this.cache.delete(`maintenance_approve_state_${from}`);
    } catch (err) {
      const message = (err as { message?: string })?.message ?? '';
      const status = (err as { status?: number })?.status;
      if (status === 409 || message.toLowerCase().includes('no longer pending approval')) {
        const sr = await this.maintenanceRequestRepo.findOne({
          where: { id: state.requestId },
          relations: [
            'facilityManager',
            'facilityManager.account',
            'facilityManager.account.user',
          ],
        });
        if (sr) {
          const assigneeName = sr.facilityManager
            ? this.fmDisplayName(sr.facilityManager)
            : null;
          await this.whatsappUtil.sendText(from, this.staleTapReply(sr, assigneeName));
          await this.cache.delete(`maintenance_approve_state_${from}`);
          return;
        }
      }
      this.logger.warn(
        `Approve via WhatsApp failed for request ${state.requestId}: ${message || err}`,
      );
      await this.whatsappUtil.sendText(
        from,
        'Sorry, we could not approve this request. Please try again or use the web app.',
      );
      await this.cache.delete(`maintenance_approve_state_${from}`);
    }
  }

  private async handleRejectMaintenanceRequestPrompt(
    from: string,
    requestId: string,
  ): Promise<void> {
    const landlord = await this.resolveLandlordAccount(from);
    if (!landlord) {
      await this.whatsappUtil.sendText(
        from,
        'We could not find your landlord account. Please try again.',
      );
      return;
    }

    const sr = await this.maintenanceRequestRepo.findOne({
      where: { id: requestId },
      relations: [
        'property',
        'common_area',
        'facilityManager',
        'facilityManager.account',
        'facilityManager.account.user',
      ],
    });
    if (!sr) {
      await this.whatsappUtil.sendText(from, 'This request was not found.');
      return;
    }

    const ownerAccountId =
      sr.property?.owner_id ?? sr.common_area?.owner_id ?? null;
    if (ownerAccountId !== landlord.accountId) {
      await this.whatsappUtil.sendText(
        from,
        'You do not have access to this request.',
      );
      return;
    }

    if (sr.status !== MaintenanceRequestStatusEnum.NOT_APPROVED) {
      const assigneeName = sr.facilityManager
        ? this.fmDisplayName(sr.facilityManager)
        : null;
      await this.whatsappUtil.sendText(from, this.staleTapReply(sr, assigneeName));
      return;
    }

    await this.whatsappUtil.sendButtons(
      from,
      'Are you sure you want to reject this request?',
      [
        {
          id: `landlord_reject_confirm:${requestId}:yes`,
          title: 'Yes, reject',
        },
        {
          id: `landlord_reject_confirm:${requestId}:no`,
          title: 'No, cancel',
        },
      ],
    );
  }

  private async handleRejectMaintenanceRequestConfirm(
    from: string,
    requestId: string,
  ): Promise<void> {
    const landlord = await this.resolveLandlordAccount(from);
    if (!landlord) {
      await this.whatsappUtil.sendText(
        from,
        'We could not find your landlord account. Please try again.',
      );
      return;
    }

    // Re-check ownership + status here so we don't park the user in a
    // reason-capture state for a request that's already moved on.
    const sr = await this.maintenanceRequestRepo.findOne({
      where: { id: requestId },
      relations: [
        'property',
        'common_area',
        'facilityManager',
        'facilityManager.account',
        'facilityManager.account.user',
      ],
    });
    if (!sr) {
      await this.whatsappUtil.sendText(from, 'This request was not found.');
      return;
    }
    const ownerAccountId =
      sr.property?.owner_id ?? sr.common_area?.owner_id ?? null;
    if (ownerAccountId !== landlord.accountId) {
      await this.whatsappUtil.sendText(
        from,
        'You do not have access to this request.',
      );
      return;
    }
    if (sr.status !== MaintenanceRequestStatusEnum.NOT_APPROVED) {
      const assigneeName = sr.facilityManager
        ? this.fmDisplayName(sr.facilityManager)
        : null;
      await this.whatsappUtil.sendText(from, this.staleTapReply(sr, assigneeName));
      return;
    }

    await this.cache.set(
      `maintenance_reject_state_${from}`,
      { type: 'awaiting_reject_reason', requestId },
      5 * 60 * 1000,
    );

    await this.whatsappUtil.sendText(
      from,
      'Please tell us why you are rejecting this request, or type "skip" to reject without a reason.',
    );
  }

  private async handleRejectReasonReply(
    from: string,
    text: string,
    state: { type?: string; requestId?: string },
  ): Promise<void> {
    if (state?.type !== 'awaiting_reject_reason' || !state.requestId) {
      await this.cache.delete(`maintenance_reject_state_${from}`);
      await this.lookup.handleExitOrMenu(from, text);
      return;
    }

    const landlord = await this.resolveLandlordAccount(from);
    if (!landlord) {
      await this.cache.delete(`maintenance_reject_state_${from}`);
      await this.whatsappUtil.sendText(
        from,
        'We could not find your landlord account. Please try again.',
      );
      return;
    }

    const trimmed = text.trim();
    const isSkip = trimmed.toLowerCase() === 'skip';
    const reason = isSkip || trimmed.length === 0 ? null : trimmed;

    try {
      await this.maintenanceRequestsService.rejectMaintenanceRequest(
        state.requestId,
        landlord.accountId,
        reason,
        'whatsapp',
      );
      await this.whatsappUtil.sendText(
        from,
        reason ? 'Request rejected. Reason recorded.' : 'Request rejected.',
      );
      await this.cache.delete(`maintenance_reject_state_${from}`);
    } catch (err) {
      const message = (err as { message?: string })?.message ?? '';
      const status = (err as { status?: number })?.status;
      if (status === 409 || message.toLowerCase().includes('no longer pending approval')) {
        const sr = await this.maintenanceRequestRepo.findOne({
          where: { id: state.requestId },
          relations: [
            'facilityManager',
            'facilityManager.account',
            'facilityManager.account.user',
          ],
        });
        if (sr) {
          const assigneeName = sr.facilityManager
            ? this.fmDisplayName(sr.facilityManager)
            : null;
          await this.whatsappUtil.sendText(from, this.staleTapReply(sr, assigneeName));
          await this.cache.delete(`maintenance_reject_state_${from}`);
          return;
        }
      }
      this.logger.warn(
        `Reject via WhatsApp failed for request ${state.requestId}: ${message || err}`,
      );
      await this.whatsappUtil.sendText(
        from,
        'Sorry, we could not reject this request. Please try again or use the web app.',
      );
      await this.cache.delete(`maintenance_reject_state_${from}`);
    }
  }

  private async handleRejectMaintenanceRequestCancel(
    from: string,
    requestId: string,
  ): Promise<void> {
    await this.whatsappUtil.sendButtons(
      from,
      'OK, cancelled. What would you like to do?',
      [
        {
          id: `landlord_approve_mr:${requestId}`,
          title: 'Approve',
        },
        {
          id: `landlord_reject_mr:${requestId}`,
          title: 'Reject',
        },
      ],
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // MR chat — Quick reply via WhatsApp
  // ──────────────────────────────────────────────────────────────────────

  // Resolves any team account for this phone — landlord OR facility_manager.
  // The chat reply template can land on either role, so we pick whichever
  // account fits. Preference order: LANDLORD first (more authority), then FM.
  private async resolveTeamAccount(from: string): Promise<Account | null> {
    const normalizedPhone = this.utilService.normalizePhoneNumber(from);
    const user = await this.usersRepo.findOne({
      where: { phone_number: normalizedPhone },
      relations: ['accounts'],
    });
    if (!user) return null;
    const landlordAccount = user.accounts?.find((a) =>
      accountHasRole(a, RolesEnum.LANDLORD),
    );
    if (landlordAccount)
      return { ...landlordAccount, user } as Account;
    const fmAccount = user.accounts?.find((a) =>
      accountHasRole(a, RolesEnum.FACILITY_MANAGER),
    );
    if (fmAccount) return { ...fmAccount, user } as Account;
    return null;
  }

  // User tapped "Quick reply" on the mr_new_chat_message template. Opens a
  // 10-min capture window keyed by phone — the next inbound text becomes
  // their reply via handleMrChatReplyText. We store the request_id and the
  // resolved account so the follow-up text doesn't have to re-resolve and
  // can't get hijacked if someone else (somehow) shares the phone.
  private async handleMrChatQuickReply(
    from: string,
    requestId: string,
  ): Promise<void> {
    const account = await this.resolveTeamAccount(from);
    if (!account) {
      await this.whatsappUtil.sendText(
        from,
        "We couldn't find your account. Please open the request from your dashboard to reply.",
      );
      return;
    }

    const sr = await this.maintenanceRequestRepo.findOne({
      where: { request_id: requestId },
    });
    if (!sr) {
      await this.whatsappUtil.sendText(
        from,
        `Request ${requestId} was not found. It may have been deleted.`,
      );
      return;
    }

    await this.cache.set(
      `chat_awaiting_reply_${from}`,
      { mr_id: requestId, account_id: account.id },
      10 * 60 * 1000,
    );

    await this.whatsappUtil.sendText(
      from,
      `Send your reply for ${requestId} — we'll post it to the thread. Or send "done" to cancel.`,
    );
  }

  // Inbound text while a chat_awaiting_reply state is live. Resolves the
  // stored account, posts to ChatService, confirms or apologizes. State is
  // cleared regardless so a failed send doesn't trap the user.
  private async handleMrChatReplyText(
    from: string,
    text: string,
    rawState: unknown,
  ): Promise<void> {
    await this.cache.delete(`chat_awaiting_reply_${from}`);

    const state =
      typeof rawState === 'string'
        ? (JSON.parse(rawState) as { mr_id?: string; account_id?: string })
        : (rawState as { mr_id?: string; account_id?: string } | null);

    if (!state?.mr_id || !state?.account_id) {
      await this.whatsappUtil.sendText(
        from,
        'Your reply window expired. Tap "Quick reply" again on the notification.',
      );
      return;
    }

    const account = await this.accountRepo.findOne({
      where: { id: state.account_id },
      relations: ['user'],
    });
    if (!account) {
      await this.whatsappUtil.sendText(
        from,
        "We couldn't find your account. Please reply from the web app instead.",
      );
      return;
    }

    try {
      await this.chatService.sendMaintenanceChatMessage({
        requestId: state.mr_id,
        // Cast: ChatService treats the account as the JWT-style overlay
        // (full Account + scalar id). The shape matches at runtime.
        authorAccount: account as Account & { id: string },
        activeRole: account.roles?.[0] ?? RolesEnum.LANDLORD,
        content: text,
      });
      await this.whatsappUtil.sendText(
        from,
        `Posted to the thread on ${state.mr_id}.`,
      );
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'Unknown error';
      this.logger.warn(
        `MR chat WhatsApp reply failed for ${state.mr_id}: ${message}`,
      );
      await this.whatsappUtil.sendText(
        from,
        'Sorry, we could not post your reply. Please try again from the web app.',
      );
    }
  }
}

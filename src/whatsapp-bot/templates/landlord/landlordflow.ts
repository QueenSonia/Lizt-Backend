import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { RolesEnum } from 'src/base.entity';
import { CacheService } from 'src/lib/cache';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { Users } from 'src/users/entities/user.entity';
import { WhatsappUtils } from 'src/whatsapp-bot/utils/whatsapp';
import { Repository } from 'typeorm';
import { LandlordLookup } from './landlordlookup';
import { Account } from 'src/users/entities/account.entity';
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

    @InjectRepository(ServiceRequest)
    private readonly serviceRequestRepo: Repository<ServiceRequest>,

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
  ) {
    const config = new ConfigService();
    this.whatsappUtil = new WhatsappUtils(config, chatLogService);
    this.lookup = new LandlordLookup(
      cache,
      propertyRepo,
      usersRepo,
      accountRepo,
      propertyTenantRepo,
      serviceRequestRepo,
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
      await this.lookup.handleExitOrMenu(from, text);
      return;
    }

    const raw = await this.cache.get(`service_request_state_landlord_${from}`);
    if (!raw) {
      await this.lookup.handleExitOrMenu(from, text);
      return;
    }

    const { type } = raw;

    console.log({ type });

    if (type === 'generate_kyc_link') {
      await this.lookup.handleGenerateKYCLinkText(from, text);
    } else {
      await this.lookup.handleExitOrMenu(from, text);
    }
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
}

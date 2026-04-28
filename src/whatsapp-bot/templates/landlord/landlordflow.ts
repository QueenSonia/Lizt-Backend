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
  RenewalPaymentStatus,
} from 'src/tenancies/entities/renewal-invoice.entity';
import { KYCLinksService } from 'src/kyc-links/kyc-links.service';
import { ChatLogService } from 'src/whatsapp-bot/chat-log.service';
import { TemplateSenderService } from 'src/whatsapp-bot/template-sender';

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

    private readonly cache: CacheService,
    private readonly utilService: UtilService,
    @Inject(forwardRef(() => KYCLinksService))
    private readonly kycLinksService: KYCLinksService,
    private readonly chatLogService: ChatLogService,
    private readonly templateSenderService: TemplateSenderService,
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
   * Changes invoice from PENDING_APPROVAL to UNPAID and sends link to tenant.
   */
  private async handleApproveRentRequest(
    from: string,
    buttonId: string,
  ): Promise<void> {
    const invoiceId = buttonId.split('approve_rent_request:')[1];

    const invoice = await this.renewalInvoiceRepo.findOne({
      where: { id: invoiceId },
      relations: ['tenant', 'tenant.user', 'property'],
    });

    if (!invoice) {
      await this.whatsappUtil.sendText(from, 'This request was not found.');
      return;
    }

    if (invoice.payment_status !== RenewalPaymentStatus.PENDING_APPROVAL) {
      await this.whatsappUtil.sendText(
        from,
        'This request is no longer pending approval.',
      );
      return;
    }

    // Approve: change status to UNPAID so tenant can pay, and mark as landlord-generated
    invoice.payment_status = RenewalPaymentStatus.UNPAID;
    invoice.approval_status = 'approved';
    invoice.token_type = 'landlord';
    await this.renewalInvoiceRepo.save(invoice);

    // Notify landlord
    await this.whatsappUtil.sendText(
      from,
      `You've approved the rent payment request for ${invoice.property.name}. The payment link has been sent to the tenant.`,
    );

    // Send payment link to tenant using template with clickable button
    const tenantPhone = this.utilService.normalizePhoneNumber(
      invoice.tenant.user.phone_number,
    );
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const tenantName = `${this.utilService.toSentenceCase(invoice.tenant.user.first_name)}`;

    const fmtDate = (d: Date | string) =>
      new Date(d).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });

    await this.templateSenderService.sendRenewalLink({
      phone_number: tenantPhone,
      tenant_name: tenantName,
      property_name: invoice.property.name,
      start_date: fmtDate(invoice.start_date),
      end_date: fmtDate(invoice.end_date),
      renewal_token: invoice.token,
      frontend_url: frontendUrl,
    });

    this.logger.log(
      `Rent request approved for invoice ${invoiceId}, link sent to ${tenantPhone}`,
    );
  }

  /**
   * Handle landlord declining a tenant's rent payment request.
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

    if (invoice.payment_status !== RenewalPaymentStatus.PENDING_APPROVAL) {
      await this.whatsappUtil.sendText(
        from,
        'This request is no longer pending approval.',
      );
      return;
    }

    // Decline
    invoice.approval_status = 'declined';
    await this.renewalInvoiceRepo.save(invoice);

    // Notify landlord
    await this.whatsappUtil.sendText(
      from,
      `You've declined the rent payment request for ${invoice.property.name}.`,
    );

    // Notify tenant
    const tenantPhone = this.utilService.normalizePhoneNumber(
      invoice.tenant.user.phone_number,
    );
    const tenantName = `${this.utilService.toSentenceCase(invoice.tenant.user.first_name)}`;

    await this.whatsappUtil.sendText(
      tenantPhone,
      `Hi ${tenantName}, your rent payment request for ${invoice.property.name} was declined by your landlord. Please contact them for more details.`,
    );

    this.logger.log(`Rent request declined for invoice ${invoiceId}`);
  }
}

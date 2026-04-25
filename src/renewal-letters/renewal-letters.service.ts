import {
  Injectable,
  NotFoundException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PropertyTenant } from '../properties/entities/property-tenants.entity';
import { Property } from '../properties/entities/property.entity';
import { Rent } from '../rents/entities/rent.entity';
import { PropertyHistory } from '../property-history/entities/property-history.entity';
import {
  RenewalInvoice,
  RenewalLetterStatus,
} from '../tenancies/entities/renewal-invoice.entity';
import { RenewalLetterOtpService } from './renewal-letter-otp.service';
import { TemplateSenderService } from '../whatsapp-bot/template-sender';
import { UtilService } from '../utils/utility-service';
import {
  RenewalLetterPublicDto,
  InitiateAcceptanceResponseDto,
} from './dto/renewal-letter-public.dto';

@Injectable()
export class RenewalLettersService {
  private readonly logger = new Logger(RenewalLettersService.name);

  constructor(
    @InjectRepository(RenewalInvoice)
    private readonly renewalInvoiceRepository: Repository<RenewalInvoice>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(Rent)
    private readonly rentRepository: Repository<Rent>,
    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepository: Repository<PropertyHistory>,
    private readonly otpService: RenewalLetterOtpService,
    private readonly templateSenderService: TemplateSenderService,
    private readonly utilService: UtilService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Public letter fetch — token is supplied by tenant from their WhatsApp link.
   * Returns the sanitized body + structured fields the tenant page needs.
   * Superseded rows return isSuperseded=true with actions hidden client-side.
   */
  async getPublicLetter(token: string): Promise<RenewalLetterPublicDto> {
    const invoice = await this.loadInvoiceByToken(token);

    const { property, propertyTenant, landlordName, landlordCompany, landlordLogoUrl } =
      await this.loadLetterContext(invoice);

    // Find the current expiry to populate the "expires on the …" sentence.
    const activeRent = await this.rentRepository.findOne({
      where: { property_id: invoice.property_id, tenant_id: invoice.tenant_id },
      order: { created_at: 'DESC' },
    });

    const tenantUser = propertyTenant.tenant.user;
    const tenantName = `${tenantUser.first_name ?? ''} ${tenantUser.last_name ?? ''}`.trim();

    return {
      token: invoice.token,
      letterStatus: invoice.letter_status,
      paymentStatus: invoice.payment_status,
      letterBodyHtml: invoice.letter_body_html,
      letterBodyFields: invoice.letter_body_fields,
      tenantName,
      propertyName: property.name,
      propertyAddress: property.location ?? null,
      landlordName,
      landlordCompany,
      landlordLogoUrl,
      rentAmount: Number(invoice.rent_amount),
      serviceCharge:
        invoice.service_charge !== null && invoice.service_charge !== undefined
          ? Number(invoice.service_charge)
          : null,
      paymentFrequency: invoice.payment_frequency ?? 'Annually',
      startDate: this.toIsoDate(invoice.start_date),
      endDate: this.toIsoDate(invoice.end_date),
      currentExpiryDate: activeRent?.expiry_date
        ? this.toIsoDate(activeRent.expiry_date)
        : null,
      acceptanceOtp:
        invoice.letter_status === RenewalLetterStatus.ACCEPTED
          ? invoice.acceptance_otp
          : null,
      acceptedAt: invoice.accepted_at ? invoice.accepted_at.toISOString() : null,
      acceptedByPhone:
        invoice.letter_status === RenewalLetterStatus.ACCEPTED
          ? invoice.accepted_by_phone
          : null,
      autoRenewedAt: invoice.auto_renewed_at
        ? invoice.auto_renewed_at.toISOString()
        : null,
      declinedAt: invoice.declined_at ? invoice.declined_at.toISOString() : null,
      isSuperseded: invoice.superseded_by_id !== null,
      phoneLastFour: null,
    };
  }

  /**
   * Start OTP flow. Returns masked last-four so the tenant UI can confirm
   * which number received the code. Idempotent on already-accepted rows.
   */
  async initiateAcceptance(
    token: string,
  ): Promise<InitiateAcceptanceResponseDto> {
    const invoice = await this.loadInvoiceByToken(token);

    if (invoice.superseded_by_id) {
      throw new HttpException(
        'This renewal letter has been replaced by a newer version. Please check your WhatsApp for the current letter.',
        HttpStatus.GONE,
      );
    }
    if (invoice.letter_status !== RenewalLetterStatus.SENT) {
      throw new ConflictException(
        'This letter is not accepting new responses.',
      );
    }

    const { propertyTenant } = await this.loadLetterContext(invoice);
    const rawPhone = propertyTenant.tenant.user.phone_number;
    if (!rawPhone) {
      throw new NotFoundException('Tenant phone number not on file.');
    }
    const phone = this.utilService.normalizePhoneNumber(rawPhone);
    const phoneLastFour = phone.slice(-4);

    // Fire-and-forget — return immediately so the tenant isn't stuck waiting
    // on Meta's API to acknowledge the template send.
    this.otpService.initiateOTPVerification(token, phone).catch((err) => {
      this.logger.error(
        `Renewal OTP send failed for token ${token.substring(0, 8)}: ${err.message}`,
      );
    });

    return {
      message: 'OTP is being sent to your phone number',
      phoneLastFour,
    };
  }

  /**
   * Verify OTP and mark the letter accepted. Idempotent: a second call on
   * an already-accepted row returns the current state without re-firing the
   * post-accept WhatsApp.
   */
  async verifyOtpAndAccept(
    token: string,
    otp: string,
    ipAddress?: string,
  ): Promise<RenewalLetterPublicDto> {
    const invoice = await this.loadInvoiceByToken(token);

    if (invoice.superseded_by_id) {
      throw new HttpException(
        'This renewal letter has been replaced by a newer version. Please check your WhatsApp for the current letter.',
        HttpStatus.GONE,
      );
    }

    if (invoice.letter_status === RenewalLetterStatus.ACCEPTED) {
      // Idempotent — don't re-verify, don't re-fire invoice link.
      return this.getPublicLetter(token);
    }

    if (invoice.letter_status !== RenewalLetterStatus.SENT) {
      throw new ConflictException(
        'This letter is not accepting new responses.',
      );
    }

    // Consume the Redis OTP (throws on wrong/expired/locked).
    const verifiedOtp = await this.otpService.verifyOTP(token, otp);

    const { property, propertyTenant, landlordName } =
      await this.loadLetterContext(invoice);
    const tenantPhone = this.utilService.normalizePhoneNumber(
      propertyTenant.tenant.user.phone_number,
    );
    const tenantName = `${propertyTenant.tenant.user.first_name ?? ''} ${
      propertyTenant.tenant.user.last_name ?? ''
    }`.trim();

    await this.renewalInvoiceRepository.update(invoice.id, {
      letter_status: RenewalLetterStatus.ACCEPTED,
      accepted_at: new Date(),
      accepted_by_phone: tenantPhone,
      acceptance_otp: verifiedOtp,
      decision_made_at: new Date(),
      decision_made_ip: ipAddress ?? null,
    });

    // Audit entry.
    try {
      await this.propertyHistoryRepository.save({
        property_id: invoice.property_id,
        tenant_id: invoice.tenant_id,
        event_type: 'renewal_letter_accepted',
        event_description: `${tenantName} accepted the renewal letter for ${property.name}`,
        related_entity_id: invoice.id,
        related_entity_type: 'renewal_invoice',
      });
    } catch (err) {
      this.logger.error(
        `Failed to record renewal_letter_accepted history: ${err.message}`,
      );
    }

    // Livefeed — matches the offer-letter acceptance notification pattern.
    this.eventEmitter.emit('renewal.letter.accepted', {
      property_id: invoice.property_id,
      property_name: property.name,
      tenant_id: invoice.tenant_id,
      tenant_name: tenantName,
      user_id: propertyTenant.property.owner_id,
    });

    // Send the payment invoice link WhatsApp — same template the offer-letter
    // flow uses post-accept. Fire-and-forget: failure here shouldn't block
    // the acceptance write.
    try {
      await this.templateSenderService.sendPaymentInvoiceLink({
        phone_number: tenantPhone,
        tenant_name: tenantName,
        property_name: property.name,
        invoice_url: invoice.token,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send renewal payment-invoice-link WhatsApp: ${err.message}`,
        err.stack,
      );
    }

    return this.getPublicLetter(token);
    void landlordName; // keep landlordName resolution for potential future notifier
  }

  /**
   * Tenant declines the renewal. Locks the row to `declined`, notifies the
   * landlord. Cannot reach the payment page (payment gate requires
   * letter_status=accepted).
   */
  async reject(
    token: string,
    reason?: string,
    ipAddress?: string,
  ): Promise<RenewalLetterPublicDto> {
    const invoice = await this.loadInvoiceByToken(token);

    if (invoice.superseded_by_id) {
      throw new HttpException(
        'This renewal letter has been replaced by a newer version. Please check your WhatsApp for the current letter.',
        HttpStatus.GONE,
      );
    }

    if (invoice.letter_status === RenewalLetterStatus.DECLINED) {
      return this.getPublicLetter(token);
    }

    if (invoice.letter_status !== RenewalLetterStatus.SENT) {
      throw new ConflictException(
        'This letter is not accepting new responses.',
      );
    }

    await this.renewalInvoiceRepository.update(invoice.id, {
      letter_status: RenewalLetterStatus.DECLINED,
      declined_at: new Date(),
      decline_reason: reason?.trim() || null,
      decision_made_at: new Date(),
      decision_made_ip: ipAddress ?? null,
    });

    const { property, propertyTenant, landlordName } =
      await this.loadLetterContext(invoice);
    const tenantName = `${propertyTenant.tenant.user.first_name ?? ''} ${
      propertyTenant.tenant.user.last_name ?? ''
    }`.trim();

    try {
      await this.propertyHistoryRepository.save({
        property_id: invoice.property_id,
        tenant_id: invoice.tenant_id,
        event_type: 'renewal_letter_declined',
        event_description: `${tenantName} declined the renewal letter for ${property.name}`,
        related_entity_id: invoice.id,
        related_entity_type: 'renewal_invoice',
      });
    } catch (err) {
      this.logger.error(
        `Failed to record renewal_letter_declined history: ${err.message}`,
      );
    }

    // Livefeed — decline is time-sensitive, the landlord sees it alongside
    // the WhatsApp notice.
    this.eventEmitter.emit('renewal.letter.declined', {
      property_id: invoice.property_id,
      property_name: property.name,
      tenant_id: invoice.tenant_id,
      tenant_name: tenantName,
      user_id: propertyTenant.property.owner_id,
    });

    // Notify the landlord via WhatsApp. Required notification — still
    // wrapped so a Meta outage doesn't break the decline write.
    const landlordPhoneRaw =
      propertyTenant.property.owner?.user?.phone_number ?? null;
    if (landlordPhoneRaw) {
      try {
        await this.templateSenderService.sendRenewalLetterDeclinedNotice({
          phone_number: this.utilService.normalizePhoneNumber(landlordPhoneRaw),
          landlord_name: landlordName,
          tenant_name: tenantName,
          property_name: property.name,
        });
      } catch (err) {
        this.logger.error(
          `Failed to send landlord decline notice: ${err.message}`,
          err.stack,
        );
      }
    }

    return this.getPublicLetter(token);
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private async loadInvoiceByToken(token: string): Promise<RenewalInvoice> {
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { token },
    });
    if (!invoice) {
      throw new NotFoundException('Renewal letter not found');
    }
    // Allow both 'landlord' (sent letter) and 'draft' (saved-but-not-sent)
    // tokens through this gate so the tenant page can render a preview
    // for drafts. The action endpoints (accept / verify-otp / reject)
    // independently gate on letter_status === 'sent', so drafts can only
    // be viewed, never accepted. Tenant-initiated rows (e.g. WhatsApp
    // "Pay OB") use a different token type and are still rejected.
    if (invoice.token_type !== 'landlord' && invoice.token_type !== 'draft') {
      throw new NotFoundException('Renewal letter not found');
    }
    return invoice;
  }

  private async loadLetterContext(invoice: RenewalInvoice) {
    const propertyTenant = await this.propertyTenantRepository.findOne({
      where: { id: invoice.property_tenant_id },
      relations: [
        'property',
        'property.owner',
        'property.owner.user',
        'tenant',
        'tenant.user',
      ],
    });
    if (!propertyTenant) {
      throw new NotFoundException('Tenancy not found for this letter');
    }

    const property = await this.propertyRepository.findOne({
      where: { id: invoice.property_id },
    });
    if (!property) {
      throw new NotFoundException('Property not found for this letter');
    }

    const landlordAccount = propertyTenant.property.owner;
    const landlordUser = landlordAccount?.user;
    const landlordName =
      landlordAccount?.profile_name ||
      `${landlordUser?.first_name ?? ''} ${landlordUser?.last_name ?? ''}`
        .trim() ||
      'Your Landlord';
    const landlordCompany: string | null =
      landlordUser?.branding?.businessName ||
      landlordUser?.business_name ||
      null;
    const landlordLogoUrl: string | null =
      (landlordUser?.logo_urls && landlordUser.logo_urls[0]) || null;

    return { property, propertyTenant, landlordName, landlordCompany, landlordLogoUrl };
  }

  private toIsoDate(value: Date | string): string {
    if (value instanceof Date) return value.toISOString().split('T')[0];
    const s = String(value);
    return s.includes('T') ? s.split('T')[0] : s;
  }
}

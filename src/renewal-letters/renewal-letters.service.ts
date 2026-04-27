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
import { RenewalLetterPdfService } from '../pdf/renewal-letter-pdf.service';
import {
  RenewalLetterPublicDto,
  InitiateOtpResponseDto,
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
    private readonly renewalLetterPdfService: RenewalLetterPdfService,
  ) {}

  /**
   * Render the signed-letter PDF and dispatch the renewal_letter_signed
   * WhatsApp template to the tenant. Used by both accept and decline
   * paths — the only thing that differs is the `outcome` parameter and
   * the stamp baked into the rendered HTML (driven off letter_status
   * which the caller has already updated to ACCEPTED/DECLINED).
   *
   * Wrapped in try/catch by the caller — a Cloudinary or Meta failure
   * here must NOT unwind the accept/decline write.
   */
  private async dispatchSignedLetterPdf(
    invoice: RenewalInvoice,
    propertyName: string,
    tenantPhone: string,
    tenantFirstName: string,
    outcome: 'accepted' | 'declined',
    decisionAt: Date,
  ): Promise<void> {
    const pdfUrl = await this.renewalLetterPdfService.generateAndUpload(
      invoice.id,
    );
    const filename = this.renewalLetterPdfService.buildFilename(
      propertyName,
      decisionAt,
    );
    const decisionDate = decisionAt.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    await this.templateSenderService.sendRenewalLetterSigned({
      phone_number: tenantPhone,
      tenant_first_name: tenantFirstName,
      property_name: propertyName,
      outcome,
      decision_date: decisionDate,
      pdf_url: pdfUrl,
      pdf_filename: filename,
    });
  }

  private firstName(fullName: string): string {
    const HONORIFIC =
      /^(mr|mrs|miss|ms|mx|dr|prof|sir|madam|chief|engr|hon|rev)\.?$/i;
    return (
      (fullName ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .find((t) => !HONORIFIC.test(t)) || (fullName?.trim() || 'there')
    );
  }

  /**
   * Public letter fetch — token is supplied by tenant from their WhatsApp link.
   * Returns the sanitized body + structured fields the tenant page needs.
   * Superseded rows return isSuperseded=true with actions hidden client-side.
   */
  async getPublicLetter(token: string): Promise<RenewalLetterPublicDto> {
    const invoice = await this.loadInvoiceByToken(token);

    const {
      property,
      propertyTenant,
      landlordName,
      landlordCompany,
      landlordLogoUrl,
      landlordSignatureUrl,
      landlordBusinessAddress,
      landlordContactEmail,
      landlordContactPhone,
      landlordWebsite,
    } = await this.loadLetterContext(invoice);

    // Find the current expiry to populate the "expires on the …" sentence.
    const activeRent = await this.rentRepository.findOne({
      where: { property_id: invoice.property_id, tenant_id: invoice.tenant_id },
      order: { created_at: 'DESC' },
    });

    const tenantUser = propertyTenant.tenant.user;
    const tenantName = `${tenantUser.first_name ?? ''} ${tenantUser.last_name ?? ''}`.trim();
    const tenantWhatsApp = tenantUser.phone_number ?? null;
    const tenantEmail = tenantUser.email ?? null;

    return {
      token: invoice.token,
      letterStatus: invoice.letter_status,
      paymentStatus: invoice.payment_status,
      letterBodyHtml: invoice.letter_body_html,
      letterBodyFields: invoice.letter_body_fields,
      letterSentAt: invoice.letter_sent_at
        ? invoice.letter_sent_at.toISOString()
        : null,
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
      legalFee:
        invoice.legal_fee !== null && invoice.legal_fee !== undefined
          ? Number(invoice.legal_fee)
          : null,
      agencyFee:
        invoice.agency_fee !== null && invoice.agency_fee !== undefined
          ? Number(invoice.agency_fee)
          : null,
      cautionDeposit:
        invoice.caution_deposit !== null && invoice.caution_deposit !== undefined
          ? Number(invoice.caution_deposit)
          : null,
      otherFees: Array.isArray(invoice.other_fees)
        ? invoice.other_fees.map((f) => ({
            externalId: f.externalId,
            name: f.name,
            amount: Number(f.amount),
            recurring: !!f.recurring,
          }))
        : null,
      paymentFrequency: invoice.payment_frequency ?? 'Annually',
      startDate: this.toIsoDate(invoice.start_date),
      endDate: this.toIsoDate(invoice.end_date),
      currentExpiryDate: activeRent?.expiry_date
        ? this.toIsoDate(activeRent.expiry_date)
        : null,
      tenantWhatsApp,
      tenantEmail,
      landlordSignatureUrl,
      landlordBusinessAddress,
      landlordContactEmail,
      landlordContactPhone,
      landlordWebsite,
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
      declineOtp:
        invoice.letter_status === RenewalLetterStatus.DECLINED
          ? invoice.decline_otp
          : null,
      declinedByPhone:
        invoice.letter_status === RenewalLetterStatus.DECLINED
          ? invoice.declined_by_phone
          : null,
      isSuperseded: invoice.superseded_by_id !== null,
      phoneLastFour: null,
    };
  }

  /**
   * Start OTP flow for accept. Returns masked last-four so the tenant UI
   * can confirm which number received the code. Idempotent on already-
   * accepted rows.
   */
  async initiateAcceptance(token: string): Promise<InitiateOtpResponseDto> {
    return this.initiateOtp(token, 'accept');
  }

  /**
   * Start OTP flow for reject. Mirror of `initiateAcceptance`. Idempotent
   * on already-declined rows is enforced inside `verifyOtpAndReject`; here
   * we just refuse to send a fresh code once the row has left SENT.
   */
  async initiateRejection(token: string): Promise<InitiateOtpResponseDto> {
    return this.initiateOtp(token, 'reject');
  }

  private async initiateOtp(
    token: string,
    intent: 'accept' | 'reject',
  ): Promise<InitiateOtpResponseDto> {
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

    // Synchronous: surface the 60s cooldown 429 and any Meta delivery
    // failure to the tenant. Previously fire-and-forget — which silently
    // swallowed both, letting the modal toast "code sent" while no code
    // actually left the system.
    await this.otpService.initiateOTPVerification(token, intent, phone);

    return {
      message: 'Verification code sent to your phone number',
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
    const verifiedOtp = await this.otpService.verifyOTP(token, 'accept', otp);

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

    // Send the renewal-invoice link WhatsApp. We deliberately use
    // `renewal_link` (URL → /renewal-invoice/{token}) rather than the
    // offer-letter `payment_invoice_link` template (URL → /offer-letters/
    // invoice/{token}), because the token here is a renewal_invoice token
    // and the offer-letters page would 404 on it. Fire-and-forget: failure
    // here shouldn't block the acceptance write.
    try {
      await this.templateSenderService.sendRenewalLink({
        phone_number: tenantPhone,
        tenant_name: tenantName,
        renewal_token: invoice.token,
        frontend_url: '',
      });
    } catch (err) {
      this.logger.error(
        `Failed to send renewal-link WhatsApp post-acceptance: ${err.message}`,
        err.stack,
      );
    }

    // Notify the landlord via WhatsApp. Mirrors the decline path — fire-
    // and-forget so a Meta outage doesn't break the acceptance write.
    const landlordPhoneRaw =
      propertyTenant.property.owner?.user?.phone_number ?? null;
    if (landlordPhoneRaw) {
      try {
        await this.templateSenderService.sendRenewalLetterAcceptedNotice({
          phone_number: this.utilService.normalizePhoneNumber(landlordPhoneRaw),
          landlord_name: landlordName,
          tenant_name: tenantName,
          property_name: property.name,
        });
      } catch (err) {
        const e = err as { message?: string; stack?: string };
        this.logger.error(
          `Failed to send landlord accept notice: ${e.message}`,
          e.stack,
        );
      }
    }

    // Render and dispatch the signed-letter PDF to the tenant. Refetch
    // the row so the rendered stamp reflects the just-written ACCEPTED
    // state. Failure here must NOT unwind the accept — the row is
    // already updated and downstream actions (payment, audit) don't
    // depend on this artefact.
    try {
      const refreshed = await this.renewalInvoiceRepository.findOne({
        where: { id: invoice.id },
      });
      if (refreshed) {
        await this.dispatchSignedLetterPdf(
          refreshed,
          property.name,
          tenantPhone,
          this.firstName(tenantName),
          'accepted',
          refreshed.accepted_at ?? new Date(),
        );
      }
    } catch (err) {
      const e = err as { message?: string; stack?: string };
      this.logger.error(
        `Failed to dispatch signed renewal letter (accept): ${e.message}`,
        e.stack,
      );
    }

    return this.getPublicLetter(token);
  }

  /**
   * Verify OTP and mark the letter declined. Mirrors `verifyOtpAndAccept`:
   * idempotent on already-declined rows, locks to `declined` on success,
   * notifies the landlord. Cannot reach the payment page (payment gate
   * requires letter_status=accepted).
   */
  async verifyOtpAndReject(
    token: string,
    otp: string,
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
      // Idempotent — don't re-verify, don't re-fire landlord notice.
      return this.getPublicLetter(token);
    }

    if (invoice.letter_status !== RenewalLetterStatus.SENT) {
      throw new ConflictException(
        'This letter is not accepting new responses.',
      );
    }

    // Consume the Redis OTP (throws on wrong/expired/locked).
    const verifiedOtp = await this.otpService.verifyOTP(token, 'reject', otp);

    const { property, propertyTenant, landlordName } =
      await this.loadLetterContext(invoice);
    const tenantPhone = this.utilService.normalizePhoneNumber(
      propertyTenant.tenant.user.phone_number,
    );
    const tenantName = `${propertyTenant.tenant.user.first_name ?? ''} ${
      propertyTenant.tenant.user.last_name ?? ''
    }`.trim();

    await this.renewalInvoiceRepository.update(invoice.id, {
      letter_status: RenewalLetterStatus.DECLINED,
      declined_at: new Date(),
      declined_by_phone: tenantPhone,
      decline_otp: verifiedOtp,
      decline_reason: reason?.trim() || null,
      decision_made_at: new Date(),
      decision_made_ip: ipAddress ?? null,
    });

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
        const e = err as { message?: string; stack?: string };
        this.logger.error(
          `Failed to send landlord decline notice: ${e.message}`,
          e.stack,
        );
      }
    }

    // Render and dispatch the signed-letter PDF to the tenant — same
    // pattern as the accept path, just with `outcome: 'declined'` and
    // the DECLINED stamp baked in via letter_status.
    try {
      const refreshed = await this.renewalInvoiceRepository.findOne({
        where: { id: invoice.id },
      });
      if (refreshed) {
        await this.dispatchSignedLetterPdf(
          refreshed,
          property.name,
          tenantPhone,
          this.firstName(tenantName),
          'declined',
          refreshed.declined_at ?? new Date(),
        );
      }
    } catch (err) {
      const e = err as { message?: string; stack?: string };
      this.logger.error(
        `Failed to dispatch signed renewal letter (decline): ${e.message}`,
        e.stack,
      );
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
    // for drafts. The action endpoints (accept / accept/verify / reject /
    // reject/verify)
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
    // Prefer the admin-settings branding letterhead (where landlords now
    // configure their logo) over the legacy logo_urls slot. This is the same
    // source the landlord-side RenewTenancyScreen reads via useLandlordBranding,
    // so the tenant sees the same logo the landlord saw at save time.
    const landlordLogoUrl: string | null =
      landlordUser?.branding?.letterhead ||
      (landlordUser?.logo_urls && landlordUser.logo_urls[0]) ||
      null;

    // Branding footer fields — surfaced on the tenant page so the structural
    // letter render can show the landlord's business address / contacts /
    // website at the bottom of the document, matching the App.tsx design
    // reference. All optional.
    const landlordSignatureUrl: string | null =
      landlordUser?.branding?.signature ?? null;
    const landlordBusinessAddress: string | null =
      landlordUser?.branding?.businessAddress ?? null;
    const landlordContactEmail: string | null =
      landlordUser?.branding?.contactEmail ?? null;
    const landlordContactPhone: string | null =
      landlordUser?.branding?.contactPhone ?? null;
    const landlordWebsite: string | null =
      landlordUser?.branding?.websiteLink ?? null;

    return {
      property,
      propertyTenant,
      landlordName,
      landlordCompany,
      landlordLogoUrl,
      landlordSignatureUrl,
      landlordBusinessAddress,
      landlordContactEmail,
      landlordContactPhone,
      landlordWebsite,
    };
  }

  private toIsoDate(value: Date | string): string {
    if (value instanceof Date) return value.toISOString().split('T')[0];
    const s = String(value);
    return s.includes('T') ? s.split('T')[0] : s;
  }
}

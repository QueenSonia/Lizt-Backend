import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RenewalLetterStatus } from '../../tenancies/entities/renewal-invoice.entity';

/**
 * Public-facing renewal letter payload. Excludes tenant PII that isn't
 * already in the tenant's possession. `letterBodyHtml` is server-sanitized
 * before being placed here — the client still re-sanitizes on render.
 */
export class RenewalLetterPublicDto {
  @ApiProperty() token: string;
  @ApiProperty({ enum: RenewalLetterStatus }) letterStatus: RenewalLetterStatus;
  @ApiProperty() paymentStatus: string;

  @ApiPropertyOptional() letterBodyHtml: string | null;
  @ApiPropertyOptional() letterBodyFields: Record<string, unknown> | null;

  /**
   * Wall-clock moment the letter transitioned to SENT (manual Send button or
   * cron draft-promotion). Null while the letter is a draft. The client uses
   * this to override the date baked into letterBodyHtml at render time, so
   * the date the tenant sees reflects when the letter was issued, not when
   * the landlord first saved it.
   */
  @ApiPropertyOptional() letterSentAt: string | null;

  // Structured fields — used as a fallback when letterBodyHtml is NULL
  // (pre-migration rows) or when the tenant UI prefers the template render.
  @ApiProperty() tenantName: string;
  @ApiProperty() propertyName: string;
  @ApiPropertyOptional() propertyAddress: string | null;
  @ApiProperty() landlordName: string;
  @ApiPropertyOptional() landlordCompany: string | null;
  @ApiPropertyOptional() landlordLogoUrl: string | null;

  @ApiProperty() rentAmount: number;
  @ApiPropertyOptional() serviceCharge: number | null;
  @ApiPropertyOptional() legalFee: number | null;
  @ApiPropertyOptional() agencyFee: number | null;
  @ApiPropertyOptional() cautionDeposit: number | null;
  @ApiPropertyOptional() otherFees:
    | Array<{ externalId?: string; name: string; amount: number; recurring: boolean }>
    | null;
  @ApiProperty() paymentFrequency: string;
  @ApiProperty() startDate: string;
  @ApiProperty() endDate: string;
  @ApiProperty() currentExpiryDate: string | null;

  // Tenant contact details — drive section 5 ("Service of Notices") of the
  // letter, where the tenant's WhatsApp/email are listed verbatim.
  @ApiPropertyOptional() tenantWhatsApp: string | null;
  @ApiPropertyOptional() tenantEmail: string | null;

  // Landlord branding footer — pulled from the landlord's profile (same
  // source AdminSettings writes to). Used to render the centered footer
  // block at the bottom of the letter document.
  @ApiPropertyOptional() landlordSignatureUrl: string | null;
  @ApiPropertyOptional() landlordBusinessAddress: string | null;
  @ApiPropertyOptional() landlordContactEmail: string | null;
  @ApiPropertyOptional() landlordContactPhone: string | null;
  @ApiPropertyOptional() landlordWebsite: string | null;

  // Acceptance-only (post-verify) — power the ACCEPTED stamp overlay.
  @ApiPropertyOptional() acceptanceOtp: string | null;
  @ApiPropertyOptional() acceptedAt: string | null;
  @ApiPropertyOptional() acceptedByPhone: string | null;

  // Decline-only (post-verify) — power the DECLINED stamp overlay.
  @ApiPropertyOptional() declineOtp: string | null;
  @ApiPropertyOptional() declinedByPhone: string | null;

  /**
   * Set when the cron auto-renewed at expiry (tenant didn't accept in time).
   * Drives the AUTO-RENEWED stamp variant — same shape as ACCEPTED but
   * different copy and no OTP/phone metadata.
   */
  @ApiPropertyOptional() autoRenewedAt: string | null;

  // Decline-only — power the decline stamp if we show one.
  @ApiPropertyOptional() declinedAt: string | null;

  // Supersession — when non-null, render read-only with a "replaced" banner.
  @ApiProperty() isSuperseded: boolean;

  // Only populated immediately after POST /accept — never on initial GET.
  @ApiPropertyOptional() phoneLastFour: string | null;
}

export class InitiateOtpResponseDto {
  @ApiProperty() message: string;
  @ApiProperty() phoneLastFour: string;
}

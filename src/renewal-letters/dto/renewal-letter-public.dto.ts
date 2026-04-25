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
  @ApiProperty() paymentFrequency: string;
  @ApiProperty() startDate: string;
  @ApiProperty() endDate: string;
  @ApiProperty() currentExpiryDate: string | null;

  // Acceptance-only (post-verify) — power the ACCEPTED stamp overlay.
  @ApiPropertyOptional() acceptanceOtp: string | null;
  @ApiPropertyOptional() acceptedAt: string | null;
  @ApiPropertyOptional() acceptedByPhone: string | null;

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

export class InitiateAcceptanceResponseDto {
  @ApiProperty() message: string;
  @ApiProperty() phoneLastFour: string;
}

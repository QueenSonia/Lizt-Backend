import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for the public tenant-submission endpoint
 * `POST /api/tenancies/renewal-invoice/:token/payment-plan-request`.
 * The token resolves to a renewal invoice that supplies tenant + property
 * + total + fee_breakdown — the tenant only describes how they'd like to pay
 * in a single free-text field (amount + cadence combined).
 */
export class CreatePaymentPlanRequestDto {
  @IsString()
  @MaxLength(2000)
  preferredSchedule: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  tenantNote?: string;
}

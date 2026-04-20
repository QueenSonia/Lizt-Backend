import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Body for the public tenant-submission endpoint
 * `POST /api/tenancies/renewal-invoice/:token/payment-plan-request`.
 * The token resolves to a renewal invoice that supplies tenant + property
 * + total + fee_breakdown — the tenant only chooses how they want to pay.
 */
export class CreatePaymentPlanRequestDto {
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  installmentAmount: number;

  @IsString()
  @MaxLength(2000)
  preferredSchedule: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  tenantNote?: string;
}

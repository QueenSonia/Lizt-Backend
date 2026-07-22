import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InstallmentPaymentMethod } from '../entities/payment-plan-installment.entity';

const MANUAL_METHODS = [
  InstallmentPaymentMethod.CASH,
  InstallmentPaymentMethod.TRANSFER,
  InstallmentPaymentMethod.OTHER,
] as const;

export class MarkInstallmentPaidDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  amount?: number;

  /**
   * Must be true when `amount` is below the installment's remaining balance —
   * the server rejects a smaller amount without it, so a stale client or a
   * typo can never silently turn a full settlement into a partial one.
   */
  @IsOptional()
  @IsBoolean()
  partial?: boolean;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsEnum(MANUAL_METHODS, {
    message: 'Method must be cash, transfer, or other',
  })
  method: (typeof MANUAL_METHODS)[number];

  @IsOptional()
  @IsString()
  note?: string;
}

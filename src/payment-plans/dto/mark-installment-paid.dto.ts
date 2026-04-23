import {
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

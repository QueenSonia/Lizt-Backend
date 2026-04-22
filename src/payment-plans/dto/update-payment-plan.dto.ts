import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentPlanType } from '../entities/payment-plan.entity';

class UpdateInstallmentDto {
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  amount: number;

  @IsDateString()
  dueDate: string;
}

export class UpdatePaymentPlanDto {
  @IsOptional()
  @IsEnum(PaymentPlanType)
  planType?: PaymentPlanType;

  /**
   * The new schedule for the plan's UNPAID installments. Paid installments
   * are preserved untouched. Sum of these amounts must equal
   * (plan.total_amount − sum(paid installments)).
   */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateInstallmentDto)
  installments: UpdateInstallmentDto[];
}

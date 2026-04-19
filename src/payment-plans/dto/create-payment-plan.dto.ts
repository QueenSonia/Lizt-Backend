import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  PaymentPlanScope,
  PaymentPlanType,
} from '../entities/payment-plan.entity';

class CreateInstallmentDto {
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  amount: number;

  @IsDateString()
  dueDate: string;
}

export class CreatePaymentPlanDto {
  @IsUUID()
  propertyTenantId: string;

  @IsOptional()
  @IsUUID()
  renewalInvoiceId?: string;

  @IsEnum(PaymentPlanScope)
  scope: PaymentPlanScope;

  /** For scope='charge' this is the Fee label the plan carves out. */
  @IsString()
  chargeName: string;

  @IsEnum(PaymentPlanType)
  planType: PaymentPlanType;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateInstallmentDto)
  installments: CreateInstallmentDto[];
}

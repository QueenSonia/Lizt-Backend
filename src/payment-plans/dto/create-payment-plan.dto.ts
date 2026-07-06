import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
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

export class NewChargeDto {
  /** Line-item label for the invoice this charge becomes (e.g. "Generator repair"). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  description: string;

  @IsNumber()
  @Min(1)
  @Type(() => Number)
  amount: number;
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

  /**
   * When set, this plan is being created in response to a tenant-submitted
   * payment plan request. Approval and plan creation happen atomically:
   * the request is marked `approved` and linked via `created_payment_plan_id`.
   */
  @IsOptional()
  @IsUUID()
  fromRequestId?: string;

  /**
   * For the "Outstanding Balance" charge: the wallet-derived OB amount the
   * modal displayed at load time. The backend rejects with 409 if the live
   * wallet OB has drifted from this, so a stale form can't split a wrong total.
   */
  @IsOptional()
  @IsNumber()
  expectedOutstandingBalance?: number;

  /**
   * When set, this plan settles a single ad-hoc invoice (wallet-backed, Type B)
   * rather than a renewal-invoice fee. Its presence is the discriminator: the
   * plan bypasses the renewal-invoice requirement, snapshots the invoice as its
   * sole FIFO source, and stamps `covered_by_plan_id` to lock the public link.
   */
  @IsOptional()
  @IsUUID()
  adHocInvoiceId?: string;

  /**
   * When set, a brand-new ad-hoc invoice for this charge and the plan covering
   * it are created atomically in one transaction. The tenant receives ONLY the
   * plan-created WhatsApp — the invoice pay-link message is suppressed because
   * the invoice is born plan-covered (its public link is locked from the
   * start). Mutually exclusive with adHocInvoiceId and
   * expectedOutstandingBalance. Installments must sum to `newCharge.amount`.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => NewChargeDto)
  newCharge?: NewChargeDto;
}

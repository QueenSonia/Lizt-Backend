import {
  IsNotEmpty,
  IsNumber,
  IsDateString,
  IsUUID,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AttachTenantFromKycDto {
  @IsNotEmpty()
  @IsUUID()
  kycApplicationId: string;

  @IsNotEmpty()
  @IsUUID()
  propertyId: string;

  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  rentAmount: number;

  @IsNotEmpty()
  @IsDateString()
  tenancyStartDate: string;

  @IsNotEmpty()
  @IsDateString()
  tenancyEndDate: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  serviceCharge?: number;
}

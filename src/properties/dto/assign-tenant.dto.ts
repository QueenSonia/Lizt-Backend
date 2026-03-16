import { Type } from 'class-transformer';
import { IsString, IsOptional, IsNumber, IsEnum } from 'class-validator';

export enum RentFrequency {
  MONTHLY = 'Monthly',
  QUARTERLY = 'Quarterly',
  BI_ANNUALLY = 'Bi-Annually',
  ANNUALLY = 'Annually',
}

export class AssignTenantDto {
  @IsString()
  tenant_id: string;

  @IsNumber()
  @Type(() => Number)
  rental_price: number;

  @IsNumber()
  @Type(() => Number)
  service_charge: number;

  @IsNumber()
  @Type(() => Number)
  security_deposit: number;

  @IsString()
  rent_start_date: string;

  @IsEnum(RentFrequency)
  @IsOptional()
  payment_frequency?: RentFrequency;

  @IsString()
  rent_status: string;
}

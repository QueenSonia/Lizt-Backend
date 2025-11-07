import { Type } from 'class-transformer';
import { IsString, IsOptional, IsNumber } from 'class-validator';

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
  lease_start_date: string;

  @IsString()
  lease_end_date: string;

  @IsString()
  @IsOptional()
  payment_frequency?: string;

  @IsString()
  rent_status: string;
}

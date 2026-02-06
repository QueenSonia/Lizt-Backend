import {
  IsUUID,
  IsDateString,
  IsArray,
  ValidateNested,
  IsString,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class LineItemDto {
  @IsString()
  description: string;

  @IsNumber()
  @Min(0)
  amount: number;
}

export class CreateInvoiceDto {
  @IsUUID()
  @IsOptional()
  tenantId?: string;

  @IsUUID()
  @IsOptional()
  kycApplicationId?: string;

  @IsUUID()
  propertyId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  lineItems: LineItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;
}

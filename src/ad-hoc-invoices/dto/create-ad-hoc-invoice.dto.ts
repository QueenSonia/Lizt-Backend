import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class CreateAdHocInvoiceLineItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description: string;

  @IsNumber()
  @Min(1)
  @Type(() => Number)
  amount: number;
}

export class CreateAdHocInvoiceDto {
  @IsUUID()
  propertyTenantId: string;

  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateAdHocInvoiceLineItemDto)
  lineItems: CreateAdHocInvoiceLineItemDto[];
}

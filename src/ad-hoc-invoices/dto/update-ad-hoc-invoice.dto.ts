import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class UpdateAdHocInvoiceLineItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description: string;

  @IsNumber()
  @Min(1)
  @Type(() => Number)
  amount: number;
}

export class UpdateAdHocInvoiceDto {
  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateAdHocInvoiceLineItemDto)
  lineItems: UpdateAdHocInvoiceLineItemDto[];
}

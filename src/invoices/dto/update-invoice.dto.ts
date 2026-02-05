import { IsArray, ValidateNested, IsString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { LineItemDto } from './create-invoice.dto';

export class UpdateInvoiceDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  @IsOptional()
  lineItems?: LineItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;
}

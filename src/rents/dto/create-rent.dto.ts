import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsUUID,
  IsNumber,
  IsEnum,
  IsString,
} from 'class-validator';

export enum RentStatusEnum {
  PENDING = 'pending',
  PAID = 'paid',
  OWING = 'owing',
}

export class CreateRentDto {
  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the property',
  })
  @IsNotEmpty()
  @IsUUID()
  property_id: string;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the tenant',
  })
  @IsNotEmpty()
  @IsUUID()
  tenant_id: string;

  @ApiProperty({
    example: 500000,
    description: 'Payment of the property',
    type: 'integer',
  })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  amount_paid: number;

  @ApiProperty({
    example: '2024-03-21',
    description: 'Due date for the rent',
    required: false,
  })
  @IsString()
  expiry_date: Date | string;

  @ApiProperty({ type: 'array', items: { type: 'string', format: 'binary' } })
  rent_receipts: string[];

  @ApiProperty({
    example: 'pending',
    description: 'Rent status',
  })
  @IsEnum(RentStatusEnum)
  status: string;
}

export class RentFilter {
  page?: number;
  size?: number;
  tenant_id?: string;
  owner_id?: string;
  property_id?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
}

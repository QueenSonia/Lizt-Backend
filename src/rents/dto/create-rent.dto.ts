import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsEnum,
  IsString,
  IsUUID,
  IsDateString,
  IsOptional,
} from 'class-validator';

export enum RentPaymentStatusEnum {
  PENDING = 'pending',
  PAID = 'paid',
  OWING = 'owing',
}

export enum RentStatusEnum {
  ACTIVE = 'active',
  INACTIVE = 'inactive'
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
  @IsOptional()
  @IsDateString()
  expiry_date: Date;

  // @ApiProperty({ type: 'array', items: { type: 'string', format: 'binary' } })
  // rent_receipts: string[];

  @ApiProperty({
    example: 'pending',
    description: 'Rent status',
  })
  @IsOptional()
  @IsEnum(RentStatusEnum)
  status: string;

  @ApiProperty({
    example: '',
    description: 'lease start date',
  })
  @IsNotEmpty()
  @IsDateString()
  lease_start_date: Date;

  @ApiProperty({
    example: '',
    description: 'lease end date',
  })
  @IsNotEmpty()
  @IsDateString()
  lease_end_date: Date;
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
  property?:{
    owner_id?: string;
  }
}

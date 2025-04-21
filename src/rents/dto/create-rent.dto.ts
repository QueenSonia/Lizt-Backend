import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID, IsNumber, IsDate, IsEnum } from 'class-validator';

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
    example: '500000',
    description: 'Payment of the property',
  })
  @IsNotEmpty()
  @IsNumber()
  amount_paid: number;

  @ApiProperty()
  @IsDate()
  expiry_date: Date;

  @ApiProperty({ type: 'array', items: { type: 'string', format: 'binary' } })
  rent_receipts: string[];

  @ApiProperty({
    example: 'Pending',
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

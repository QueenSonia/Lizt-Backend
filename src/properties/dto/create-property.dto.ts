import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
} from 'class-validator';

export enum PropertyStatusEnum {
  VACANT = 'vacant',
  OCCUPIED = 'occupied',
  INACTIVE = 'inactive',
  READY_FOR_MARKETING = 'ready_for_marketing',
}

export class CreatePropertyDto {
  @ApiProperty({ example: 'Abuja Duplex', description: 'Name of the property' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'lagos', description: 'Location of the property' })
  @IsNotEmpty()
  @IsString()
  location: string;

  @ApiProperty({ example: 'lagos', description: 'Description of the property' })
  @IsOptional()
  @IsString()
  description?: string;

  // @ApiProperty({ example: 'vacant', description: 'Status of the property' })
  // @IsNotEmpty()
  // @IsEnum(PropertyStatusEnum)
  // property_status: PropertyStatusEnum;

  @ApiProperty({
    example: 'Duplex',
    description: 'Type of the property',
  })
  @IsString()
  property_type: string;

  // @ApiProperty({ type: 'array', items: { type: 'string', format: 'binary' } })
  // property_images: string[];

  @ApiProperty({
    example: 3,
    description: 'No of bedrooms in the property',
    type: 'integer',
  })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  no_of_bedrooms: number;

  @ApiProperty({
    example: 3,
    description: 'No of bathrooms in the property',
    type: 'integer',
  })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  no_of_bathrooms: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  tenant_id?: string;

  // @ApiProperty({
  //   example: 500000,
  //   description: 'Rental price of the property',
  //   type: 'integer',
  // })
  // @IsNotEmpty()
  // @IsNumber()
  // @Type(() => Number)
  // rental_price: number;

  // @ApiProperty({
  //   example: 'monthly',
  //   description: 'Frequency of payment for the property',
  // })
  // @IsNotEmpty()
  // @IsString()
  // payment_frequency: string;

  // @ApiProperty({
  //   example: 20000,
  //   description: 'Security payment',
  //   type: 'integer',
  // })
  // @IsNotEmpty()
  // @IsNumber()
  // @Type(() => Number)
  // security_deposit: number;

  // @ApiProperty({
  //   example: 50000,
  //   description: 'Service charge',
  //   type: 'integer',
  // })
  // @IsNotEmpty()
  // @IsNumber()
  // @Type(() => Number)
  // service_charge: number;

  // @ApiProperty({
  //   example: 'Available now',
  //   description: 'Additional notes about the property',
  //   required: false,
  // })
  // @IsString()
  // comment?: string | null;
}

export enum TenantStatusEnum {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export interface PropertyFilter {
  search?: string;
  name?: string;
  location?: string;
  property_status?: PropertyStatusEnum;
  owner_id?: string;
  start_date?: string;
  end_date?: string;
  sort_by?: string;
  sort_order?: string;
  size?: number;
  page?: number;
  order?: 'asc' | 'desc';
}

import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsNumber, IsEnum } from 'class-validator';

export enum PropertyStatusEnum {
  VACANT = 'vacant',
  NOT_VACANT = 'not_vacant',
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

  @ApiProperty({ example: 'vacant', description: 'Status of the property' })
  @IsNotEmpty()
  @IsEnum(PropertyStatusEnum)
  property_status: PropertyStatusEnum;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the tenant',
  })
  @IsString()
  owner_id: string;

  @ApiProperty({
    example: 'Duplex',
    description: 'Type of the property',
  })
  @IsString()
  property_type: string;

  @ApiProperty({ type: 'array', items: { type: 'string', format: 'binary' } })
  @IsNotEmpty()
  property_images: string[];

  @ApiProperty({ example: 3, description: 'No of bedrooms in the property' })
  @IsNotEmpty()
  @IsNumber()
  no_of_bedrooms: number;

  @ApiProperty({
    example: '500,000',
    description: 'Rental price of the property',
  })
  @IsNotEmpty()
  @IsNumber()
  rental_price: number;

  @ApiProperty({
    example: 'monthly',
    description: 'Frequency of payment for the property',
  })
  @IsNotEmpty()
  @IsString()
  payment_frequency: string;

  @ApiProperty({ example: 1, description: 'How long a tenent is staying' })
  @IsNotEmpty()
  @IsNumber()
  lease_duration: number;

  @ApiProperty({
    example: '20,000',
    description: 'Security payment',
  })
  @IsNotEmpty()
  @IsNumber()
  security_deposit: number;

  @ApiProperty({
    example: '50,000',
    description: 'Service charge',
  })
  @IsNotEmpty()
  @IsNumber()
  service_charge: number;

  @ApiProperty({
    example: 'Available now',
    description: 'Additional notes about the property',
  })
  @IsString()
  comment: string;

  @ApiProperty({
    example: 'Available now',
    description: 'Date tenant moved in',
  })
  @IsString()
  move_in_date?: Date | string | null;
}

export enum TenantStatusEnum {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export interface PropertyFilter {
  name?: string;
  location?: string;
  property_status?: string;
  owner_id?: string;
  start_date?: string;
  end_date?: string;
  size?: number;
  page?: number;
}

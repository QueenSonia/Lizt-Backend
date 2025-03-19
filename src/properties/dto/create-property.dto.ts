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
  tenant_id: string;

  @ApiProperty({ example: 1, description: 'No of bathrooms in the property' })
  @IsNotEmpty()
  @IsNumber()
  no_of_bathrooms: number;

  @ApiProperty({ example: 3, description: 'No of bedrooms in the property' })
  @IsNotEmpty()
  @IsNumber()
  no_of_bedrooms: number;

  @ApiProperty({
    example: '500,000',
    description: 'Rental price of the property',
  })
  @IsNotEmpty()
  @IsString()
  rental_price: string;

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
  @IsString()
  security_deposit: string;

  @ApiProperty({
    example: '50,000',
    description: 'Service charge',
  })
  @IsNotEmpty()
  @IsString()
  service_charge: string;

  @ApiProperty({
    example: 'Available now',
    description: 'Comment about the property',
  })
  @IsString()
  comment: string;

  @ApiProperty({
    example: 'Available now',
    description: 'Comment about the property',
  })
  @IsString()
  move_in_date: Date;

  @ApiProperty({
    example: 'Active',
    description: 'Status of the tenant',
  })
  @IsString()
  occupant_status: string;

  @ApiProperty({
    example: '2025',
    description: 'Year the property was built',
  })
  @IsString()
  build_year: string;
}

export interface PropertyFilter {
  name?: string;
  location?: string;
  property_status?: string;
  tenant_id?: string;
  start_date?: string;
  end_date?: string;
  size?: number;
  page?: number;
}

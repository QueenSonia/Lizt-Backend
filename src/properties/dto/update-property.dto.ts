import { ApiProperty } from '@nestjs/swagger';
import { CreatePropertyDto, PropertyStatusEnum } from './create-property.dto';

import {
  IsUUID,
  IsOptional,
  IsString,
  IsNumber,
  IsDateString,
  IsEnum,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { RentStatusEnum } from 'src/rents/dto/create-rent.dto';
import { PartialType } from '@nestjs/mapped-types';

export class UpdatePropertyDto extends PartialType(CreatePropertyDto) {
  @ApiPropertyOptional({
    example: 'vacant',
    description: 'Status of the property',
    enum: PropertyStatusEnum,
  })
  @IsOptional()
  @IsEnum(PropertyStatusEnum)
  property_status?: PropertyStatusEnum;

  @ApiPropertyOptional({
    example: 1000000,
    description: 'Annual rental price of the property',
    type: Number,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  rental_price?: number;

  @ApiPropertyOptional({
    example: 50000,
    description: 'Security deposit',
    type: Number,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  security_deposit?: number;

  @ApiPropertyOptional({
    example: 50000,
    description: 'Service charge',
    type: Number,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  service_charge?: number;
}

// export class UpdatePropertyDto {
//   @ApiPropertyOptional({ format: 'uuid' })
//   @IsUUID()
//   @IsOptional()
//   id?: string;

//   @ApiPropertyOptional()
//   @IsString()
//   @IsOptional()
//   name?: string;

//   @ApiPropertyOptional()
//   @IsString()
//   @IsOptional()
//   description?: string;

//   @ApiPropertyOptional()
//   @IsString()
//   @IsOptional()
//   location?: string;

//   @ApiPropertyOptional({ enum: RentStatusEnum })
//   @IsEnum(RentStatusEnum)
//   @IsOptional()
//   rent_status?: RentStatusEnum;

//   @ApiPropertyOptional()
//   @IsString()
//   @IsOptional()
//   property_type?: string;

//   @ApiPropertyOptional({ type: Number, example: 1000000 })
//   @IsNumber()
//   @IsOptional()
//   rental_price?: number;

//   @ApiPropertyOptional({ type: Number, example: 50000 })
//   @IsNumber()
//   @IsOptional()
//   service_charge?: number;

//   @ApiPropertyOptional({ type: Number, example: 50000 })
//   @IsNumber()
//   @IsOptional()
//   security_deposit?: number;

//   @ApiPropertyOptional()
//   @IsString()
//   @IsOptional()
//   tenant_name?: string;

//   @ApiPropertyOptional({ example: '08104228894' })
//   @IsString()
//   @IsOptional()
//   phone_number?: string;

//   @ApiPropertyOptional({ example: 'active' })
//   @IsString()
//   @IsOptional()
//   occupancy_status?: PropertyStatusEnum;

//   @ApiPropertyOptional({ example: 3 })
//   @IsNumber()
//   @IsOptional()
//   no_of_bedrooms?: number;

//   @ApiPropertyOptional({
//     type: String,
//     format: 'date-time',
//     example: '2025-05-10T00:00:00.000Z',
//   })
//   @IsDateString()
//   @IsOptional()
//   lease_start_date?: string;

//   @ApiPropertyOptional({
//     type: String,
//     format: 'date-time',
//     example: '2025-12-10T00:00:00.000Z',
//   })
//   @IsDateString()
//   @IsOptional()
//   lease_end_date?: string;

//   @ApiPropertyOptional({ example: '7 months' })
//   @IsString()
//   @IsOptional()
//   lease_duration?: string;

//   @ApiPropertyOptional()
//   @IsString()
//   @IsOptional()
//   first_name?: string;

//   @ApiPropertyOptional()
//   @IsString()
//   @IsOptional()
//   last_name?: string;

//   // @ApiPropertyOptional({ type: [Object] }) // Replace Object with a nested DTO if available
//   // @IsArray()
//   // @ValidateNested({ each: true })
//   // @Type(() => Object)
//   // @IsOptional()
//   // property_tenants?: any[];
// }

export class UpdatePropertyResponseDto {
  @ApiProperty({
    example: 'Abuja Duplex',
    description: 'Name of the property',
    required: false,
  })
  name: string;

  @ApiProperty({
    example: 'lagos',
    description: 'Location of the property',
    required: false,
  })
  location: string;

  @ApiProperty({
    example: 'vacant',
    description: 'Status of the property',
    required: false,
  })
  property_status: PropertyStatusEnum;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the tenant',
    required: false,
  })
  owner_id: string;

  @ApiProperty({
    example: 'Duplex',
    description: 'Type of the property',
    required: false,
  })
  property_type: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'string', format: 'binary' },
    required: false,
    description: 'Images of the property',
  })
  property_images: string[];

  @ApiProperty({
    example: 3,
    description: 'No of bedrooms in the property',
    required: false,
  })
  no_of_bedrooms: number;

  @ApiProperty({
    example: 500000,
    description: 'Rental price of the property',
    required: false,
  })
  rental_price: number;

  @ApiProperty({
    example: 20000,
    description: 'Security payment',
    required: false,
  })
  security_deposit: number;

  @ApiProperty({
    example: 50000,
    description: 'Service charge',
    required: false,
  })
  service_charge: number;

  @ApiProperty({
    example: 'Available now',
    description: 'Comment about the property',
    required: false,
  })
  comment?: string | null;
}

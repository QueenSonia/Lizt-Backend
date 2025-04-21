import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreatePropertyDto, PropertyStatusEnum } from './create-property.dto';

export class UpdatePropertyDto extends PartialType(CreatePropertyDto) {}

export class UpdatePropertyResponseDto {
  @ApiProperty({ example: 'Abuja Duplex', description: 'Name of the property' })
  name: string;

  @ApiProperty({ example: 'lagos', description: 'Location of the property' })
  location: string;

  @ApiProperty({ example: 'vacant', description: 'Status of the property' })
  property_status: PropertyStatusEnum;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the tenant',
  })
  owner_id: string;

  @ApiProperty({
    example: 'Duplex',
    description: 'Type of the property',
  })
  property_type: string;

  @ApiProperty({ type: 'array', items: { type: 'string', format: 'binary' } })
  property_images: string[];

  @ApiProperty({ example: 3, description: 'No of bedrooms in the property' })
  no_of_bedrooms: number;

  @ApiProperty({
    example: 500000,
    description: 'Rental price of the property',
  })
  rental_price: number;

  @ApiProperty({
    example: 'monthly',
    description: 'Frequency of payment for the property',
  })
  payment_frequency: string;

  @ApiProperty({ example: 1, description: 'How long a tenent is staying' })
  lease_duration: number;

  @ApiProperty({
    example: 20000,
    description: 'Security payment',
  })
  security_deposit: number;

  @ApiProperty({
    example: 50000,
    description: 'Service charge',
  })
  service_charge: number;

  @ApiProperty({
    example: 'Available now',
    description: 'Comment about the property',
    required: false,
  })
  comment?: string | null;

  @ApiProperty({
    example: '2024-03-21',
    description: 'Comment about the property',
    required: false,
  })
  move_in_date?: Date | string | null;
}

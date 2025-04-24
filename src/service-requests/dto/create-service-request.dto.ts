import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsEnum } from 'class-validator';

export enum ServiceRequestStatusEnum {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  URGENT = 'urgent',
}

export class CreateServiceRequestDto {
  @ApiProperty({ example: 'John Doe', description: 'Name of the tenant' })
  @IsNotEmpty()
  @IsString()
  tenant_name: string;

  @ApiProperty({
    example: 'Luxury Apartment',
    description: 'Name of the property',
  })
  @IsNotEmpty()
  @IsString()
  property_name: string;

  @ApiProperty({
    example: 'Broken Pipe',
    description: 'Category of the issue',
  })
  @IsNotEmpty()
  @IsString()
  issue_category: string;

  @ApiProperty({
    example: '2024-03-21',
    description: 'Date when the issue was noticed',
  })
  @IsNotEmpty()
  @IsString()
  effective_date: Date | string;

  @ApiProperty({
    example:
      'The pipe in the kitchen is leaking and needs immediate attention.',
    description: 'Description of the issue',
  })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'string', format: 'binary' },
    required: false,
    description: 'Images of the issue (optional)',
  })
  issue_images?: string[] | null;

  @ApiProperty({
    example: 'pending',
    description: 'Status of the service request',
  })
  @IsNotEmpty()
  @IsEnum(ServiceRequestStatusEnum)
  status: string;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the tenant',
  })
  @IsString()
  @IsNotEmpty()
  tenant_id: string;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the property',
  })
  @IsString()
  @IsNotEmpty()
  property_id: string;
}

export interface ServiceRequestFilter {
  tenant_id?: string;
  property_id?: string;
  owner_id?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  size?: number;
  page?: number;
}

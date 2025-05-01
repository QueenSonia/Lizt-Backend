import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  CreateServiceRequestDto,
  ServiceRequestStatusEnum,
} from './create-service-request.dto';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';

export class UpdateServiceRequestDto extends PartialType(
  CreateServiceRequestDto,
) {}

export class UpdateServiceRequestResponseDto {
  @ApiProperty({
    example: 'John Doe',
    description: 'Name of the tenant',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }) => value?.trim() || undefined)
  tenant_name?: string;

  @ApiProperty({
    example: 'Luxury Apartment',
    description: 'Name of the property',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }) => value?.trim() || undefined)
  property_name: string;

  @ApiProperty({
    example: 'urgent',
    enum: ServiceRequestStatusEnum,
    description: 'Status of the service request',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsEnum(ServiceRequestStatusEnum)
  @Transform(({ value }) => value?.trim() || undefined)
  status?: ServiceRequestStatusEnum;

  @ApiProperty({
    example: 'Carpentry',
    description: 'Category of the issue',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }) => value?.trim() || undefined)
  issue_category?: string;

  @ApiProperty({
    example: '2024-03-21',
    description: 'Date when the issue was noticed',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => value?.trim() || undefined)
  date_reported?: Date;

  @ApiProperty({
    example: '2024-03-21',
    description: 'Date when the issue was resolved',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => value?.trim() || undefined)
  resolution_date?: Date;

  @ApiProperty({
    example: 'The roof is leaking',
    description: 'Description of the issue',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }) => value?.trim() || undefined)
  description?: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'string', format: 'binary' },
    required: false,
    nullable: true,
    description: 'Images of the issue',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (!value || value === '') return undefined;
    return Array.isArray(value) ? value : [value];
  })
  issue_images?: string[];

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the tenant',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }) => value?.trim() || undefined)
  tenant_id?: string;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the property',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }) => value?.trim() || undefined)
  property_id?: string;
}

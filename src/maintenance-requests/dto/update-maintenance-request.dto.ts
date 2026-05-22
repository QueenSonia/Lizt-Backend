import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  CreateMaintenanceRequestDto,
  MaintenanceRequestStatusEnum,
} from './create-maintenance-request.dto';
import { JobCategoryEnum } from './job-category.enum';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateMaintenanceRequestDto extends PartialType(
  CreateMaintenanceRequestDto,
) {}

export class UpdateMaintenanceRequestResponseDto {
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
    enum: MaintenanceRequestStatusEnum,
    description: 'Status of the maintenance request',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsEnum(MaintenanceRequestStatusEnum)
  @Transform(({ value }) => value?.trim() || undefined)
  status?: MaintenanceRequestStatusEnum;

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

  @ApiProperty({
    description:
      "Tenant's message when reopening a resolved request. Required when transitioning to 'reopened'.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim() || undefined)
  reopen_message?: string;

  @ApiProperty({
    example: 4500000,
    description:
      'Cost incurred resolving the issue, in NGN minor units (kobo). Optional. Required only as part of a resolve transition payload when the FM ticked "yes" on cost.',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  resolution_cost_minor?: number;

  @ApiProperty({
    enum: JobCategoryEnum,
    description:
      "Category of work done to resolve the issue. Required when transitioning to 'resolved'.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsEnum(JobCategoryEnum)
  resolution_category?: JobCategoryEnum;

  @ApiProperty({
    example: 'Replaced kitchen tap washer; tested for leaks.',
    description:
      "Free-text summary of the resolution. Required when transitioning to 'resolved'.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }) => value?.trim() || undefined)
  resolution_summary?: string;

  @ApiProperty({
    example: 'Emeka Plumbing Services',
    description:
      "Artisan / tradesperson the FM hired to resolve the issue. Required when transitioning to 'resolved'.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => value?.trim() || undefined)
  artisan_name?: string;

  @ApiProperty({
    example: '08012345678',
    description:
      "Artisan phone (any common Nigerian form). Server normalizes to 234XXXXXXXXXX. Required when transitioning to 'resolved'.",
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Transform(({ value }) => value?.trim() || undefined)
  artisan_phone?: string;

  @ApiProperty({
    description:
      "Explicit FM choice when the typed phone matches an existing artisan with a different stored name. true → rename the stored artisan to artisan_name. false/undefined → keep the stored name; the typed name is still captured in artisan_name_snapshot.",
    required: false,
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => {
    // Endpoint accepts multipart/form-data; booleans arrive as strings.
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (v === 'true' || v === '1') return true;
      if (v === 'false' || v === '0' || v === '') return false;
    }
    return value;
  })
  @IsBoolean()
  rename_artisan_if_conflict?: boolean;
}

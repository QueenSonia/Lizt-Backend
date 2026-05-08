import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export enum ServiceRequestStatusEnum {
  NOT_APPROVED = 'not_approved',
  APPROVED = 'approved',
  RESOLVED = 'resolved',
  REOPENED = 'reopened',
  CLOSED = 'closed',
}

export enum ServiceRequestScopeEnum {
  UNIT = 'unit',
  COMMON_AREA = 'common_area',
}

export enum ServiceRequestCreatorTypeEnum {
  TENANT = 'tenant',
  FACILITY_MANAGER = 'facility_manager',
}

export class CreateServiceRequestDto {
  @IsNotEmpty()
  text: string;

  @IsUUID()
  property_id: string;

  @ApiProperty({
    enum: ServiceRequestScopeEnum,
    required: false,
    default: ServiceRequestScopeEnum.UNIT,
  })
  @IsOptional()
  @IsEnum(ServiceRequestScopeEnum)
  scope?: ServiceRequestScopeEnum;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  is_urgent?: boolean;
}

export class ServiceRequestFilter {
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsUUID()
  tenant_id?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsUUID()
  property_id?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsEnum(ServiceRequestScopeEnum)
  scope?: ServiceRequestScopeEnum;

  @IsOptional()
  @IsEnum(ServiceRequestCreatorTypeEnum)
  creator_type?: ServiceRequestCreatorTypeEnum;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === '' || value === null) return undefined;
    return value === true || value === 'true';
  })
  @IsBoolean()
  is_urgent?: boolean;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  size?: number;
}

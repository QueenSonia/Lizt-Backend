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

export enum MaintenanceRequestStatusEnum {
  NOT_APPROVED = 'not_approved',
  APPROVED = 'approved',
  RESOLVED = 'resolved',
  REOPENED = 'reopened',
  CLOSED = 'closed',
  REJECTED = 'rejected',
  PENDING_TENANT_CONFIRMATION = 'pending_tenant_confirmation',
  DENIED_BY_TENANT = 'denied_by_tenant',
}

export enum MaintenanceRequestScopeEnum {
  UNIT = 'unit',
  COMMON_AREA = 'common_area',
}

export enum MaintenanceRequestCreatorTypeEnum {
  TENANT = 'tenant',
  FACILITY_MANAGER = 'facility_manager',
}

export class CreateMaintenanceRequestDto {
  @IsNotEmpty()
  text: string;

  @ApiProperty({
    required: false,
    description:
      "Required when scope is 'unit'; ignored when scope is 'common_area'.",
  })
  @IsOptional()
  @IsUUID()
  property_id?: string;

  @ApiProperty({
    required: false,
    description:
      "Required when scope is 'common_area'; must be omitted when scope is 'unit'.",
  })
  @IsOptional()
  @IsUUID()
  common_area_id?: string;

  @ApiProperty({
    enum: MaintenanceRequestScopeEnum,
    required: false,
    default: MaintenanceRequestScopeEnum.UNIT,
  })
  @IsOptional()
  @IsEnum(MaintenanceRequestScopeEnum)
  scope?: MaintenanceRequestScopeEnum;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  is_urgent?: boolean;
}

export class MaintenanceRequestFilter {
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsUUID()
  tenant_id?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsUUID()
  property_id?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsUUID()
  common_area_id?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsEnum(MaintenanceRequestScopeEnum)
  scope?: MaintenanceRequestScopeEnum;

  @IsOptional()
  @IsEnum(MaintenanceRequestCreatorTypeEnum)
  creator_type?: MaintenanceRequestCreatorTypeEnum;

  @ApiProperty({
    required: false,
    description:
      "Pass the literal 'me' to narrow to requests assigned to the requesting facility manager. Pass a TeamMember UUID to filter by a specific assignee (only TeamMember.ids visible to the requester match).",
  })
  @IsOptional()
  @IsString()
  assigned_to?: string;

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

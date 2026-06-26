import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
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
  // Open state for a tenant-filed NOTICE (kind='notice'): informational, no FM,
  // awaiting landlord acknowledgement. Acknowledging transitions it to CLOSED.
  NOTICE_OPEN = 'notice_open',
}

/**
 * Distinguishes a repair (something to fix → FM pipeline) from a notice
 * (informational message for the landlord → landlord-ack lifecycle, no FM).
 * Defaults to REPAIR everywhere so existing/legacy requests are repairs.
 */
export enum MaintenanceRequestKindEnum {
  REPAIR = 'repair',
  NOTICE = 'notice',
}

export enum MaintenanceRequestScopeEnum {
  UNIT = 'unit',
  COMMON_AREA = 'common_area',
}

export enum MaintenanceRequestCreatorTypeEnum {
  TENANT = 'tenant',
  FACILITY_MANAGER = 'facility_manager',
  LANDLORD = 'landlord',
}

/**
 * A single attachment on a maintenance request. `attempt` groups attachments
 * by report cycle (1 at creation, incremented on each REOPENED transition) so
 * a reopened request's fresh evidence is visually separable from the original.
 */
export interface MediaItem {
  type: 'image' | 'video';
  url: string;
  attempt: number;
}

/**
 * Shape the client sends on the direct-upload path: the browser uploads the
 * file to Cloudinary itself and posts back only `{type, url}`. `attempt` is
 * intentionally absent — the service stamps the authoritative report cycle, and
 * the controller validates the URL belongs to our Cloudinary account.
 */
export class MediaItemInput {
  @IsIn(['image', 'video'])
  type: 'image' | 'video';

  @IsString()
  @IsNotEmpty()
  url: string;
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

  @ApiProperty({
    enum: MaintenanceRequestKindEnum,
    required: false,
    default: MaintenanceRequestKindEnum.REPAIR,
    description:
      "repair = something to fix (FM pipeline); notice = informational for the landlord (no FM). Defaults to repair.",
  })
  @IsOptional()
  @IsEnum(MaintenanceRequestKindEnum)
  kind?: MaintenanceRequestKindEnum;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  is_urgent?: boolean;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  is_priority?: boolean;

  @ApiProperty({
    required: false,
    description:
      "TeamMember.id of the facility manager to assign. Landlord-filed MRs only; ignored for tenant- and FM-filed requests. Optional — landlord-filed MRs without an assignee land in APPROVED + unassigned.",
  })
  @IsOptional()
  @IsUUID()
  assigned_to?: string;

  // Two ways this gets populated:
  //  - Legacy multipart: arrives empty over the wire; the controller uploads
  //    the files and fills it in before the service runs.
  //  - Direct upload: the browser uploads to Cloudinary and sends `{type,url}`
  //    items here as JSON, validated below and ownership-checked in the
  //    controller. The service stamps the authoritative `attempt`.
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => MediaItemInput)
  issue_media?: MediaItemInput[];
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
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEnum(MaintenanceRequestKindEnum)
  kind?: MaintenanceRequestKindEnum;

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

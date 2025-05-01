import { IsEnum, IsOptional, IsString, IsUUID, IsDateString, IsArray } from 'class-validator';
import { NoticeStatus, NoticeType, SendVia } from '../entities/notice-agreement.entity';

export class CreateNoticeAgreementDto {
  @IsString()
  notice_id: string;

  @IsEnum(NoticeType)
  notice_type: NoticeType;

  @IsDateString()
  effective_date: Date;

  @IsOptional()
  @IsString()
  notice_image?: string;

  @IsEnum(NoticeStatus)
  status: NoticeStatus;

  @IsArray()
  @IsEnum(SendVia, { each: true })
  send_via: SendVia[];

  @IsOptional()
  @IsString()
  additional_notes?: string;

  @IsUUID()
  property_id: string;

  @IsUUID()
  tenant_id: string;
}

import { IsEnum, IsString, IsUUID, IsDateString } from 'class-validator';
import { NoticeType } from '../entities/notice-agreement.entity';

export class CreateNoticeAgreementDto {
  @IsEnum(NoticeType)
  notice_type: NoticeType;

  @IsDateString()
  effective_date: Date;

  @IsUUID()
  property_id: string;

  @IsUUID()
  tenant_id: string;

  @IsString()
  html_content: string;
}

export interface NoticeAgreementFilter {
  notice_type?: string;
  effective_date?: string;
  property_id?: string;
  tenant_id?: string;
  start_date?: string;
  end_date?: string;
  sort_by?:string;
  sort_order?:string;
  size?: number;
  page?: number;
}

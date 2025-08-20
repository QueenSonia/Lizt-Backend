import { NoticeType } from '../entities/notice-agreement.entity';
export declare class CreateNoticeAgreementDto {
    notice_type: NoticeType;
    effective_date: Date;
    property_id: string;
    tenant_id: string;
    html_content: string;
}
export interface NoticeAgreementFilter {
    notice_type?: string;
    effective_date?: string;
    property_id?: string;
    tenant_id?: string;
    start_date?: string;
    end_date?: string;
    sort_by?: string;
    sort_order?: string;
    size?: number;
    page?: number;
}

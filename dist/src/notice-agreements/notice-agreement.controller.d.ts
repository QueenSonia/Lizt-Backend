import { NoticeAgreementService } from './notice-agreement.service';
import { CreateNoticeAgreementDto, NoticeAgreementFilter } from './dto/create-notice-agreement.dto';
export declare class NoticeAgreementController {
    private readonly service;
    constructor(service: NoticeAgreementService);
    getAllNoticeAgreement(req: any, query: NoticeAgreementFilter): Promise<{
        notice: import("./entities/notice-agreement.entity").NoticeAgreement[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getNoticeAgreementsByTenant(query: NoticeAgreementFilter, req: any): Promise<{
        notice_agreements: import("./entities/notice-agreement.entity").NoticeAgreement[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getAnalytics(req: any): Promise<{
        totalNotices: number;
        acknowledgedNotices: number;
        unacknowledgedNotices: number;
        pendingNotices: number;
    }>;
    create(dto: CreateNoticeAgreementDto): Promise<any>;
    findOne(id: string): Promise<import("./entities/notice-agreement.entity").NoticeAgreement | null>;
    resendNoticeAgreement(id: string): Promise<{
        message: string;
    }>;
    attachDocument(id: string, body: any): Promise<{
        message: string;
        files: {
            url: string;
        }[];
    }>;
}

import { Repository } from 'typeorm';
import { NoticeAgreement } from './entities/notice-agreement.entity';
import { CreateNoticeAgreementDto, NoticeAgreementFilter } from './dto/create-notice-agreement.dto';
import { Property } from 'src/properties/entities/property.entity';
import { FileUploadService } from 'src/utils/cloudinary';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TwilioService } from 'src/whatsapp/services/twilio.service';
import { Account } from 'src/users/entities/account.entity';
export declare class NoticeAgreementService {
    private readonly noticeRepo;
    private readonly propertyRepo;
    private readonly accountRepo;
    private readonly fileUploadService;
    private readonly eventEmitter;
    private readonly twilioService;
    constructor(noticeRepo: Repository<NoticeAgreement>, propertyRepo: Repository<Property>, accountRepo: Repository<Account>, fileUploadService: FileUploadService, eventEmitter: EventEmitter2, twilioService: TwilioService);
    create(dto: CreateNoticeAgreementDto): Promise<any>;
    findOne(id: string): Promise<NoticeAgreement | null>;
    getAllNoticeAgreement(ownerId: string, queryParams: NoticeAgreementFilter): Promise<{
        notice: NoticeAgreement[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    resendNoticeAgreement(id: string): Promise<{
        message: string;
    }>;
    getNoticeAgreementsByTenantId(tenant_id: string, queryParams: NoticeAgreementFilter): Promise<{
        notice_agreements: NoticeAgreement[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getNoticeAnalytics(id: string): Promise<{
        totalNotices: number;
        acknowledgedNotices: number;
        unacknowledgedNotices: number;
        pendingNotices: number;
    }>;
    attachNoticeDocument(property_id: string, fileUrls: string[]): Promise<{
        message: string;
        files: {
            url: string;
        }[];
    }>;
}

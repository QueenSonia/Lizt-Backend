"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoticeAgreementService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const notice_agreement_entity_1 = require("./entities/notice-agreement.entity");
const property_entity_1 = require("../properties/entities/property.entity");
const pdf_generator_1 = require("./utils/pdf-generator");
const sender_1 = require("./utils/sender");
const cloudinary_1 = require("../utils/cloudinary");
const uuid_1 = require("uuid");
const config_1 = require("../config");
const event_emitter_1 = require("@nestjs/event-emitter");
const twilio_service_1 = require("../whatsapp/services/twilio.service");
const account_entity_1 = require("../users/entities/account.entity");
const create_property_dto_1 = require("../properties/dto/create-property.dto");
let NoticeAgreementService = class NoticeAgreementService {
    noticeRepo;
    propertyRepo;
    accountRepo;
    fileUploadService;
    eventEmitter;
    twilioService;
    constructor(noticeRepo, propertyRepo, accountRepo, fileUploadService, eventEmitter, twilioService) {
        this.noticeRepo = noticeRepo;
        this.propertyRepo = propertyRepo;
        this.accountRepo = accountRepo;
        this.fileUploadService = fileUploadService;
        this.eventEmitter = eventEmitter;
        this.twilioService = twilioService;
    }
    async create(dto) {
        const property = await this.propertyRepo.findOne({
            where: { id: dto.property_id },
            relations: ['property_tenants'],
        });
        const doesTenantExist = property?.property_tenants.find((tenant) => tenant.tenant_id === dto.tenant_id);
        if (!doesTenantExist) {
            throw new common_1.NotFoundException('Tenant not found in property');
        }
        const tenant = await this.accountRepo.findOne({
            where: { id: dto.tenant_id },
            relations: ['user'],
        });
        if (!property || !tenant)
            throw new common_1.NotFoundException('Property or tenant not found');
        const agreement = this.noticeRepo.create({
            ...dto,
            notice_id: `NTC-${(0, uuid_1.v4)().slice(0, 8)}`,
            property_name: property.name,
            tenant_name: tenant.profile_name,
        });
        await this.noticeRepo.save(agreement);
        const pdfBuffer = await (0, pdf_generator_1.generatePdfBufferFromEditor)(dto.html_content);
        const filename = `${Date.now()}-notice`;
        const uploadResult = await this.fileUploadService.uploadBuffer(pdfBuffer, filename);
        agreement.notice_image = `${uploadResult.secure_url}`;
        await this.noticeRepo.save(agreement);
        try {
            await Promise.all([
                (0, sender_1.sendEmailWithAttachment)(uploadResult.secure_url, tenant.email),
                this.twilioService.sendWhatsAppMediaMessage(tenant.user.phone_number, uploadResult.secure_url, `Dear ${tenant.profile_name}, please find your ${agreement.notice_type} notice attached.`),
            ]);
            console.log(`Notice agreement sent successfully to ${tenant.email} and WhatsApp`);
        }
        catch (error) {
            console.error('Failed to send notice agreement:', error);
        }
        this.eventEmitter.emit('notice.created', {
            user_id: property.owner_id,
            property_id: property.id,
            property_name: property.name,
        });
        return agreement;
    }
    async findOne(id) {
        return this.noticeRepo.findOne({ where: { id } });
    }
    async getAllNoticeAgreement(ownerId, queryParams) {
        const page = queryParams.page ? Number(queryParams.page) : config_1.config.DEFAULT_PAGE_NO;
        const size = queryParams.size ? Number(queryParams.size) : config_1.config.DEFAULT_PER_PAGE;
        const skip = (page - 1) * size;
        const qb = await this.noticeRepo
            .createQueryBuilder('notice')
            .leftJoinAndSelect('notice.property', 'property')
            .where('property.owner_id = :ownerId', { ownerId });
        if (queryParams.sort_by && queryParams?.sort_order) {
            qb.orderBy(`notice.${queryParams.sort_by}`, queryParams.sort_order.toUpperCase());
        }
        const [notice, count] = await qb.skip(skip).take(size).getManyAndCount();
        const totalPages = Math.ceil(count / size);
        return {
            notice,
            pagination: {
                totalRows: count,
                perPage: size,
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
            },
        };
    }
    async resendNoticeAgreement(id) {
        const notice = await this.noticeRepo.findOne({
            where: { id },
            relations: ['tenant'],
        });
        if (!notice) {
            throw new common_1.NotFoundException('Notice agreement not found');
        }
        if (!notice.notice_image) {
            throw new common_1.NotFoundException('Notice agreement PDF not found');
        }
        try {
            await (0, sender_1.sendEmailWithAttachment)(notice.notice_image, notice.tenant.email);
            console.log(`Notice agreement resent successfully to ${notice.tenant.email}`);
            return { message: 'Notice agreement sent successfully' };
        }
        catch (error) {
            console.error('Failed to resend notice agreement:', error);
            throw new Error('Failed to send notice agreement');
        }
    }
    async getNoticeAgreementsByTenantId(tenant_id, queryParams) {
        const page = queryParams?.page
            ? Number(queryParams?.page)
            : config_1.config.DEFAULT_PAGE_NO;
        const size = queryParams?.size
            ? Number(queryParams.size)
            : config_1.config.DEFAULT_PER_PAGE;
        const skip = (page - 1) * size;
        const [notices, count] = await this.noticeRepo.findAndCount({
            where: {
                tenant_id,
            },
            relations: ['property'],
            skip,
            take: size,
            order: { created_at: 'DESC' },
        });
        const totalPages = Math.ceil(count / size);
        return {
            notice_agreements: notices,
            pagination: {
                totalRows: count,
                perPage: size,
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
            },
        };
    }
    async getNoticeAnalytics(id) {
        const totalNotices = await this.noticeRepo.count({
            where: {
                property: {
                    owner_id: id,
                },
            },
        });
        const acknowledgedNotices = await this.noticeRepo.count({
            where: { status: notice_agreement_entity_1.NoticeStatus.ACKNOWLEDGED },
        });
        const unacknowledgedNotices = await this.noticeRepo.count({
            where: { status: notice_agreement_entity_1.NoticeStatus.NOT_ACKNOWLEDGED },
        });
        const pendingNotices = await this.noticeRepo.count({
            where: { status: notice_agreement_entity_1.NoticeStatus.PENDING },
        });
        return {
            totalNotices,
            acknowledgedNotices,
            unacknowledgedNotices,
            pendingNotices,
        };
    }
    async attachNoticeDocument(property_id, fileUrls) {
        try {
            const property = await this.propertyRepo.findOne({
                where: { id: property_id },
                relations: ['property_tenants.tenant'],
            });
            if (!property) {
                throw new common_1.BadRequestException('Unable to upload document for this property');
            }
            const activeTenant = property?.property_tenants.find((item) => item.status === create_property_dto_1.TenantStatusEnum.ACTIVE);
            if (!activeTenant) {
                throw new common_1.NotFoundException('No active tenant on this property');
            }
            const documentObjects = fileUrls?.map((url) => ({
                url,
            }));
            const notice = this.noticeRepo.create({
                notice_id: `NTC-${(0, uuid_1.v4)().slice(0, 8)}`,
                notice_type: notice_agreement_entity_1.NoticeType.UPLOAD,
                property_id: property.id,
                tenant_id: activeTenant.tenant_id,
                notice_documents: documentObjects,
                property_name: property.name,
                tenant_name: activeTenant.tenant.profile_name,
                effective_date: new Date(),
            });
            await this.noticeRepo.save(notice);
            await (0, sender_1.sendEmailWithMultipleAttachments)(fileUrls, activeTenant.tenant.email);
            this.eventEmitter.emit('notice.created', {
                user_id: property.owner_id,
                property_id: property.id,
                property_name: property.name,
            });
            return {
                message: 'Document(s) uploaded successfully',
                files: documentObjects,
            };
        }
        catch (error) {
            console.error('Attach Notice Document Error:', error);
            throw error;
        }
    }
};
exports.NoticeAgreementService = NoticeAgreementService;
exports.NoticeAgreementService = NoticeAgreementService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(notice_agreement_entity_1.NoticeAgreement)),
    __param(1, (0, typeorm_1.InjectRepository)(property_entity_1.Property)),
    __param(2, (0, typeorm_1.InjectRepository)(account_entity_1.Account)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        cloudinary_1.FileUploadService,
        event_emitter_1.EventEmitter2,
        twilio_service_1.TwilioService])
], NoticeAgreementService);
//# sourceMappingURL=notice-agreement.service.js.map
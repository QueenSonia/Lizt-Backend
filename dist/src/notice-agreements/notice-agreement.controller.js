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
exports.NoticeAgreementController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const notice_agreement_service_1 = require("./notice-agreement.service");
const create_notice_agreement_dto_1 = require("./dto/create-notice-agreement.dto");
const role_guard_1 = require("../auth/role.guard");
const swagger_1 = require("@nestjs/swagger");
const paginate_dto_1 = require("./dto/paginate.dto");
const notice_analytics_dto_1 = require("./dto/notice-analytics.dto");
let NoticeAgreementController = class NoticeAgreementController {
    service;
    constructor(service) {
        this.service = service;
    }
    getAllNoticeAgreement(req, query) {
        try {
            const owner_id = req?.user?.id;
            return this.service.getAllNoticeAgreement(owner_id, query);
        }
        catch (error) {
            throw error;
        }
    }
    async getNoticeAgreementsByTenant(query, req) {
        try {
            const tenant_id = req?.user?.id;
            return this.service.getNoticeAgreementsByTenantId(tenant_id, query);
        }
        catch (error) {
            throw error;
        }
    }
    async getAnalytics(req) {
        const owner_id = req?.user?.id;
        if (!owner_id) {
            throw new Error('Owner ID not found');
        }
        return await this.service.getNoticeAnalytics(owner_id);
    }
    create(dto) {
        try {
            return this.service.create(dto);
        }
        catch (error) {
            throw error;
        }
    }
    findOne(id) {
        try {
            return this.service.findOne(id);
        }
        catch (error) {
            throw error;
        }
    }
    resendNoticeAgreement(id) {
        try {
            return this.service.resendNoticeAgreement(id);
        }
        catch (error) {
            throw error;
        }
    }
    async attachDocument(id, body) {
        return this.service.attachNoticeDocument(id, body.document_url);
    }
};
exports.NoticeAgreementController = NoticeAgreementController;
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get All Notice Agreements' }),
    (0, swagger_1.ApiOkResponse)({
        type: [create_notice_agreement_dto_1.CreateNoticeAgreementDto],
        description: 'List of notice agreements',
    }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)(),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], NoticeAgreementController.prototype, "getAllNoticeAgreement", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get Notice Agreements by Tenant ID' }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'size', required: false, type: Number }),
    (0, swagger_1.ApiOkResponse)({
        type: paginate_dto_1.PaginationResponseDto,
        description: 'Notice agreements for tenant successfully fetched',
    }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)('tenant'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], NoticeAgreementController.prototype, "getNoticeAgreementsByTenant", null);
__decorate([
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, common_1.Get)('analytics'),
    (0, swagger_1.ApiOperation)({ summary: 'Get analytics of all notice agreements' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'The analytics data of notice agreements',
        type: notice_analytics_dto_1.NoticeAnalyticsDTO,
    }),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], NoticeAgreementController.prototype, "getAnalytics", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Create Notice Agreement' }),
    (0, swagger_1.ApiBody)({ type: create_notice_agreement_dto_1.CreateNoticeAgreementDto }),
    (0, swagger_1.ApiCreatedResponse)({ type: create_notice_agreement_dto_1.CreateNoticeAgreementDto }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Post)(),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_notice_agreement_dto_1.CreateNoticeAgreementDto]),
    __metadata("design:returntype", void 0)
], NoticeAgreementController.prototype, "create", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get One Notice Agreement' }),
    (0, swagger_1.ApiOkResponse)({
        type: create_notice_agreement_dto_1.CreateNoticeAgreementDto,
        description: 'Notice agreement details',
    }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Notice agreement not found' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)(':id'),
    openapi.ApiResponse({ status: 200, type: Object }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], NoticeAgreementController.prototype, "findOne", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Resend Notice Agreement' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Notice agreement resent successfully' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Notice agreement not found' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Post)('resend/:id'),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], NoticeAgreementController.prototype, "resendNoticeAgreement", null);
__decorate([
    (0, common_1.Post)('upload-document/:id'),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], NoticeAgreementController.prototype, "attachDocument", null);
exports.NoticeAgreementController = NoticeAgreementController = __decorate([
    (0, swagger_1.ApiTags)('Notice-Agreements'),
    (0, common_1.Controller)('notice-agreement'),
    __metadata("design:paramtypes", [notice_agreement_service_1.NoticeAgreementService])
], NoticeAgreementController);
//# sourceMappingURL=notice-agreement.controller.js.map
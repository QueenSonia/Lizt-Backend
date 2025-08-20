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
exports.TenantKycController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const tenant_kyc_service_1 = require("./tenant-kyc.service");
const dto_1 = require("./dto");
const auth_decorator_1 = require("../auth/auth.decorator");
const role_guard_1 = require("../auth/role.guard");
const base_entity_1 = require("../base.entity");
const role_decorator_1 = require("../auth/role.decorator");
const utils_1 = require("../lib/utils");
const others_dto_1 = require("./dto/others.dto");
let TenantKycController = class TenantKycController {
    tenantKycService;
    constructor(tenantKycService) {
        this.tenantKycService = tenantKycService;
    }
    create(createTenantKycDto) {
        return this.tenantKycService.create(createTenantKycDto);
    }
    findAll(query, admin_id) {
        return this.tenantKycService.findAll(admin_id, query);
    }
    findOne(id, admin_id) {
        return this.tenantKycService.findOne(admin_id, id);
    }
    update(id, updateTenantKycDto, admin_id) {
        return this.tenantKycService.update(admin_id, id, updateTenantKycDto);
    }
    deleteOne(id, admin_id) {
        return this.tenantKycService.deleteOne(admin_id, id);
    }
    deleteMany(bulkDeleteTenantKycDto, admin_id) {
        return this.tenantKycService.deleteMany(admin_id, bulkDeleteTenantKycDto);
    }
    deleteAll(admin_id) {
        return this.tenantKycService.deleteAll(admin_id);
    }
};
exports.TenantKycController = TenantKycController;
__decorate([
    openapi.ApiOperation({ summary: "Submit new tenant kyc data", description: "This is the first step to initiating the new tenancy process. After submission, admin reviews then sends them a registration link if approved." }),
    openapi.ApiResponse({ status: 409, description: "`Conflict`" }),
    openapi.ApiResponse({ status: 422, description: "`Unprocessable Entity` - Failed payload validation" }),
    openapi.ApiResponse({ status: 500, description: "`Internal Server Error`" }),
    (0, auth_decorator_1.SkipAuth)(),
    (0, swagger_1.ApiOkResponse)({ description: 'Operation successful' }),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.Post)(),
    openapi.ApiResponse({ status: common_1.HttpStatus.OK }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateTenantKycDto]),
    __metadata("design:returntype", void 0)
], TenantKycController.prototype, "create", null);
__decorate([
    openapi.ApiOperation({ summary: "Get all new tenant kyc data.", description: "Only accessible by admins/land-lords" }),
    openapi.ApiResponse({ status: 401, description: "`Unauthorized`" }),
    openapi.ApiResponse({ status: 403, description: "`Forbidden` - Access denied due to insufficient role permissions" }),
    openapi.ApiResponse({ status: 422, description: "`Unprocessable Entity` - Failed payload validation" }),
    openapi.ApiResponse({ status: 500, description: "`Internal Server Error`" }),
    (0, swagger_1.ApiOkResponse)({ description: 'Operation successful' }),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    (0, common_1.Get)(),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, utils_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [others_dto_1.ParseTenantKycQueryDto, String]),
    __metadata("design:returntype", void 0)
], TenantKycController.prototype, "findAll", null);
__decorate([
    openapi.ApiOperation({ summary: "View single new tenant kyc data.", description: "Only accessible by admins/land-lords" }),
    openapi.ApiResponse({ status: 401, description: "`Unauthorized`" }),
    openapi.ApiResponse({ status: 403, description: "`Forbidden` - Access denied due to insufficient role permissions" }),
    openapi.ApiResponse({ status: 404, description: "`NotFound`" }),
    openapi.ApiResponse({ status: 500, description: "`Internal Server Error`" }),
    (0, swagger_1.ApiOkResponse)({ description: 'Operation successful' }),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    (0, common_1.Get)(':id'),
    openapi.ApiResponse({ status: 200, type: require("./entities/tenant-kyc.entity").TenantKyc }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, utils_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], TenantKycController.prototype, "findOne", null);
__decorate([
    openapi.ApiOperation({ summary: "Update single kyc data.", description: "Only accessible by admins/land-lords" }),
    openapi.ApiResponse({ status: 401, description: "`Unauthorized`" }),
    openapi.ApiResponse({ status: 403, description: "`Forbidden` - Access denied due to insufficient role permissions" }),
    openapi.ApiResponse({ status: 404, description: "`NotFound`" }),
    openapi.ApiResponse({ status: 500, description: "`Internal Server Error`" }),
    (0, swagger_1.ApiOkResponse)({ description: 'Operation successful' }),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    (0, common_1.Patch)(':id'),
    openapi.ApiResponse({ status: 200, type: require("./entities/tenant-kyc.entity").TenantKyc }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, utils_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.UpdateTenantKycDto, String]),
    __metadata("design:returntype", void 0)
], TenantKycController.prototype, "update", null);
__decorate([
    openapi.ApiOperation({ summary: "Delete single kyc record.", description: "Only accessible by admins/land-lords" }),
    openapi.ApiResponse({ status: 401, description: "`Unauthorized`" }),
    openapi.ApiResponse({ status: 403, description: "`Forbidden` - Access denied due to insufficient role permissions" }),
    openapi.ApiResponse({ status: 404, description: "`NotFound`" }),
    openapi.ApiResponse({ status: 500, description: "`Internal Server Error`" }),
    (0, swagger_1.ApiOkResponse)({ description: 'Operation successful' }),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    (0, common_1.Delete)(':id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, utils_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], TenantKycController.prototype, "deleteOne", null);
__decorate([
    openapi.ApiOperation({ summary: "Bulk delete kyc records.", description: "Only accessible by admins/land-lords. Provide array of selected record ids to be deleted." }),
    openapi.ApiResponse({ status: 401, description: "`Unauthorized`" }),
    openapi.ApiResponse({ status: 403, description: "`Forbidden` - Access denied due to insufficient role permissions" }),
    openapi.ApiResponse({ status: 500, description: "`Internal Server Error`" }),
    (0, swagger_1.ApiOkResponse)({ description: 'Operation successful' }),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    (0, common_1.Delete)('bulk'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, utils_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [others_dto_1.BulkDeleteTenantKycDto, String]),
    __metadata("design:returntype", void 0)
], TenantKycController.prototype, "deleteMany", null);
__decorate([
    openapi.ApiOperation({ summary: "Delete all kyc records.", description: "Only accessible by admins/land-lords" }),
    openapi.ApiResponse({ status: 401, description: "`Unauthorized`" }),
    openapi.ApiResponse({ status: 403, description: "`Forbidden` - Access denied due to insufficient role permissions" }),
    openapi.ApiResponse({ status: 500, description: "`Internal Server Error`" }),
    (0, swagger_1.ApiOkResponse)({ description: 'Operation successful' }),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    (0, common_1.Delete)(),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, utils_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], TenantKycController.prototype, "deleteAll", null);
exports.TenantKycController = TenantKycController = __decorate([
    (0, common_1.Controller)('tenant-kyc'),
    __metadata("design:paramtypes", [tenant_kyc_service_1.TenantKycService])
], TenantKycController);
//# sourceMappingURL=tenant-kyc.controller.js.map
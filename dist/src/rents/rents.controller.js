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
exports.RentsController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const rents_service_1 = require("./rents.service");
const create_rent_dto_1 = require("./dto/create-rent.dto");
const update_rent_dto_1 = require("./dto/update-rent.dto");
const swagger_1 = require("@nestjs/swagger");
const paginate_dto_1 = require("./dto/paginate.dto");
const cloudinary_1 = require("../utils/cloudinary");
const role_guard_1 = require("../auth/role.guard");
const role_decorator_1 = require("../auth/role.decorator");
const base_entity_1 = require("../base.entity");
const create_rent_increase_dto_1 = require("./dto/create-rent-increase.dto");
let RentsController = class RentsController {
    rentsService;
    fileUploadService;
    constructor(rentsService, fileUploadService) {
        this.rentsService = rentsService;
        this.fileUploadService = fileUploadService;
    }
    async payRent(body) {
        try {
            return this.rentsService.payRent(body);
        }
        catch (error) {
            throw error;
        }
    }
    getAllRents(query) {
        try {
            return this.rentsService.getAllRents(query);
        }
        catch (error) {
            throw error;
        }
    }
    getRentByTenantId(tenant_id) {
        try {
            return this.rentsService.getRentByTenantId(tenant_id);
        }
        catch (error) {
            throw error;
        }
    }
    getDueRentsWithinSevenDays(query, req) {
        try {
            query.owner_id = req?.user?.id;
            return this.rentsService.getDueRentsWithinSevenDays(query);
        }
        catch (error) {
            throw error;
        }
    }
    getOverdueRents(query, req) {
        try {
            if (!query.property) {
                query.property = {};
            }
            query.property.owner_id = req?.user?.id;
            return this.rentsService.getOverdueRents(query);
        }
        catch (error) {
            throw error;
        }
    }
    sendReminder(id) {
        try {
            return this.rentsService.sendRentReminder(id);
        }
        catch (error) {
            throw error;
        }
    }
    getRentById(id) {
        try {
            return this.rentsService.getRentById(id);
        }
        catch (error) {
            throw error;
        }
    }
    async updatePropertyById(id, body) {
        try {
            return this.rentsService.updateRentById(id, body);
        }
        catch (error) {
            throw error;
        }
    }
    deletePropertyById(id) {
        try {
            return this.rentsService.deleteRentById(id);
        }
        catch (error) {
            throw error;
        }
    }
    async saveOrUpdateRentIncrease(body, req) {
        try {
            return this.rentsService.saveOrUpdateRentIncrease(body, req?.user?.id);
        }
        catch (error) {
            throw error;
        }
    }
    async removeTenant(tenant_id, body) {
        try {
            const { property_id } = body;
            return this.rentsService.deactivateTenant({ tenant_id, property_id });
        }
        catch (error) {
            throw error;
        }
    }
};
exports.RentsController = RentsController;
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Pay Rent' }),
    (0, swagger_1.ApiBody)({ type: create_rent_dto_1.CreateRentDto }),
    (0, swagger_1.ApiCreatedResponse)({ type: create_rent_dto_1.CreateRentDto }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Post)(),
    openapi.ApiResponse({ status: 201, type: require("./entities/rent.entity").Rent }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_rent_dto_1.CreateRentDto]),
    __metadata("design:returntype", Promise)
], RentsController.prototype, "payRent", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get All Rents' }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'size', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'tenant_id', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'property_id', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'status', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'start_date', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'end_date', required: false, type: String }),
    (0, swagger_1.ApiOkResponse)({
        type: paginate_dto_1.PaginationResponseDto,
        description: 'Paginated list of rents',
    }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)(),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_rent_dto_1.RentFilter]),
    __metadata("design:returntype", void 0)
], RentsController.prototype, "getAllRents", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get Rents by Tenant ID' }),
    (0, swagger_1.ApiOkResponse)({
        type: create_rent_dto_1.CreateRentDto,
        description: 'Tenant Rents successfully fetched',
    }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Tenant has never paid rent' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)('tenant/:tenant_id'),
    openapi.ApiResponse({ status: 200, type: require("./entities/rent.entity").Rent }),
    __param(0, (0, common_1.Param)('tenant_id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], RentsController.prototype, "getRentByTenantId", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get Due Rents Within 7 Days' }),
    (0, swagger_1.ApiOkResponse)({
        type: paginate_dto_1.PaginationResponseDto,
        description: 'Paginated list of rents',
    }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)('due'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_rent_dto_1.RentFilter, Object]),
    __metadata("design:returntype", void 0)
], RentsController.prototype, "getDueRentsWithinSevenDays", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get Overdue Rents' }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'size', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'tenant_id', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'owner_id', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'property_id', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'status', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'start_date', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'end_date', required: false, type: String }),
    (0, swagger_1.ApiOkResponse)({
        type: paginate_dto_1.PaginationResponseDto,
        description: 'Paginated list of overdue rents',
    }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)('overdue'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_rent_dto_1.RentFilter, Object]),
    __metadata("design:returntype", void 0)
], RentsController.prototype, "getOverdueRents", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Send Rent Reminder' }),
    (0, swagger_1.ApiOkResponse)({
        description: 'Reminder sent successfully',
    }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Rent not found' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)('reminder/:id'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], RentsController.prototype, "sendReminder", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get One Rent' }),
    (0, swagger_1.ApiOkResponse)({
        type: create_rent_dto_1.CreateRentDto,
        description: 'Property successfully fetched',
    }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Rent not found' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)(':id'),
    openapi.ApiResponse({ status: 200, type: require("./entities/rent.entity").Rent }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], RentsController.prototype, "getRentById", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Update Rent' }),
    (0, swagger_1.ApiBody)({ type: update_rent_dto_1.UpdateRentDto }),
    (0, swagger_1.ApiOkResponse)({ description: 'Rent successfully updated' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Put)(':id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_rent_dto_1.UpdateRentDto]),
    __metadata("design:returntype", Promise)
], RentsController.prototype, "updatePropertyById", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Delete Rent' }),
    (0, swagger_1.ApiOkResponse)(),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Delete)(':id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], RentsController.prototype, "deletePropertyById", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Create or update rent increase for a property' }),
    (0, swagger_1.ApiOkResponse)(),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'You do not own this Property' }),
    (0, common_1.Post)('increase'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_rent_increase_dto_1.CreateRentIncreaseDto, Object]),
    __metadata("design:returntype", Promise)
], RentsController.prototype, "saveOrUpdateRentIncrease", null);
__decorate([
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    (0, common_1.Put)('/remove/:tenant_id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('tenant_id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], RentsController.prototype, "removeTenant", null);
exports.RentsController = RentsController = __decorate([
    (0, swagger_1.ApiTags)('Rents'),
    (0, common_1.Controller)('rents'),
    __metadata("design:paramtypes", [rents_service_1.RentsService,
        cloudinary_1.FileUploadService])
], RentsController);
//# sourceMappingURL=rents.controller.js.map
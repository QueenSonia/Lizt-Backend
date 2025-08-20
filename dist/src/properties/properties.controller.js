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
exports.PropertiesController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const properties_service_1 = require("./properties.service");
const create_property_dto_1 = require("./dto/create-property.dto");
const update_property_dto_1 = require("./dto/update-property.dto");
const swagger_1 = require("@nestjs/swagger");
const paginate_dto_1 = require("./dto/paginate.dto");
const cloudinary_1 = require("../utils/cloudinary");
const role_guard_1 = require("../auth/role.guard");
const role_decorator_1 = require("../auth/role.decorator");
const base_entity_1 = require("../base.entity");
const move_tenant_dto_1 = require("./dto/move-tenant.dto");
const create_property_group_dto_1 = require("./dto/create-property-group.dto");
const assign_tenant_dto_1 = require("./dto/assign-tenant.dto");
let PropertiesController = class PropertiesController {
    propertiesService;
    fileUploadService;
    constructor(propertiesService, fileUploadService) {
        this.propertiesService = propertiesService;
        this.fileUploadService = fileUploadService;
    }
    async createProperty(body, req) {
        try {
            const owner_id = req?.user?.id;
            const payload = {
                owner_id,
                ...body,
            };
            return this.propertiesService.createProperty(payload);
        }
        catch (error) {
            throw error;
        }
    }
    getAllProperties(query, req) {
        try {
            query.owner_id = req?.user?.id;
            return this.propertiesService.getAllProperties(query);
        }
        catch (error) {
            throw error;
        }
    }
    getVacantProperty(query, req) {
        try {
            query.owner_id = req?.user?.id;
            return this.propertiesService.getVacantProperty(query);
        }
        catch (error) {
            throw error;
        }
    }
    async getAllPropertyGroups(req) {
        try {
            const owner_id = req?.user?.id;
            return this.propertiesService.getAllPropertyGroups(owner_id);
        }
        catch (error) {
            throw error;
        }
    }
    getPropertyById(id) {
        try {
            return this.propertiesService.getPropertyById(id);
        }
        catch (error) {
            throw error;
        }
    }
    getRentsOfAProperty(id) {
        try {
            return this.propertiesService.getRentsOfAProperty(id);
        }
        catch (error) {
            throw error;
        }
    }
    getServiceRequestOfAProperty(id) {
        try {
            return this.propertiesService.getServiceRequestOfAProperty(id);
        }
        catch (error) {
            throw error;
        }
    }
    async updatePropertyById(id, body) {
        try {
            return this.propertiesService.updatePropertyById(id, body);
        }
        catch (error) {
            throw error;
        }
    }
    deletePropertyById(id) {
        try {
            return this.propertiesService.deletePropertyById(id);
        }
        catch (error) {
            throw error;
        }
    }
    async getAdminDashboardStats(req) {
        try {
            const user_id = req?.user?.id;
            return await this.propertiesService.getAdminDashboardStats(user_id);
        }
        catch (error) {
            throw error;
        }
    }
    moveTenantIn(moveInData) {
        try {
            return this.propertiesService.moveTenantIn(moveInData);
        }
        catch (error) {
            throw error;
        }
    }
    moveTenantOut(moveOutData) {
        try {
            return this.propertiesService.moveTenantOut(moveOutData);
        }
        catch (error) {
            throw error;
        }
    }
    async createPropertyGroup(body, req) {
        try {
            const owner_id = req?.user?.id;
            return this.propertiesService.createPropertyGroup(body, owner_id);
        }
        catch (error) {
            throw error;
        }
    }
    async getPropertyGroupById(id, req) {
        try {
            const owner_id = req?.user?.id;
            return this.propertiesService.getPropertyGroupById(id, owner_id);
        }
        catch (error) {
            throw error;
        }
    }
    async assignTenantToProperty(id, data) {
        return this.propertiesService.assignTenant(id, data);
    }
};
exports.PropertiesController = PropertiesController;
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Create Property' }),
    (0, swagger_1.ApiBody)({ type: create_property_dto_1.CreatePropertyDto }),
    (0, swagger_1.ApiCreatedResponse)({ type: create_property_dto_1.CreatePropertyDto }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Post)(),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    openapi.ApiResponse({ status: 201, type: require("./dto/create-property.dto").CreatePropertyDto }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_property_dto_1.CreatePropertyDto, Object]),
    __metadata("design:returntype", Promise)
], PropertiesController.prototype, "createProperty", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get All Properties' }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'size', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'name', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'property_status', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'location', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'tenant_id', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'owner_id', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'start_date', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'end_date', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'search', required: false, type: String }),
    (0, swagger_1.ApiOkResponse)({
        type: paginate_dto_1.PaginationResponseDto,
        description: 'Paginated list of properties',
    }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)(),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PropertiesController.prototype, "getAllProperties", null);
__decorate([
    (0, common_1.Get)('/vacant'),
    openapi.ApiResponse({ status: 200, type: [require("./entities/property.entity").Property] }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PropertiesController.prototype, "getVacantProperty", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get All Property Groups' }),
    (0, swagger_1.ApiOkResponse)({
        description: 'List of property groups with their properties',
    }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)('property-groups'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PropertiesController.prototype, "getAllPropertyGroups", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get One Property' }),
    (0, swagger_1.ApiOkResponse)({
        type: create_property_dto_1.CreatePropertyDto,
        description: 'Property successfully fetched',
    }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Property not found' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)(':id'),
    openapi.ApiResponse({ status: 200, type: require("./dto/create-property.dto").CreatePropertyDto }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PropertiesController.prototype, "getPropertyById", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get Rents Of A Property' }),
    (0, swagger_1.ApiOkResponse)({
        type: create_property_dto_1.CreatePropertyDto,
        description: 'Property and rents successfully fetched',
    }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Property not found' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)('rent/:id'),
    openapi.ApiResponse({ status: 200, type: require("./dto/create-property.dto").CreatePropertyDto }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PropertiesController.prototype, "getRentsOfAProperty", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get Service Request Of A Property' }),
    (0, swagger_1.ApiOkResponse)({
        type: create_property_dto_1.CreatePropertyDto,
        description: 'Property and Service request successfully fetched',
    }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Service request not found' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)('service-request/:id'),
    openapi.ApiResponse({ status: 200, type: require("./dto/create-property.dto").CreatePropertyDto }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PropertiesController.prototype, "getServiceRequestOfAProperty", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Update Property' }),
    (0, swagger_1.ApiBody)({ type: update_property_dto_1.UpdatePropertyDto }),
    (0, swagger_1.ApiOkResponse)({ description: 'Property successfully updated' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Put)(':id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_property_dto_1.UpdatePropertyDto]),
    __metadata("design:returntype", Promise)
], PropertiesController.prototype, "updatePropertyById", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Delete Property' }),
    (0, swagger_1.ApiOkResponse)(),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Delete)(':id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PropertiesController.prototype, "deletePropertyById", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get Admin Dashboard Stats' }),
    (0, swagger_1.ApiOkResponse)({
        schema: {
            properties: {
                total_properties: { type: 'number' },
                total_tenants: { type: 'number' },
                due_tenants: { type: 'number' },
                unresolved_requests: { type: 'number' },
            },
        },
    }),
    (0, common_1.Get)('admin/dashboard'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PropertiesController.prototype, "getAdminDashboardStats", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Move Tenant Into Property' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Tenant moved in successfully' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    (0, common_1.Post)('move-in'),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [move_tenant_dto_1.MoveTenantInDto]),
    __metadata("design:returntype", void 0)
], PropertiesController.prototype, "moveTenantIn", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Move Tenant Out of Property' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Tenant moved out successfully' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    (0, common_1.Post)('move-out'),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [move_tenant_dto_1.MoveTenantOutDto]),
    __metadata("design:returntype", void 0)
], PropertiesController.prototype, "moveTenantOut", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Create Property Group' }),
    (0, swagger_1.ApiBody)({ type: create_property_group_dto_1.CreatePropertyGroupDto }),
    (0, swagger_1.ApiCreatedResponse)({ type: create_property_group_dto_1.CreatePropertyGroupDto }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Post)('property-group'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_property_group_dto_1.CreatePropertyGroupDto, Object]),
    __metadata("design:returntype", Promise)
], PropertiesController.prototype, "createPropertyGroup", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get Property Group Details' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Property group details with properties' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)('property-group/:id'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PropertiesController.prototype, "getPropertyGroupById", null);
__decorate([
    (0, common_1.Post)('assign-tenant/:id'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, assign_tenant_dto_1.AssignTenantDto]),
    __metadata("design:returntype", Promise)
], PropertiesController.prototype, "assignTenantToProperty", null);
exports.PropertiesController = PropertiesController = __decorate([
    (0, swagger_1.ApiTags)('Properties'),
    (0, common_1.Controller)('properties'),
    __metadata("design:paramtypes", [properties_service_1.PropertiesService,
        cloudinary_1.FileUploadService])
], PropertiesController);
//# sourceMappingURL=properties.controller.js.map
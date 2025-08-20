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
exports.PropertyHistoryController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const property_history_service_1 = require("./property-history.service");
const create_property_history_dto_1 = require("./dto/create-property-history.dto");
const update_property_history_dto_1 = require("./dto/update-property-history.dto");
const paginate_dto_1 = require("./dto/paginate.dto");
let PropertyHistoryController = class PropertyHistoryController {
    propertyHistoryService;
    constructor(propertyHistoryService) {
        this.propertyHistoryService = propertyHistoryService;
    }
    createPropertyHistory(body) {
        try {
            return this.propertyHistoryService.createPropertyHistory(body);
        }
        catch (error) {
            throw error;
        }
    }
    getAllPropertyHistories(query) {
        try {
            return this.propertyHistoryService.getAllPropertyHistories(query);
        }
        catch (error) {
            throw error;
        }
    }
    getPropertyHistoryById(id) {
        try {
            return this.propertyHistoryService.getPropertyHistoryById(id);
        }
        catch (error) {
            throw error;
        }
    }
    updatePropertyHistoryById(id, body) {
        try {
            return this.propertyHistoryService.updatePropertyHistoryById(id, body);
        }
        catch (error) {
            throw error;
        }
    }
    deletePropertyHistoryById(id) {
        try {
            return this.propertyHistoryService.deletePropertyHistoryById(id);
        }
        catch (error) {
            throw error;
        }
    }
    async getServiceRequestsByTenantAndProperty(property_id, query, req) {
        try {
            const tenant_id = req?.user?.id;
            return this.propertyHistoryService.getPropertyHistoryByTenantId(tenant_id, property_id, query);
        }
        catch (error) {
            throw error;
        }
    }
};
exports.PropertyHistoryController = PropertyHistoryController;
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Create Property History' }),
    (0, swagger_1.ApiBody)({ type: create_property_history_dto_1.CreatePropertyHistoryDto }),
    (0, swagger_1.ApiCreatedResponse)({ type: create_property_history_dto_1.CreatePropertyHistoryDto }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Post)(),
    openapi.ApiResponse({ status: 201, type: require("./dto/create-property-history.dto").CreatePropertyHistoryDto }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_property_history_dto_1.CreatePropertyHistoryDto]),
    __metadata("design:returntype", void 0)
], PropertyHistoryController.prototype, "createPropertyHistory", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get All Property Histories' }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'size', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'property_id', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'tenant_id', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'move_in_date', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'move_out_date', required: false, type: String }),
    (0, swagger_1.ApiOkResponse)({
        type: paginate_dto_1.PaginationResponseDto,
        description: 'Paginated list of property histories',
    }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)(),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PropertyHistoryController.prototype, "getAllPropertyHistories", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get One Property History' }),
    (0, swagger_1.ApiOkResponse)({
        type: create_property_history_dto_1.CreatePropertyHistoryDto,
        description: 'Property history successfully fetched',
    }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Property history not found' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)(':id'),
    openapi.ApiResponse({ status: 200, type: require("./dto/create-property-history.dto").CreatePropertyHistoryDto }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PropertyHistoryController.prototype, "getPropertyHistoryById", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Update Property History' }),
    (0, swagger_1.ApiBody)({ type: update_property_history_dto_1.UpdatePropertyHistoryDto }),
    (0, swagger_1.ApiOkResponse)({ description: 'Property history successfully updated' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Put)(':id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_property_history_dto_1.UpdatePropertyHistoryDto]),
    __metadata("design:returntype", void 0)
], PropertyHistoryController.prototype, "updatePropertyHistoryById", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Delete Property History' }),
    (0, swagger_1.ApiOkResponse)(),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Delete)(':id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PropertyHistoryController.prototype, "deletePropertyHistoryById", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get Property Histories by Tenant ID' }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'size', required: false, type: Number }),
    (0, swagger_1.ApiOkResponse)({
        type: paginate_dto_1.PaginationResponseDto,
        description: 'Property histories for tenant successfully fetched',
    }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)('tenant-property/:property_id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('property_id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Query)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], PropertyHistoryController.prototype, "getServiceRequestsByTenantAndProperty", null);
exports.PropertyHistoryController = PropertyHistoryController = __decorate([
    (0, swagger_1.ApiTags)('Property-History'),
    (0, common_1.Controller)('property-history'),
    __metadata("design:paramtypes", [property_history_service_1.PropertyHistoryService])
], PropertyHistoryController);
//# sourceMappingURL=property-history.controller.js.map
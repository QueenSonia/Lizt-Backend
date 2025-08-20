"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceRequestsModule = void 0;
const common_1 = require("@nestjs/common");
const service_requests_service_1 = require("./service-requests.service");
const service_requests_controller_1 = require("./service-requests.controller");
const typeorm_1 = require("@nestjs/typeorm");
const service_request_entity_1 = require("./entities/service-request.entity");
const property_tenants_entity_1 = require("../properties/entities/property-tenants.entity");
const cloudinary_1 = require("../utils/cloudinary");
const auto_service_request_entity_1 = require("./entities/auto-service-request.entity");
let ServiceRequestsModule = class ServiceRequestsModule {
};
exports.ServiceRequestsModule = ServiceRequestsModule;
exports.ServiceRequestsModule = ServiceRequestsModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([service_request_entity_1.ServiceRequest, auto_service_request_entity_1.AutoServiceRequest, property_tenants_entity_1.PropertyTenant])],
        controllers: [service_requests_controller_1.ServiceRequestsController],
        providers: [service_requests_service_1.ServiceRequestsService, cloudinary_1.FileUploadService],
    })
], ServiceRequestsModule);
//# sourceMappingURL=service-requests.module.js.map
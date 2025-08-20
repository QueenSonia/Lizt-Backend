"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RentsModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const rents_service_1 = require("./rents.service");
const rents_controller_1 = require("./rents.controller");
const rent_entity_1 = require("./entities/rent.entity");
const cloudinary_1 = require("../utils/cloudinary");
const rent_increase_entity_1 = require("./entities/rent-increase.entity");
const property_entity_1 = require("../properties/entities/property.entity");
const property_tenants_entity_1 = require("../properties/entities/property-tenants.entity");
let RentsModule = class RentsModule {
};
exports.RentsModule = RentsModule;
exports.RentsModule = RentsModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([rent_entity_1.Rent, rent_increase_entity_1.RentIncrease, property_entity_1.Property, property_tenants_entity_1.PropertyTenant])],
        controllers: [rents_controller_1.RentsController],
        providers: [rents_service_1.RentsService, cloudinary_1.FileUploadService],
        exports: [rents_service_1.RentsService, typeorm_1.TypeOrmModule]
    })
], RentsModule);
//# sourceMappingURL=rents.module.js.map
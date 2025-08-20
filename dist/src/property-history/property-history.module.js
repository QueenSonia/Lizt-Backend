"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PropertyHistoryModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const property_history_service_1 = require("./property-history.service");
const property_history_controller_1 = require("./property-history.controller");
const property_history_entity_1 = require("./entities/property-history.entity");
let PropertyHistoryModule = class PropertyHistoryModule {
};
exports.PropertyHistoryModule = PropertyHistoryModule;
exports.PropertyHistoryModule = PropertyHistoryModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([property_history_entity_1.PropertyHistory])],
        controllers: [property_history_controller_1.PropertyHistoryController],
        providers: [property_history_service_1.PropertyHistoryService],
    })
], PropertyHistoryModule);
//# sourceMappingURL=property-history.module.js.map
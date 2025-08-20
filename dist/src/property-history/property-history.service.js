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
exports.PropertyHistoryService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const property_history_entity_1 = require("./entities/property-history.entity");
const config_1 = require("../config");
const query_filter_1 = require("../filters/query-filter");
let PropertyHistoryService = class PropertyHistoryService {
    propertyHistoryRepository;
    constructor(propertyHistoryRepository) {
        this.propertyHistoryRepository = propertyHistoryRepository;
    }
    async createPropertyHistory(data) {
        return this.propertyHistoryRepository.save(data);
    }
    async getAllPropertyHistories(queryParams) {
        const page = queryParams?.page
            ? Number(queryParams?.page)
            : config_1.config.DEFAULT_PAGE_NO;
        const size = queryParams?.size
            ? Number(queryParams.size)
            : config_1.config.DEFAULT_PER_PAGE;
        const skip = (page - 1) * size;
        const query = await (0, query_filter_1.buildPropertyHistoryFilter)(queryParams);
        const [propertyHistories, count] = await this.propertyHistoryRepository.findAndCount({
            where: query,
            relations: ['property', 'tenant'],
            skip,
            take: size,
            order: { created_at: 'DESC' },
        });
        const totalPages = Math.ceil(count / size);
        return {
            property_histories: propertyHistories,
            pagination: {
                totalRows: count,
                perPage: size,
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
            },
        };
    }
    async getPropertyHistoryById(id) {
        const propertyHistory = await this.propertyHistoryRepository.findOne({
            where: { id },
            relations: ['property', 'tenant'],
        });
        if (!propertyHistory?.id) {
            throw new common_1.HttpException(`Property history with id: ${id} not found`, common_1.HttpStatus.NOT_FOUND);
        }
        return propertyHistory;
    }
    async updatePropertyHistoryById(id, data) {
        await this.getPropertyHistoryById(id);
        return this.propertyHistoryRepository.update(id, data);
    }
    async deletePropertyHistoryById(id) {
        await this.getPropertyHistoryById(id);
        return this.propertyHistoryRepository.delete(id);
    }
    async getPropertyHistoryByTenantId(tenant_id, property_id, queryParams) {
        const page = queryParams?.page
            ? Number(queryParams?.page)
            : config_1.config.DEFAULT_PAGE_NO;
        const size = queryParams?.size ? Number(queryParams.size) : 10;
        const skip = (page - 1) * size;
        const [propertyHistories, count] = await this.propertyHistoryRepository.findAndCount({
            where: {
                tenant_id,
                property_id,
            },
            skip,
            take: size,
            order: { created_at: 'DESC' },
        });
        const totalPages = Math.ceil(count / size);
        return {
            property_histories: propertyHistories,
            pagination: {
                totalRows: count,
                perPage: size,
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
            },
        };
    }
};
exports.PropertyHistoryService = PropertyHistoryService;
exports.PropertyHistoryService = PropertyHistoryService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(property_history_entity_1.PropertyHistory)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], PropertyHistoryService);
//# sourceMappingURL=property-history.service.js.map
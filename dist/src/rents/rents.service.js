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
exports.RentsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const create_rent_dto_1 = require("./dto/create-rent.dto");
const rent_entity_1 = require("./entities/rent.entity");
const date_helper_1 = require("../utils/date.helper");
const query_filter_1 = require("../filters/query-filter");
const email_template_1 = require("../utils/email-template");
const utility_service_1 = require("../utils/utility-service");
const config_1 = require("../config");
const rent_increase_entity_1 = require("./entities/rent-increase.entity");
const property_entity_1 = require("../properties/entities/property.entity");
const create_property_dto_1 = require("../properties/dto/create-property.dto");
const property_tenants_entity_1 = require("../properties/entities/property-tenants.entity");
let RentsService = class RentsService {
    rentRepository;
    propertyRepository;
    propertyTenantRepository;
    rentIncreaseRepository;
    constructor(rentRepository, propertyRepository, propertyTenantRepository, rentIncreaseRepository) {
        this.rentRepository = rentRepository;
        this.propertyRepository = propertyRepository;
        this.propertyTenantRepository = propertyTenantRepository;
        this.rentIncreaseRepository = rentIncreaseRepository;
    }
    async payRent(data) {
        const { lease_start_date, lease_end_date } = data;
        data.lease_start_date = date_helper_1.DateService.getStartOfTheDay(lease_start_date);
        data.lease_end_date = date_helper_1.DateService.getEndOfTheDay(lease_end_date);
        return this.rentRepository.save(data);
    }
    async getAllRents(queryParams) {
        const page = queryParams?.page
            ? Number(queryParams?.page)
            : config_1.config.DEFAULT_PAGE_NO;
        const size = queryParams?.size
            ? Number(queryParams.size)
            : config_1.config.DEFAULT_PER_PAGE;
        const skip = (page - 1) * size;
        const query = await (0, query_filter_1.buildRentFilter)(queryParams);
        const [rents, count] = await this.rentRepository.findAndCount({
            where: query,
            skip,
            take: size,
            order: { created_at: 'DESC' },
        });
        const totalPages = Math.ceil(count / size);
        return {
            rents,
            pagination: {
                totalRows: count,
                perPage: size,
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
            },
        };
    }
    async getRentByTenantId(tenant_id) {
        const rent = await this.rentRepository.findOne({
            where: { tenant_id },
            relations: ['tenant', 'property'],
        });
        if (!rent?.id) {
            throw new common_1.HttpException(`Tenant has never paid rent`, common_1.HttpStatus.NOT_FOUND);
        }
        return rent;
    }
    async getDueRentsWithinSevenDays(queryParams) {
        const page = queryParams?.page
            ? Number(queryParams?.page)
            : config_1.config.DEFAULT_PAGE_NO;
        const size = queryParams?.size
            ? Number(queryParams.size)
            : config_1.config.DEFAULT_PER_PAGE;
        const skip = (page - 1) * size;
        const query = await (0, query_filter_1.buildRentFilter)(queryParams);
        const startDate = date_helper_1.DateService.getStartOfTheDay(new Date());
        const endDate = date_helper_1.DateService.getEndOfTheDay(date_helper_1.DateService.addDays(new Date(), 7));
        const [rents, count] = await this.rentRepository.findAndCount({
            where: {
                ...query,
                expiry_date: (0, typeorm_2.Between)(startDate, endDate),
            },
            relations: ['tenant', 'property'],
            skip,
            take: size,
            order: { expiry_date: 'ASC' },
        });
        const totalPages = Math.ceil(count / size);
        return {
            rents,
            pagination: {
                totalRows: count,
                perPage: size,
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
            },
        };
    }
    async getOverdueRents(queryParams) {
        const page = queryParams?.page
            ? Number(queryParams?.page)
            : config_1.config.DEFAULT_PAGE_NO;
        const size = queryParams?.size
            ? Number(queryParams.size)
            : config_1.config.DEFAULT_PER_PAGE;
        const skip = (page - 1) * size;
        const query = await (0, query_filter_1.buildRentFilter)(queryParams);
        const currentDate = new Date();
        const [rents, count] = await this.rentRepository.findAndCount({
            where: {
                ...query,
            },
            relations: ['tenant', 'property'],
            skip,
            take: size,
            order: { expiry_date: 'ASC' },
        });
        const totalPages = Math.ceil(count / size);
        return {
            rents,
            pagination: {
                totalRows: count,
                perPage: size,
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
            },
        };
    }
    async sendRentReminder(id) {
        const rent = await this.rentRepository.findOne({
            where: { id },
            relations: ['tenant', 'property'],
        });
        if (!rent?.id) {
            throw new common_1.HttpException('Rent not found', common_1.HttpStatus.NOT_FOUND);
        }
        const emailContent = (0, email_template_1.rentReminderEmailTemplate)(`${rent?.tenant?.user.first_name} ${rent?.tenant?.user.last_name}`, rent?.property?.rental_price, date_helper_1.DateService.getDateNormalFormat(rent?.expiry_date));
        await utility_service_1.UtilService.sendEmail(rent?.tenant?.email, `Rent Reminder for ${rent.property.name}`, emailContent);
        return { message: 'Reminder sent successfully' };
    }
    async getRentById(id) {
        const rent = await this.rentRepository.findOne({
            where: { id },
            relations: ['tenant', 'property'],
        });
        if (!rent?.id) {
            throw new common_1.HttpException(`Rent not found`, common_1.HttpStatus.NOT_FOUND);
        }
        return rent;
    }
    async updateRentById(id, data) {
        return this.rentRepository.update(id, data);
    }
    async deleteRentById(id) {
        return this.rentRepository.delete(id);
    }
    async saveOrUpdateRentIncrease(data, userId) {
        const property = await this.propertyRepository.findOne({
            where: { id: data.property_id, owner_id: userId },
        });
        if (!property) {
            throw new common_1.HttpException('You do not own this Property', common_1.HttpStatus.NOT_FOUND);
        }
        const existingRentIncrease = await this.rentIncreaseRepository.findOne({
            where: { property_id: data.property_id },
        });
        await this.propertyRepository.update(data.property_id, {
            rental_price: data?.current_rent,
        });
        if (existingRentIncrease?.id) {
            return this.rentIncreaseRepository.update(existingRentIncrease.id, {
                ...data,
                rent_increase_date: date_helper_1.DateService.getStartOfTheDay(new Date()),
            });
        }
        return this.rentIncreaseRepository.save({
            ...data,
            rent_increase_date: date_helper_1.DateService.getStartOfTheDay(new Date()),
        });
    }
    async findActiveRent(query) {
        return this.rentRepository.findOne({
            where: {
                ...query,
                rent_status: create_rent_dto_1.RentStatusEnum.ACTIVE
            }
        });
    }
    async deactivateTenant(data) {
        const { tenant_id, property_id } = data;
        const rent = await this.rentRepository.findOne({
            where: {
                tenant_id,
                property_id
            }
        });
        if (rent) {
            await this.propertyRepository.update({ id: rent.property_id }, { property_status: create_property_dto_1.PropertyStatusEnum.VACANT });
            await this.propertyTenantRepository.update({ tenant_id: rent.tenant_id }, { status: create_property_dto_1.TenantStatusEnum.INACTIVE });
            await this.rentRepository.update({ tenant_id }, { rent_status: create_rent_dto_1.RentStatusEnum.INACTIVE });
        }
    }
};
exports.RentsService = RentsService;
exports.RentsService = RentsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(rent_entity_1.Rent)),
    __param(1, (0, typeorm_1.InjectRepository)(property_entity_1.Property)),
    __param(2, (0, typeorm_1.InjectRepository)(property_tenants_entity_1.PropertyTenant)),
    __param(3, (0, typeorm_1.InjectRepository)(rent_increase_entity_1.RentIncrease)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository])
], RentsService);
//# sourceMappingURL=rents.service.js.map
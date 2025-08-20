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
exports.PropertiesService = void 0;
const common_1 = require("@nestjs/common");
const create_property_dto_1 = require("./dto/create-property.dto");
const typeorm_1 = require("@nestjs/typeorm");
const property_entity_1 = require("./entities/property.entity");
const typeorm_2 = require("typeorm");
const query_filter_1 = require("../filters/query-filter");
const create_service_request_dto_1 = require("../service-requests/dto/create-service-request.dto");
const date_helper_1 = require("../utils/date.helper");
const ormconfig_1 = require("../../ormconfig");
const property_tenants_entity_1 = require("./entities/property-tenants.entity");
const config_1 = require("../config");
const property_history_entity_1 = require("../property-history/entities/property-history.entity");
const property_group_entity_1 = require("./entities/property-group.entity");
const rents_service_1 = require("../rents/rents.service");
const event_emitter_1 = require("@nestjs/event-emitter");
const users_service_1 = require("../users/users.service");
const rent_entity_1 = require("../rents/entities/rent.entity");
const create_rent_dto_1 = require("../rents/dto/create-rent.dto");
let PropertiesService = class PropertiesService {
    propertyRepository;
    propertyGroupRepository;
    userService;
    rentService;
    eventEmitter;
    dataSource;
    constructor(propertyRepository, propertyGroupRepository, userService, rentService, eventEmitter, dataSource) {
        this.propertyRepository = propertyRepository;
        this.propertyGroupRepository = propertyGroupRepository;
        this.userService = userService;
        this.rentService = rentService;
        this.eventEmitter = eventEmitter;
        this.dataSource = dataSource;
    }
    async createProperty(data) {
        const createdProperty = await this.propertyRepository.save(data);
        this.eventEmitter.emit('property.created', {
            property_id: createdProperty.id,
            property_name: createdProperty.name,
            user_id: createdProperty.owner_id,
        });
        return createdProperty;
    }
    async getAllProperties(queryParams) {
        const page = queryParams.page ? Number(queryParams.page) : config_1.config.DEFAULT_PAGE_NO;
        const size = queryParams.size ? Number(queryParams.size) : config_1.config.DEFAULT_PER_PAGE;
        const skip = (page - 1) * size;
        const { query, order } = await (0, query_filter_1.buildPropertyFilter)(queryParams);
        const qb = this.propertyRepository
            .createQueryBuilder('property')
            .leftJoinAndSelect('property.rents', 'rents')
            .leftJoinAndSelect('rents.tenant', 'tenant')
            .leftJoinAndSelect('property.property_tenants', 'property_tenants')
            .where(query);
        if (queryParams.sort_by === 'rent' && queryParams?.sort_order) {
            qb.orderBy('rents.rental_price', queryParams.sort_order.toUpperCase());
        }
        else if (queryParams.sort_by === 'expiry' && queryParams?.sort_order) {
            qb.orderBy('rents.lease_end_date', queryParams.sort_order.toUpperCase());
        }
        else if (queryParams.sort_by && queryParams?.sort_order) {
            qb.orderBy(`property.${queryParams.sort_by}`, queryParams.sort_order.toUpperCase());
        }
        const [properties, count] = await qb.skip(skip).take(size).getManyAndCount();
        const totalPages = Math.ceil(count / size);
        return {
            properties,
            pagination: {
                totalRows: count,
                perPage: size,
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
            },
        };
    }
    async getVacantProperty(query) {
        return await this.propertyRepository.find({
            where: {
                property_status: create_property_dto_1.PropertyStatusEnum.VACANT,
                ...query,
            },
            relations: ['property_tenants', 'rents', 'rents.tenant'],
        });
    }
    async getPropertyById(id) {
        const property = await this.propertyRepository.findOne({
            where: { id },
            relations: [
                'rents',
                'property_tenants',
                'property_tenants.tenant',
                'property_tenants.tenant.user',
                'owner',
            ],
        });
        if (!property?.id) {
            throw new common_1.HttpException(`Property with id: ${id} not found`, common_1.HttpStatus.NOT_FOUND);
        }
        return property;
    }
    async getRentsOfAProperty(id) {
        const propertyAndRent = await this.propertyRepository.findOne({
            where: { id },
            relations: ['rents', 'rents.tenant'],
        });
        if (!propertyAndRent?.id) {
            throw new common_1.HttpException(`Property with id: ${id} not found`, common_1.HttpStatus.NOT_FOUND);
        }
        return propertyAndRent;
    }
    async getServiceRequestOfAProperty(id) {
        const propertyAndRent = await this.propertyRepository.findOne({
            where: { id },
            relations: ['service_requests', 'service_requests.tenant'],
        });
        if (!propertyAndRent?.id) {
            throw new common_1.HttpException(`Property with id: ${id} not found`, common_1.HttpStatus.NOT_FOUND);
        }
        return propertyAndRent;
    }
    async updatePropertyById(id, data) {
        try {
            const activeRent = (await this.rentService.findActiveRent({
                property_id: id,
            }));
            if (!activeRent) {
                return this.propertyRepository.update(id, {
                    name: data.name,
                    location: data.location,
                    no_of_bedrooms: data.no_of_bedrooms,
                });
            }
            await this.userService.updateUserById(activeRent.tenant_id, {
                first_name: data.first_name,
                last_name: data.last_name,
                phone_number: data.phone_number,
            });
            await this.rentService.updateRentById(activeRent.id, {
                lease_start_date: data.lease_end_date,
                lease_end_date: data.lease_end_date,
                rental_price: data.rental_price,
                service_charge: data.service_charge,
                security_deposit: data.security_deposit,
            });
            return this.propertyRepository.update(id, {
                name: data.name,
                location: data.location,
                property_status: data.occupancy_status,
            });
        }
        catch (error) {
            throw new common_1.HttpException(error.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async deletePropertyById(id) {
        try {
            const property = await this.propertyRepository.findOne({
                where: { id },
            });
            if (property?.property_status === create_property_dto_1.PropertyStatusEnum.NOT_VACANT) {
                throw new common_1.HttpException('Cannot delete property that is not vacant', common_1.HttpStatus.BAD_REQUEST);
            }
            return this.propertyRepository.delete(id);
        }
        catch (error) {
            console.log(error);
            throw new common_1.HttpException(error.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async getAdminDashboardStats(user_id) {
        const stats = await this.propertyRepository
            .createQueryBuilder('property')
            .leftJoin('property.property_tenants', 'property_tenants')
            .leftJoin('property_tenants.tenant', 'tenant')
            .leftJoin('property.service_requests', 'requests')
            .leftJoin('property.rents', 'rent')
            .where('property.owner_id = :user_id', { user_id })
            .select([
            'COUNT(DISTINCT property.id) as total_properties',
            'COUNT(DISTINCT tenant.id) as total_tenants',
            'COUNT(DISTINCT CASE WHEN rent.expiry_date <= :dueDate THEN tenant.id END) as due_tenants',
            'COUNT(DISTINCT CASE WHEN requests.status IN (:...statuses) THEN requests.id END) as unresolved_requests',
        ])
            .setParameters({
            dueDate: date_helper_1.DateService.addDays(new Date(), 7),
            statuses: [
                create_service_request_dto_1.ServiceRequestStatusEnum.PENDING,
                create_service_request_dto_1.ServiceRequestStatusEnum.URGENT,
            ],
        })
            .getRawOne();
        return {
            total_properties: Number(stats.total_properties),
            total_tenants: Number(stats.total_tenants),
            due_tenants: Number(stats.due_tenants),
            unresolved_requests: Number(stats.unresolved_requests),
        };
    }
    async moveTenantIn(moveInData) {
        const { property_id, tenant_id, move_in_date } = moveInData;
        if (!date_helper_1.DateService.isValidFormat_YYYY_MM_DD(move_in_date)) {
            throw new common_1.HttpException('Invalid date format. Use YYYY-MM-DD', common_1.HttpStatus.BAD_REQUEST);
        }
        const queryRunner = ormconfig_1.connectionSource.createQueryRunner();
        try {
            await ormconfig_1.connectionSource.initialize();
            await queryRunner.connect();
            await queryRunner.startTransaction();
            const property = await queryRunner.manager.findOne(property_entity_1.Property, {
                where: { id: property_id },
            });
            if (!property?.id) {
                throw new common_1.HttpException('Property not found', common_1.HttpStatus.NOT_FOUND);
            }
            const existingTenant = await queryRunner.manager.findOne(property_tenants_entity_1.PropertyTenant, {
                where: {
                    property_id,
                    tenant_id,
                    status: create_property_dto_1.TenantStatusEnum.ACTIVE,
                },
            });
            if (existingTenant?.id) {
                throw new common_1.HttpException('Tenant is already assigned to this property', common_1.HttpStatus.BAD_REQUEST);
            }
            const moveTenantIn = await queryRunner.manager.save(property_tenants_entity_1.PropertyTenant, {
                property_id,
                tenant_id,
                status: create_property_dto_1.TenantStatusEnum.ACTIVE,
            });
            await queryRunner.manager.update(property_entity_1.Property, property_id, {
                property_status: create_property_dto_1.PropertyStatusEnum.NOT_VACANT,
            });
            await queryRunner.manager.save(property_history_entity_1.PropertyHistory, {
                property_id,
                tenant_id,
                move_in_date: date_helper_1.DateService.getStartOfTheDay(move_in_date),
                monthly_rent: property?.rental_price,
                owner_comment: null,
                tenant_comment: null,
                move_out_date: null,
                move_out_reason: null,
            });
            await queryRunner.commitTransaction();
            return moveTenantIn;
        }
        catch (error) {
            await queryRunner.rollbackTransaction();
            throw new common_1.HttpException(error?.message || 'an error occurred while moving tenant in', common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        finally {
            await queryRunner.release();
            await ormconfig_1.connectionSource.destroy();
        }
    }
    async moveTenantOut(moveOutData) {
        const { property_id, tenant_id, move_out_date } = moveOutData;
        if (!date_helper_1.DateService.isValidFormat_YYYY_MM_DD(move_out_date)) {
            throw new common_1.HttpException('Invalid date format. Use YYYY-MM-DD', common_1.HttpStatus.BAD_REQUEST);
        }
        const queryRunner = ormconfig_1.connectionSource.createQueryRunner();
        try {
            await ormconfig_1.connectionSource.initialize();
            await queryRunner.connect();
            await queryRunner.startTransaction();
            const propertyTenant = await queryRunner.manager.findOne(property_tenants_entity_1.PropertyTenant, {
                where: {
                    property_id,
                    tenant_id,
                    status: create_property_dto_1.TenantStatusEnum.ACTIVE,
                },
            });
            if (!propertyTenant?.id) {
                throw new common_1.HttpException('Tenant is not currently assigned to this property', common_1.HttpStatus.BAD_REQUEST);
            }
            await queryRunner.manager.delete(property_tenants_entity_1.PropertyTenant, {
                property_id,
                tenant_id,
            });
            await queryRunner.manager.update(property_entity_1.Property, property_id, {
                property_status: create_property_dto_1.PropertyStatusEnum.VACANT,
            });
            const propertyHistory = await queryRunner.manager.findOne(property_history_entity_1.PropertyHistory, {
                where: {
                    property_id,
                    tenant_id,
                    move_out_date: (0, typeorm_2.IsNull)(),
                },
                order: { created_at: 'DESC' },
            });
            if (!propertyHistory) {
                throw new common_1.HttpException('Property history record not found', common_1.HttpStatus.NOT_FOUND);
            }
            const updatedHistory = await queryRunner.manager.save(property_history_entity_1.PropertyHistory, {
                ...propertyHistory,
                move_out_date: date_helper_1.DateService.getStartOfTheDay(move_out_date),
                move_out_reason: moveOutData?.move_out_reason || null,
                owner_comment: moveOutData?.owner_comment || null,
                tenant_comment: moveOutData?.tenant_comment || null,
            });
            await queryRunner.commitTransaction();
            return updatedHistory;
        }
        catch (error) {
            await queryRunner.rollbackTransaction();
            throw new common_1.HttpException(error?.message || 'an error occurred while moving tenant out', common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        finally {
            await queryRunner.release();
            await ormconfig_1.connectionSource.destroy();
        }
    }
    async createPropertyGroup(data, owner_id) {
        const properties = await this.propertyRepository.find({
            where: {
                id: (0, typeorm_2.In)(data.property_ids),
                owner_id,
            },
        });
        if (properties.length !== data.property_ids.length) {
            throw new common_1.HttpException('Some properties do not exist or do not belong to you', common_1.HttpStatus.BAD_REQUEST);
        }
        return this.propertyGroupRepository.save({
            name: data.name,
            property_ids: data.property_ids,
            owner_id,
        });
    }
    async getPropertyGroupById(id, owner_id) {
        const propertyGroup = await this.propertyGroupRepository.findOne({
            where: { id, owner_id },
        });
        if (!propertyGroup) {
            throw new common_1.HttpException('Property group not found', common_1.HttpStatus.NOT_FOUND);
        }
        const properties = await this.propertyRepository.find({
            where: { id: (0, typeorm_2.In)(propertyGroup.property_ids) },
        });
        return {
            ...propertyGroup,
            properties,
        };
    }
    async getAllPropertyGroups(owner_id) {
        const propertyGroups = await this.propertyGroupRepository.find({
            where: { owner_id },
            order: { created_at: 'DESC' },
        });
        const allPropertyIds = [
            ...new Set(propertyGroups.flatMap((group) => group.property_ids)),
        ];
        const properties = await this.propertyRepository.find({
            where: { id: (0, typeorm_2.In)(allPropertyIds) },
        });
        const propertyMap = new Map(properties.map((property) => [property.id, property]));
        const groupsWithProperties = propertyGroups.map((group) => ({
            ...group,
            properties: group.property_ids
                .map((id) => propertyMap.get(id))
                .filter(Boolean),
        }));
        return {
            property_groups: groupsWithProperties,
            total: propertyGroups.length,
        };
    }
    async assignTenant(id, data) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            const property = await queryRunner.manager.findOne(property_entity_1.Property, {
                where: { id },
            });
            if (!property?.id) {
                throw new common_1.HttpException(`Property with id: ${id} not found`, common_1.HttpStatus.NOT_FOUND);
            }
            const tenant = await this.userService.getAccountById(data.tenant_id);
            if (!tenant)
                throw new common_1.NotFoundException('Tenant not found');
            await queryRunner.manager.save(rent_entity_1.Rent, {
                tenant_id: data.tenant_id,
                lease_start_date: data.lease_start_date,
                lease_end_date: data.lease_end_date,
                property_id: property.id,
                amount_paid: data.rental_price,
                rental_price: data.rental_price,
                security_deposit: data.security_deposit,
                service_charge: data.service_charge,
                payment_status: create_rent_dto_1.RentPaymentStatusEnum.PAID,
                rent_status: create_rent_dto_1.RentStatusEnum.ACTIVE,
            });
            await Promise.all([
                queryRunner.manager.save(property_tenants_entity_1.PropertyTenant, {
                    property_id: property.id,
                    tenant_id: data.tenant_id,
                    status: create_property_dto_1.TenantStatusEnum.ACTIVE,
                }),
                queryRunner.manager.update(property_entity_1.Property, property.id, {
                    property_status: create_property_dto_1.PropertyStatusEnum.NOT_VACANT,
                }),
                queryRunner.manager.save(property_history_entity_1.PropertyHistory, {
                    property_id: property.id,
                    tenant_id: data.tenant_id,
                    move_in_date: date_helper_1.DateService.getStartOfTheDay(new Date()),
                    monthly_rent: data.rental_price,
                    owner_comment: null,
                    tenant_comment: null,
                    move_out_date: null,
                    move_out_reason: null,
                }),
            ]);
            await queryRunner.commitTransaction();
            return {
                message: 'Tenant Added Successfully',
            };
        }
        catch (error) {
            await queryRunner.rollbackTransaction();
            console.error('Transaction rolled back due to:', error);
            throw new common_1.HttpException(error?.message ||
                'An error occurred while assigning Tenant To property', common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        finally {
            await queryRunner.release();
        }
    }
};
exports.PropertiesService = PropertiesService;
exports.PropertiesService = PropertiesService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(property_entity_1.Property)),
    __param(1, (0, typeorm_1.InjectRepository)(property_group_entity_1.PropertyGroup)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        users_service_1.UsersService,
        rents_service_1.RentsService,
        event_emitter_1.EventEmitter2,
        typeorm_2.DataSource])
], PropertiesService);
//# sourceMappingURL=properties.service.js.map
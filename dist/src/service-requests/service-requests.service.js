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
exports.ServiceRequestsService = void 0;
const common_1 = require("@nestjs/common");
const create_service_request_dto_1 = require("./dto/create-service-request.dto");
const typeorm_1 = require("@nestjs/typeorm");
const service_request_entity_1 = require("./entities/service-request.entity");
const typeorm_2 = require("typeorm");
const query_filter_1 = require("../filters/query-filter");
const utility_service_1 = require("../utils/utility-service");
const config_1 = require("../config");
const create_property_dto_1 = require("../properties/dto/create-property.dto");
const property_tenants_entity_1 = require("../properties/entities/property-tenants.entity");
const event_emitter_1 = require("@nestjs/event-emitter");
const auto_service_request_entity_1 = require("./entities/auto-service-request.entity");
let ServiceRequestsService = class ServiceRequestsService {
    serviceRequestRepository;
    propertyTenantRepository;
    eventEmitter;
    autoServiceRequestRepository;
    constructor(serviceRequestRepository, propertyTenantRepository, eventEmitter, autoServiceRequestRepository) {
        this.serviceRequestRepository = serviceRequestRepository;
        this.propertyTenantRepository = propertyTenantRepository;
        this.eventEmitter = eventEmitter;
        this.autoServiceRequestRepository = autoServiceRequestRepository;
    }
    async tawkServiceRequest(payload) {
        try {
            const propertyTenant = await this.propertyTenantRepository.findOne({
                where: {
                    property: { id: payload.property.id },
                },
            });
            if (!propertyTenant) {
                throw new Error(`Property tenant not found for property ID: ${payload.property.id}`);
            }
            const autoServiceRequest = new auto_service_request_entity_1.AutoServiceRequest();
            autoServiceRequest.title = this.generateTitle(payload);
            autoServiceRequest.description = this.generateDescription(payload);
            autoServiceRequest.status = auto_service_request_entity_1.ServiceRequestStatus.OPEN;
            autoServiceRequest.priority = auto_service_request_entity_1.ServiceRequestPriority.MEDIUM;
            autoServiceRequest.source = auto_service_request_entity_1.ServiceRequestSource.TAWK_CHAT;
            autoServiceRequest.externalId = payload.chatId;
            autoServiceRequest.propertyTenant = propertyTenant;
            autoServiceRequest.customerName = payload.visitor.name;
            autoServiceRequest.customerEmail = payload.visitor.email;
            autoServiceRequest.customerLocation = `${payload.visitor.city}, ${payload.visitor.country}`;
            autoServiceRequest.createdAt = new Date(payload.time);
            autoServiceRequest.updatedAt = new Date();
            autoServiceRequest.metadata = {
                tawkChatId: payload.chatId,
                tawkEvent: payload.event,
                tawkPropertyName: payload.property.name,
                initialMessage: payload.message?.text,
                visitorInfo: {
                    city: payload.visitor.city,
                    country: payload.visitor.country,
                },
            };
            const savedautoServiceRequest = await this.autoServiceRequestRepository.save(autoServiceRequest);
            this.eventEmitter.emit('service-request.created', {
                autoServiceRequest: savedautoServiceRequest,
                source: 'tawk_chat',
                event: payload.event,
            });
            return savedautoServiceRequest;
        }
        catch (error) {
            console.error('Error creating service request from Tawk webhook:', error);
            throw error;
        }
    }
    generateTitle(payload) {
        const eventType = payload.event === 'chat:start' ? 'New Chat' : 'Chat Ended';
        return `${eventType} - ${payload.property.name}`;
    }
    generateDescription(payload) {
        const eventType = payload.event === 'chat:start' ? 'started' : 'ended';
        let description = `Chat ${eventType} on ${payload.property.name} at ${new Date(payload.time).toLocaleString()}.\n\n`;
        description += `Visitor: ${payload.visitor.name}\n`;
        description += `Email: ${payload.visitor.email}\n`;
        description += `Location: ${payload.visitor.city}, ${payload.visitor.country}\n`;
        if (payload.message?.text) {
            description += `\nInitial message: "${payload.message.text}"`;
        }
        return description;
    }
    async createServiceRequest(data) {
        const tenantExistInProperty = await this.propertyTenantRepository.findOne({
            where: {
                tenant_id: data.tenant_id,
                property_id: data.property_id,
                status: create_property_dto_1.TenantStatusEnum.ACTIVE,
            },
        });
        if (!tenantExistInProperty?.id) {
            throw new common_1.HttpException('You are not currently renting this property', common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        const requestId = utility_service_1.UtilService.generateServiceRequestId();
        const serviceRequest = this.serviceRequestRepository.save({
            ...data,
            issue_images: data?.issue_images || null,
            status: data?.status || create_service_request_dto_1.ServiceRequestStatusEnum.PENDING,
            request_id: requestId,
        });
        this.eventEmitter.emit('service.created', {
            user_id: data.tenant_id,
            property_id: data.property_id,
            tenant_name: tenantExistInProperty.tenant.profile_name,
            property_name: tenantExistInProperty.property.name
        });
        return serviceRequest;
    }
    async getAllServiceRequests(user_id, queryParams) {
        const page = queryParams?.page
            ? Number(queryParams?.page)
            : config_1.config.DEFAULT_PAGE_NO;
        const size = queryParams?.size
            ? Number(queryParams.size)
            : config_1.config.DEFAULT_PER_PAGE;
        const skip = (page - 1) * size;
        const query = await (0, query_filter_1.buildServiceRequestFilter)(queryParams);
        const [serviceRequests, count] = await this.serviceRequestRepository.findAndCount({
            where: {
                ...query,
                property: {
                    owner_id: user_id,
                },
            },
            relations: ['tenant', 'property'],
            skip,
            take: size,
            order: { created_at: 'DESC' },
        });
        const totalPages = Math.ceil(count / size);
        return {
            service_requests: serviceRequests,
            pagination: {
                totalRows: count,
                perPage: size,
                currentPage: page,
                totalPages: Math.ceil(count / size),
                hasNextPage: page < totalPages,
            },
        };
    }
    async getServiceRequestById(id) {
        const serviceRequest = await this.serviceRequestRepository.findOne({
            where: { id },
            relations: ['tenant', 'property'],
        });
        if (!serviceRequest?.id) {
            throw new common_1.HttpException(`Service request with id: ${id} not found`, common_1.HttpStatus.NOT_FOUND);
        }
        return serviceRequest;
    }
    async getServiceRequestByTenant(id, status) {
        const statuses = Array.isArray(status)
            ? status
            : status
                ? [status]
                : ['pending', 'in_progress', 'urgent', 'resolved'];
        const serviceRequest = await this.serviceRequestRepository.find({
            where: {
                tenant_id: id,
                status: (0, typeorm_2.In)(statuses),
            },
            relations: ['tenant', 'property'],
        });
        return serviceRequest;
    }
    async updateServiceRequestById(id, data) {
        return this.serviceRequestRepository.update(id, data);
    }
    async deleteServiceRequestById(id) {
        return this.serviceRequestRepository.delete(id);
    }
    async getPendingAndUrgentRequests(queryParams, owner_id) {
        const page = queryParams?.page
            ? Number(queryParams?.page)
            : config_1.config.DEFAULT_PAGE_NO;
        const size = queryParams?.size
            ? Number(queryParams.size)
            : config_1.config.DEFAULT_PER_PAGE;
        const skip = (page - 1) * size;
        const query = await (0, query_filter_1.buildServiceRequestFilter)(queryParams);
        const [serviceRequests, count] = await this.serviceRequestRepository.findAndCount({
            where: {
                ...query,
                property: { owner_id },
                status: (0, typeorm_2.In)(['pending', 'urgent']),
            },
            relations: ['tenant', 'property'],
            skip,
            take: size,
            order: { created_at: 'DESC' },
        });
        const totalPages = Math.ceil(count / size);
        return {
            service_requests: serviceRequests,
            pagination: {
                totalRows: count,
                perPage: size,
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
            },
        };
    }
    async getServiceRequestsByTenant(tenant_id, queryParams) {
        const page = queryParams?.page
            ? Number(queryParams?.page)
            : config_1.config.DEFAULT_PAGE_NO;
        const size = queryParams?.size
            ? Number(queryParams.size)
            : config_1.config.DEFAULT_PER_PAGE;
        const skip = (page - 1) * size;
        const [serviceRequests, count] = await this.serviceRequestRepository.findAndCount({
            where: {
                tenant_id,
            },
            relations: ['tenant', 'property'],
            skip,
            take: size,
            order: { created_at: 'DESC' },
        });
        const totalPages = Math.ceil(count / size);
        return {
            service_requests: serviceRequests,
            pagination: {
                totalRows: count,
                perPage: size,
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
            },
        };
    }
    async getRequestById(id) {
        const request = await this.serviceRequestRepository.findOne({
            where: { id },
            relations: ['messages'],
        });
        if (!request) {
            throw new common_1.NotFoundException('Service request not found');
        }
        return request;
    }
};
exports.ServiceRequestsService = ServiceRequestsService;
exports.ServiceRequestsService = ServiceRequestsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(service_request_entity_1.ServiceRequest)),
    __param(1, (0, typeorm_1.InjectRepository)(property_tenants_entity_1.PropertyTenant)),
    __param(3, (0, typeorm_1.InjectRepository)(auto_service_request_entity_1.AutoServiceRequest)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        event_emitter_1.EventEmitter2,
        typeorm_2.Repository])
], ServiceRequestsService);
//# sourceMappingURL=service-requests.service.js.map
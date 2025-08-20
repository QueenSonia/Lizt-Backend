import { CreateServiceRequestDto, ServiceRequestFilter } from './dto/create-service-request.dto';
import { UpdateServiceRequestResponseDto } from './dto/update-service-request.dto';
import { ServiceRequest } from './entities/service-request.entity';
import { Repository } from 'typeorm';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AutoServiceRequest } from './entities/auto-service-request.entity';
export interface TawkWebhookPayload {
    event: 'chat:start' | 'chat:end';
    chatId: string;
    time: string;
    message?: {
        text: string;
        type: string;
        sender: {
            type: 'visitor' | 'agent';
        };
    };
    visitor: {
        name: string;
        email: string;
        city: string;
        country: string;
    };
    property: {
        id: string;
        name: string;
    };
}
export declare class ServiceRequestsService {
    private readonly serviceRequestRepository;
    private readonly propertyTenantRepository;
    private readonly eventEmitter;
    private readonly autoServiceRequestRepository;
    constructor(serviceRequestRepository: Repository<ServiceRequest>, propertyTenantRepository: Repository<PropertyTenant>, eventEmitter: EventEmitter2, autoServiceRequestRepository: Repository<AutoServiceRequest>);
    tawkServiceRequest(payload: TawkWebhookPayload): Promise<AutoServiceRequest>;
    private generateTitle;
    private generateDescription;
    createServiceRequest(data: CreateServiceRequestDto): Promise<CreateServiceRequestDto>;
    getAllServiceRequests(user_id: string, queryParams: ServiceRequestFilter): Promise<{
        service_requests: ServiceRequest[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getServiceRequestById(id: string): Promise<CreateServiceRequestDto>;
    getServiceRequestByTenant(id: string, status?: string): Promise<ServiceRequest[]>;
    updateServiceRequestById(id: string, data: UpdateServiceRequestResponseDto): Promise<import("typeorm").UpdateResult>;
    deleteServiceRequestById(id: string): Promise<import("typeorm").DeleteResult>;
    getPendingAndUrgentRequests(queryParams: ServiceRequestFilter, owner_id: string): Promise<{
        service_requests: ServiceRequest[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getServiceRequestsByTenant(tenant_id: string, queryParams: ServiceRequestFilter): Promise<{
        service_requests: ServiceRequest[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getRequestById(id: string): Promise<ServiceRequest>;
}

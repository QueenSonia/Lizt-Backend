import { RawBodyRequest } from '@nestjs/common';
import { ServiceRequestsService, TawkWebhookPayload } from './service-requests.service';
import { CreateServiceRequestDto, ServiceRequestFilter } from './dto/create-service-request.dto';
import { UpdateServiceRequestResponseDto } from './dto/update-service-request.dto';
import { FileUploadService } from 'src/utils/cloudinary';
export declare class ServiceRequestsController {
    private readonly serviceRequestsService;
    private readonly fileUploadService;
    constructor(serviceRequestsService: ServiceRequestsService, fileUploadService: FileUploadService);
    createServiceRequest(body: CreateServiceRequestDto): Promise<CreateServiceRequestDto>;
    getAllServiceRequests(query: ServiceRequestFilter, req: any): Promise<{
        service_requests: import("./entities/service-request.entity").ServiceRequest[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getPendingAndUrgentRequests(query: ServiceRequestFilter, req: any): Promise<{
        service_requests: import("./entities/service-request.entity").ServiceRequest[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getServiceRequestByTenant(req: any): Promise<import("./entities/service-request.entity").ServiceRequest[]>;
    getServiceRequestById(id: string): Promise<CreateServiceRequestDto>;
    updateServiceRequestById(id: string, body: UpdateServiceRequestResponseDto, files?: Array<Express.Multer.File>): Promise<import("typeorm").UpdateResult>;
    deleteServiceRequestById(id: string): Promise<import("typeorm").DeleteResult>;
    handleTawkWebhook(payload: TawkWebhookPayload, headers: Record<string, string>, req: RawBodyRequest<Request>): Promise<{
        success: boolean;
        serviceRequestId: string;
        message: string;
        timestamp: string;
    } | {
        success: boolean;
        message: string;
        timestamp: string;
        serviceRequestId?: undefined;
    }>;
    private validateTawkSignature;
    private isSupportedEvent;
    healthCheck(): Promise<{
        status: string;
        service: string;
        timestamp: string;
    }>;
}

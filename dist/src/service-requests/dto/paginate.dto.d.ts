import { ServiceRequest } from '../entities/service-request.entity';
export declare class PaginationMetadataDto {
    totalRows: number;
    perPage: number;
    currentPage: number;
    totalPages: number;
    hasNextPage: boolean;
}
export declare class PaginationResponseDto {
    service_requests: ServiceRequest[];
    pagination: PaginationMetadataDto;
}

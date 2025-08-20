import { PropertyHistory } from '../entities/property-history.entity';
export declare class PaginationMetadataDto {
    totalRows: number;
    perPage: number;
    currentPage: number;
    totalPages: number;
    hasNextPage: boolean;
}
export declare class PaginationResponseDto {
    property_histories: PropertyHistory[];
    pagination: PaginationMetadataDto;
}

import { CreatePropertyDto } from './create-property.dto';
export declare class PaginationMetadataDto {
    totalRows: number;
    perPage: number;
    currentPage: number;
    totalPages: number;
    hasNextPage: boolean;
}
export declare class PaginationResponseDto {
    users: CreatePropertyDto[];
    pagination: PaginationMetadataDto;
}

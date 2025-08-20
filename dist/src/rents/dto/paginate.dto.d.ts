import { Rent } from '../entities/rent.entity';
declare class PaginationDto {
    totalRows: number;
    perPage: number;
    currentPage: number;
    totalPages: number;
    hasNextPage: boolean;
}
export declare class PaginationResponseDto {
    rents: Rent[];
    pagination: PaginationDto;
}
export {};

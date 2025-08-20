import { CreateUserDto } from './create-user.dto';
export declare class PaginationMetadataDto {
    totalRows: number;
    perPage: number;
    currentPage: number;
    totalPages: number;
    hasNextPage: boolean;
}
export declare class PaginationResponseDto {
    users: CreateUserDto[];
    pagination: PaginationMetadataDto;
}

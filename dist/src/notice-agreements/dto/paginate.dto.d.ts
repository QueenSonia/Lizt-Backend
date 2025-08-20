import { CreateNoticeAgreementDto } from './create-notice-agreement.dto';
export declare class PaginationMetadataDto {
    totalRows: number;
    perPage: number;
    currentPage: number;
    totalPages: number;
    hasNextPage: boolean;
}
export declare class PaginationResponseDto {
    notice_agreements: CreateNoticeAgreementDto[];
    pagination: PaginationMetadataDto;
}

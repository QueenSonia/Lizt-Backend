import { PaginationQueryDto } from 'src/lib/utils/re-usables/utils.dto';
export declare class ParseTenantKycQueryDto extends PaginationQueryDto {
    fields?: string;
}
export declare class BulkDeleteTenantKycDto {
    ids: string[];
}

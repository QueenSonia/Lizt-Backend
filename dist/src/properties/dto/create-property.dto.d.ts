export declare enum PropertyStatusEnum {
    VACANT = "vacant",
    NOT_VACANT = "occupied"
}
export declare class CreatePropertyDto {
    name: string;
    location: string;
    description: string;
    property_type: string;
    no_of_bedrooms: number;
}
export declare enum TenantStatusEnum {
    ACTIVE = "active",
    INACTIVE = "inactive"
}
export interface PropertyFilter {
    search?: string;
    name?: string;
    location?: string;
    property_status?: PropertyStatusEnum;
    owner_id?: string;
    start_date?: string;
    end_date?: string;
    sort_by?: string;
    sort_order?: string;
    size?: number;
    page?: number;
    order?: 'asc' | 'desc';
}

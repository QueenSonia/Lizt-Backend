export declare class MoveTenantInDto {
    property_id: string;
    tenant_id: string;
    move_in_date: string;
}
export declare class MoveTenantOutDto {
    property_id: string;
    tenant_id: string;
    move_out_date: string;
    move_out_reason?: string;
    owner_comment?: string;
    tenant_comment?: string;
}

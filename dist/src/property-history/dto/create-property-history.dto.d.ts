export declare class CreatePropertyHistoryDto {
    property_id: string;
    tenant_id: string;
    move_in_date: Date | string;
    move_out_date?: Date | string | null;
    move_out_reason?: string | null;
    owner_comment?: string | null;
    tenant_comment?: string | null;
    monthly_rent: number;
}
export interface PropertyHistoryFilter {
    tenant_id?: string;
    property_id?: string;
    status?: string;
    move_in_date?: string;
    move_out_date?: string;
    start_date?: string;
    end_date?: string;
    size?: number;
    page?: number;
}

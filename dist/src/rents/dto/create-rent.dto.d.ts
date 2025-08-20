export declare enum RentPaymentStatusEnum {
    PENDING = "pending",
    PAID = "paid",
    OWING = "owing"
}
export declare enum RentStatusEnum {
    ACTIVE = "active",
    INACTIVE = "inactive"
}
export declare class CreateRentDto {
    property_id: string;
    tenant_id: string;
    amount_paid: number;
    expiry_date: Date;
    status: string;
    lease_start_date: Date;
    lease_end_date: Date;
}
export declare class RentFilter {
    page?: number;
    size?: number;
    tenant_id?: string;
    owner_id?: string;
    property_id?: string;
    status?: string;
    start_date?: string;
    end_date?: string;
    property?: {
        owner_id?: string;
    };
}

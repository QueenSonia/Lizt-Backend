export declare enum ServiceRequestStatusEnum {
    PENDING = "pending",
    IN_PROGRESS = "in_progress",
    RESOLVED = "resolved",
    URGENT = "urgent"
}
export declare class CreateServiceRequestDto {
    tenant_name: string;
    property_name: string;
    issue_category: string;
    date_reported: Date;
    description: string;
    issue_images?: string[] | null;
    status?: string | null;
    tenant_id: string;
    property_id: string;
}
export declare class ServiceRequestFilter {
    tenant_id?: string;
    property_id?: string;
    status?: string;
    start_date?: string;
    end_date?: string;
    page?: number;
    size?: number;
}

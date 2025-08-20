import { CreateServiceRequestDto, ServiceRequestStatusEnum } from './create-service-request.dto';
declare const UpdateServiceRequestDto_base: import("@nestjs/common").Type<Partial<CreateServiceRequestDto>>;
export declare class UpdateServiceRequestDto extends UpdateServiceRequestDto_base {
}
export declare class UpdateServiceRequestResponseDto {
    tenant_name?: string;
    property_name: string;
    status?: ServiceRequestStatusEnum;
    issue_category?: string;
    date_reported?: Date;
    resolution_date?: Date;
    description?: string;
    issue_images?: string[];
    tenant_id?: string;
    property_id?: string;
}
export {};

import { CreateRentDto } from './create-rent.dto';
declare const UpdateRentDto_base: import("@nestjs/common").Type<Partial<CreateRentDto>>;
export declare class UpdateRentDto extends UpdateRentDto_base {
}
export declare class UpdateRentResponseDto {
    property_id: string;
    tenant_id: string;
    amount_paid: number;
    expiry_date: Date;
    status: string;
}
export {};

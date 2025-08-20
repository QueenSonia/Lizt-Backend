import { CreatePropertyHistoryDto } from './create-property-history.dto';
import { MoveOutReasonEnum } from '../entities/property-history.entity';
declare const UpdatePropertyHistoryDto_base: import("@nestjs/common").Type<Partial<CreatePropertyHistoryDto>>;
export declare class UpdatePropertyHistoryDto extends UpdatePropertyHistoryDto_base {
}
export declare class UpdatePropertyHistoryResponseDto {
    property_id: string;
    tenant_id: string;
    move_in_date: Date | string;
    move_out_date?: Date | string | null;
    move_out_reason?: MoveOutReasonEnum | null;
    owner_comment?: string | null;
    tenant_comment?: string | null;
    monthly_rent: number;
}
export {};

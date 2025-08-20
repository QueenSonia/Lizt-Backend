import { BaseEntity } from '../../base.entity';
import { Property } from '../../properties/entities/property.entity';
import { Account } from 'src/users/entities/account.entity';
export declare enum MoveOutReasonEnum {
    LEASE_ENDED = "lease_ended",
    EVICTION = "eviction",
    EARLY_TERMINATION = "early_termination",
    MUTUAL_AGREEMENT = "mutual_agreement",
    OTHER = "other"
}
export declare class PropertyHistory extends BaseEntity {
    property_id: string;
    tenant_id: string;
    move_in_date: Date;
    move_out_date?: Date | null;
    move_out_reason?: string | null;
    owner_comment?: string | null;
    tenant_comment?: string | null;
    monthly_rent: number;
    property: Property;
    tenant: Account;
}

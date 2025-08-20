import { BaseEntity } from '../../base.entity';
import { Property } from '../../properties/entities/property.entity';
export declare class RentIncrease extends BaseEntity {
    property_id: string;
    initial_rent: number;
    current_rent: number;
    rent_increase_date: Date;
    reason?: string | null;
    property: Property;
}

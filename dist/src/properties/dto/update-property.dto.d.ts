import { PropertyStatusEnum } from './create-property.dto';
import { RentStatusEnum } from 'src/rents/dto/create-rent.dto';
export declare class UpdatePropertyDto {
    id?: string;
    name?: string;
    description?: string;
    location?: string;
    rent_status?: RentStatusEnum;
    property_type?: string;
    rental_price?: number;
    service_charge?: number;
    security_deposit?: number;
    tenant_name?: string;
    phone_number?: string;
    occupancy_status?: PropertyStatusEnum;
    no_of_bedrooms?: number;
    lease_start_date?: string;
    lease_end_date?: string;
    lease_duration?: string;
    first_name?: string;
    last_name?: string;
}
export declare class UpdatePropertyResponseDto {
    name: string;
    location: string;
    property_status: PropertyStatusEnum;
    owner_id: string;
    property_type: string;
    property_images: string[];
    no_of_bedrooms: number;
    rental_price: number;
    payment_frequency: string;
    security_deposit: number;
    service_charge: number;
    comment?: string | null;
}

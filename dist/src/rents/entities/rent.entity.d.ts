import { BaseEntity } from '../../base.entity';
import { Property } from '../../properties/entities/property.entity';
import { Account } from 'src/users/entities/account.entity';
export declare class Rent extends BaseEntity {
    property_id: string;
    tenant_id: string;
    amount_paid: number;
    expiry_date: Date;
    lease_start_date: Date;
    lease_end_date: Date;
    rent_receipts?: string[] | null;
    rental_price: number;
    security_deposit: number;
    service_charge: number;
    payment_status: string;
    rent_status: string;
    property: Property;
    tenant: Account;
}

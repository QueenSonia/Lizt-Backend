import { BaseEntity } from '../../base.entity';
import { Property } from './property.entity';
import { TenantStatusEnum } from '../dto/create-property.dto';
import { Account } from 'src/users/entities/account.entity';
export declare class PropertyTenant extends BaseEntity {
    property_id: string;
    tenant_id: string;
    status: TenantStatusEnum;
    property: Property;
    tenant: Account;
}

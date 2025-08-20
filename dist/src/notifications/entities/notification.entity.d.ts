import { NotificationType } from '../enums/notification-type';
import { Account } from 'src/users/entities/account.entity';
import { Property } from 'src/properties/entities/property.entity';
import { BaseEntity } from 'src/base.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
export declare class Notification extends BaseEntity {
    date: string;
    type: NotificationType;
    description: string;
    status: 'Pending' | 'Completed';
    property_id: string;
    user_id: string;
    service_request_id: string;
    property: Property;
    user: Account;
    serviceRequest: ServiceRequest;
}

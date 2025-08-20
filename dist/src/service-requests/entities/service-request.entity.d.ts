import { BaseEntity } from '../../base.entity';
import { Property } from '../../properties/entities/property.entity';
import { Account } from 'src/users/entities/account.entity';
import { ChatMessage } from 'src/chat/chat-message.entity';
import { Notification } from 'src/notifications/entities/notification.entity';
export declare class ServiceRequest extends BaseEntity {
    request_id: string;
    tenant_name: string;
    property_name: string;
    issue_category: string;
    date_reported: Date;
    resolution_date?: Date | null;
    description: string;
    issue_images?: string[] | null;
    resolvedAt: Date;
    notes: string;
    status: string | null;
    tenant_id: string;
    property_id: string;
    tenant: Account;
    property: Property;
    messages: ChatMessage[];
    notification: Notification;
}

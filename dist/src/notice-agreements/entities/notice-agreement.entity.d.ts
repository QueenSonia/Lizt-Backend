import { BaseEntity } from 'src/base.entity';
import { Property } from 'src/properties/entities/property.entity';
import { Account } from 'src/users/entities/account.entity';
export declare enum NoticeStatus {
    ACKNOWLEDGED = "acknowledged",
    NOT_ACKNOWLEDGED = "not_acknowledged",
    PENDING = "pending"
}
export declare enum SendVia {
    EMAIL = "email",
    WHATSAPP = "whatsapp"
}
export declare enum NoticeType {
    UPLOAD = "uploaded_document",
    RENT_INCREASE = "rent_increase",
    LEASE_RENEWAL = "lease_renewal",
    EVICTION = "eviction",
    WARNING = "warning"
}
export declare class NoticeAgreement extends BaseEntity {
    notice_id: string;
    notice_type: NoticeType;
    tenant_name: string;
    property_name: string;
    effective_date: Date;
    notice_image?: string | null;
    notice_documents: {
        url: string;
        name?: string;
        type?: string;
    }[];
    status: NoticeStatus;
    send_via: SendVia[];
    additional_notes?: string | null;
    property_id: string;
    tenant_id: string;
    property: Property;
    tenant: Account;
}

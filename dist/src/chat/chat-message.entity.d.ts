import { BaseEntity } from 'src/base.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
export declare enum MessageSender {
    TENANT = "tenant",
    REP = "rep",
    SYSTEM = "system",
    ADMIN = "admin"
}
export declare enum MessageType {
    TEXT = "text",
    FILE = "file",
    IMAGE = "image",
    SYSTEM = "system"
}
export declare class ChatMessage extends BaseEntity {
    service_request_id: string;
    sender: MessageSender;
    type: MessageType;
    content: string;
    fileName: string;
    fileUrl: string;
    isRead: boolean;
    senderName: string;
    serviceRequest: ServiceRequest;
}

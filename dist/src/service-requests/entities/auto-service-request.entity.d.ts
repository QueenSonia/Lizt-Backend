import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
export declare enum ServiceRequestStatus {
    OPEN = "open",
    IN_PROGRESS = "in_progress",
    PENDING = "pending",
    RESOLVED = "resolved",
    CLOSED = "closed",
    CANCELLED = "cancelled"
}
export declare enum ServiceRequestPriority {
    LOW = "low",
    MEDIUM = "medium",
    HIGH = "high",
    URGENT = "urgent"
}
export declare enum ServiceRequestSource {
    TAWK_CHAT = "tawk_chat",
    EMAIL = "email",
    PHONE = "phone",
    PORTAL = "portal",
    MANUAL = "manual"
}
export interface TawkMetadata {
    tawkChatId: string;
    tawkEvent: 'chat:start' | 'chat:end';
    tawkPropertyName: string;
    initialMessage?: string;
    chatDuration?: number;
    agentAssigned?: string;
    visitorInfo: {
        city: string;
        country: string;
        userAgent?: string;
        ipAddress?: string;
    };
    chatHistory?: Array<{
        timestamp: string;
        sender: 'visitor' | 'agent';
        message: string;
    }>;
}
export declare class AutoServiceRequest {
    id: string;
    title: string;
    description: string;
    status: ServiceRequestStatus;
    priority: ServiceRequestPriority;
    source: ServiceRequestSource;
    externalId: string;
    customerName: string;
    customerEmail: string;
    customerPhone?: string;
    customerLocation?: string;
    assignedTo?: string;
    assignedAt?: Date;
    resolvedAt?: Date;
    resolutionNotes?: string;
    metadata?: TawkMetadata | Record<string, any>;
    internalNotes?: string;
    tags?: string[];
    dueDate?: Date;
    propertyTenant: PropertyTenant;
    createdAt: Date;
    updatedAt: Date;
    get isOverdue(): boolean | undefined;
    get ageInDays(): number;
    markAsResolved(resolutionNotes?: string): void;
    assignTo(assignee: string): void;
    addTag(tag: string): void;
    removeTag(tag: string): void;
    updateTawkMetadata(updates: Partial<TawkMetadata>): void;
}

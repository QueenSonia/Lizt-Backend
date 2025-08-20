export interface ServiceRequestCreatedEvent {
    service_request_id: string;
    user_id: string;
    date: string;
    property_id: string;
    property_name: string;
    tenant_name: string;
}

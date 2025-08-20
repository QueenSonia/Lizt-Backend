import { NotificationService } from '../notification.service';
import { ServiceRequestCreatedEvent } from '../events/service-request.event';
export declare class ServiceRequestListener {
    private notificationService;
    constructor(notificationService: NotificationService);
    handle(event: ServiceRequestCreatedEvent): void;
}

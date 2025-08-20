import { NotificationService } from '../notification.service';
import { PropertyCreatedEvent } from '../events/property-created.event';
export declare class PropertyListener {
    private readonly notificationService;
    constructor(notificationService: NotificationService);
    handlePropertyCreated(event: PropertyCreatedEvent): Promise<void>;
}

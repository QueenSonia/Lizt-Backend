import { NotificationService } from '../notification.service';
import { UserAddedToPropertyEvent } from '../events/user-added.event';
export declare class UserAddedListener {
    private notificationService;
    constructor(notificationService: NotificationService);
    handle(event: UserAddedToPropertyEvent): void;
}

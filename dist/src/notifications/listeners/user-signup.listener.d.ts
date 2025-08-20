import { NotificationService } from '../notification.service';
import { UserSignUpEvent } from '../events/user-signup.event';
export declare class UserSignUpListener {
    private notificationService;
    constructor(notificationService: NotificationService);
    handle(event: UserSignUpEvent): void;
}

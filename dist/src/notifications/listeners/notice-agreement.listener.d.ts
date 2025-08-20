import { NotificationService } from '../notification.service';
import { NoticeAgreementCreatedEvent } from '../events/notice-created.event';
export declare class NoticeAgreementListener {
    private notificationService;
    constructor(notificationService: NotificationService);
    handle(event: NoticeAgreementCreatedEvent): void;
}

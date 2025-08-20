import { NotificationService } from './notification.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { Notification } from './entities/notification.entity';
export declare class NotificationController {
    private readonly service;
    constructor(service: NotificationService);
    findByUserId(req: any): Promise<Notification[]>;
    create(dto: CreateNotificationDto): Promise<Notification>;
    findAll(): Promise<Notification[]>;
    findOne(id: string): Promise<Notification | null>;
    findByPropertyId(property_id: string): Promise<Notification[]>;
}

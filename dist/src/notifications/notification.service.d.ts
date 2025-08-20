import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';
export declare class NotificationService {
    private readonly notificationRepository;
    constructor(notificationRepository: Repository<Notification>);
    create(dto: CreateNotificationDto): Promise<Notification>;
    findAll(): Promise<Notification[]>;
    findOne(id: string): Promise<Notification | null>;
    findByPropertyId(property_id: string): Promise<Notification[]>;
    findByUserId(user_id: string): Promise<Notification[]>;
}

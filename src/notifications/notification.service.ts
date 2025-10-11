import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
  ) {}

  async create(dto: CreateNotificationDto): Promise<Notification> {
    const notification = this.notificationRepository.create(dto);
    return await this.notificationRepository.save(notification);
  }

  async findAll(): Promise<Notification[]> {
    return await this.notificationRepository.find();
  }

  async findOne(id: string): Promise<Notification | null> {
    return await this.notificationRepository.findOneBy({ id });
  }

  async findByPropertyId(property_id: string): Promise<Notification[]> {
    return await this.notificationRepository.find({
      where: {
        property_id,
      },
      relations: ['property'],
    });
  }

  // Looks up all notifications connected to properties owned by a specific user.
  // Loads related data (property, tenants, serviceRequest) in one query.
  // Sorts them by date (newest first).
  // Returns the full list as a Promise.
  async findByUserId(user_id: string): Promise<Notification[]> {
    console.log('Finding notifications for user_id:', user_id);

    const notifications = await this.notificationRepository.find({
      where: {
        property: {
          owner_id: user_id,
        },
      },
      relations: [
        'property',
        'property.property_tenants',
        'property.property_tenants.tenant',
        'serviceRequest',
      ],
      order: {
        date: 'DESC',
      },
    });
    return notifications;
  }
}

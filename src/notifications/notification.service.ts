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

  create = async (dto: CreateNotificationDto): Promise<Notification> => {
    const notification = this.notificationRepository.create(dto);
    return await this.notificationRepository.save(notification);
  };

  findAll = async (): Promise<Notification[]> => {
    return await this.notificationRepository.find();
  };

  findOne = async (id: string): Promise<Notification | null> => {
    return await this.notificationRepository.findOneBy({ id });
  };

  findByPropertyId = async (property_id: string): Promise<Notification[]> => {
    return await this.notificationRepository.find({
      where: {
        property_id,
      },
      relations: ['property'],
    });
  };

  findByUserId = async (user_id: string): Promise<Notification[]> => {
    return await this.notificationRepository.find({
      where: {
        property: {
          owner_id: user_id,
        },
      },
      relations: ['property', 'serviceRequest'],
      order: {
        date: 'DESC',
      },
    });
  };
}

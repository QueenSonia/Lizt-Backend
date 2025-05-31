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
      property_id
    },
    relations: ['property']
  });
  }

  async findByUserId(user_id: string): Promise<Notification[]> {
    console.log({user:user_id})
    return await this.notificationRepository.find({ where: { user_id },  relations: ['property'] });
  }
}

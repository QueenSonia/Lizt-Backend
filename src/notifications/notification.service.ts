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
  async findByUserId(
    user_id: string,
    options: { page: number; limit: number },
  ): Promise<{ notifications: Notification[]; total: number }> {
    console.log(
      `Finding notifications for user_id: ${user_id} with page: ${options.page}, limit: ${options.limit}`,
    );

    const { page = 1, limit = 20 } = options;
    const skip = (page - 1) * limit;

    const query = this.notificationRepository
      .createQueryBuilder('notification')
      .leftJoinAndSelect('notification.property', 'property')
      .leftJoinAndSelect('property.property_tenants', 'property_tenants')
      .leftJoinAndSelect('property_tenants.tenant', 'tenant')
      .leftJoinAndSelect('notification.serviceRequest', 'serviceRequest')
      .where('notification.user_id = :user_id', { user_id })
      .orderBy('notification.date', 'DESC')
      .skip(skip)
      .take(limit);

    const [notifications, total] = await query.getManyAndCount();

    return { notifications, total };
  }

  async findByServiceRequestId(
    service_request_id: string,
  ): Promise<Notification | null> {
    return await this.notificationRepository.findOne({
      where: { service_request_id },
    });
  }

  async update(
    id: string,
    updateData: Partial<Notification>,
  ): Promise<Notification> {
    await this.notificationRepository.update(id, updateData);
    const updated = await this.findOne(id);
    if (!updated) {
      throw new Error(`Notification with id ${id} not found`);
    }
    return updated;
  }
}

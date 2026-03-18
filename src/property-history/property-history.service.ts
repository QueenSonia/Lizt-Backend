import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CreatePropertyHistoryDto,
  PropertyHistoryFilter,
} from './dto/create-property-history.dto';
import { UpdatePropertyHistoryDto } from './dto/update-property-history.dto';
import { PropertyHistory } from './entities/property-history.entity';
import { Property } from '../properties/entities/property.entity';
import { config } from 'src/config';
import { buildPropertyHistoryFilter } from 'src/filters/query-filter';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/enums/notification-type';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class PropertyHistoryService {
  private readonly logger = new Logger(PropertyHistoryService.name);

  constructor(
    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepository: Repository<PropertyHistory>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    private readonly notificationService: NotificationService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async createPropertyHistory(
    data: CreatePropertyHistoryDto,
  ): Promise<PropertyHistory> {
    const saved = await this.propertyHistoryRepository.save(data);

    // Create notification + WebSocket event for user-added history entries
    if (data.event_type === 'user_added_history') {
      try {
        const property = await this.propertyRepository.findOne({
          where: { id: data.property_id },
        });

        let parsedData: any = {};
        try {
          parsedData = JSON.parse(data.event_description || '{}');
        } catch {
          parsedData = {};
        }

        const displayType = parsedData.displayType || 'Custom Event';
        const description = parsedData.description || '';
        const tenantName = parsedData.tenantName || '';
        const propertyName = property?.name || parsedData.propertyName || '';
        const landlordId = property?.owner_id;

        if (landlordId) {
          // Create notification for livefeed
          await this.notificationService.create({
            date: new Date().toISOString(),
            type: NotificationType.USER_ADDED_HISTORY,
            description: `${displayType} — ${tenantName} — ${description}`,
            status: 'Completed',
            property_id: data.property_id,
            user_id: landlordId,
          });

          // Emit WebSocket event for real-time update
          this.eventsGateway.emitHistoryAdded(landlordId, {
            propertyId: data.property_id,
            propertyName,
            tenantName,
            displayType,
            description,
          });
        }
      } catch (error) {
        this.logger.error('Failed to create notification for user_added_history', error);
      }
    }

    return saved;
  }

  async getAllPropertyHistories(queryParams: PropertyHistoryFilter) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const query = await buildPropertyHistoryFilter(queryParams);
    const [propertyHistories, count] =
      await this.propertyHistoryRepository.findAndCount({
        where: query,
        relations: ['property', 'tenant'],
        skip,
        take: size,
        order: { created_at: 'DESC' },
      });

    const totalPages = Math.ceil(count / size);
    return {
      property_histories: propertyHistories,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  async getPropertyHistoryById(id: string): Promise<PropertyHistory> {
    const propertyHistory = await this.propertyHistoryRepository.findOne({
      where: { id },
      relations: ['property', 'tenant'],
    });

    if (!propertyHistory?.id) {
      throw new HttpException(
        `Property history with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    return propertyHistory;
  }

  async updatePropertyHistoryById(id: string, data: UpdatePropertyHistoryDto) {
    await this.getPropertyHistoryById(id);
    return this.propertyHistoryRepository.update(id, data);
  }

  async deletePropertyHistoryById(id: string) {
    await this.getPropertyHistoryById(id);
    return this.propertyHistoryRepository.delete(id);
  }

  async getPropertyHistoryByTenantId(
    tenant_id: string,
    property_id: string,
    queryParams: PropertyHistoryFilter,
  ) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size ? Number(queryParams.size) : 10;
    const skip = (page - 1) * size;
    const [propertyHistories, count] =
      await this.propertyHistoryRepository.findAndCount({
        where: {
          tenant_id,
          property_id,
        },
        skip,
        take: size,
        order: { created_at: 'DESC' },
      });
    const totalPages = Math.ceil(count / size);
    return {
      property_histories: propertyHistories,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }
}

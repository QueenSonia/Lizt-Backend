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
import { Rent } from '../rents/entities/rent.entity';
import {
  RentPaymentStatusEnum,
  RentStatusEnum,
} from '../rents/dto/create-rent.dto';
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
    @InjectRepository(Rent)
    private readonly rentRepository: Repository<Rent>,
    private readonly notificationService: NotificationService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async createPropertyHistory(
    data: CreatePropertyHistoryDto,
  ): Promise<PropertyHistory> {
    // Handle tenancy history entries: clash detection + outstanding balance update
    if (data.event_type === 'user_added_tenancy') {
      return this.handleTenancyHistoryEntry(data);
    }

    // Handle payment history entries: outstanding balance reduction
    if (data.event_type === 'user_added_payment') {
      return this.handlePaymentHistoryEntry(data);
    }

    const saved = await this.propertyHistoryRepository.save(data);

    // Create notification + WebSocket event for user-added history entries
    if (data.event_type === 'user_added_history') {
      await this.createHistoryNotification(data, saved);
    }

    return saved;
  }

  private async handleTenancyHistoryEntry(
    data: CreatePropertyHistoryDto,
  ): Promise<PropertyHistory> {
    const startDate = new Date(data.move_in_date!);
    const endDate = new Date(data.move_out_date!);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new HttpException('Invalid tenancy dates', HttpStatus.BAD_REQUEST);
    }

    if (startDate >= endDate) {
      throw new HttpException(
        'Tenancy start date must be before end date',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Check for clashes with existing rent records on this property
    const clashingRents = await this.rentRepository
      .createQueryBuilder('rent')
      .where('rent.property_id = :propertyId', { propertyId: data.property_id })
      .andWhere('rent.rent_start_date < :endDate', {
        endDate: endDate.toISOString(),
      })
      .andWhere('rent.expiry_date > :startDate', {
        startDate: startDate.toISOString(),
      })
      .getMany();

    if (clashingRents.length > 0) {
      throw new HttpException(
        'This tenancy period overlaps with an existing tenancy record for this property',
        HttpStatus.CONFLICT,
      );
    }

    // Save the history entry
    const saved = await this.propertyHistoryRepository.save(data);

    // Create a Rent record for this historical tenancy
    const parsedData = JSON.parse(data.event_description || '{}');
    const totalAmount = parsedData.totalAmount || 0;
    const rentAmount = parsedData.rentAmount || 0;
    const serviceChargeAmount = parsedData.serviceChargeAmount || 0;

    const rent = this.rentRepository.create({
      property_id: data.property_id,
      tenant_id: data.tenant_id!,
      rent_start_date: startDate,
      expiry_date: endDate,
      rental_price: rentAmount,
      service_charge: serviceChargeAmount,
      amount_paid: 0,
      outstanding_balance: totalAmount,
      outstanding_balance_reason:
        totalAmount > 0 ? 'Historical tenancy recorded' : null,
      payment_status:
        totalAmount > 0
          ? RentPaymentStatusEnum.OWING
          : RentPaymentStatusEnum.PAID,
      rent_status: RentStatusEnum.INACTIVE,
    });
    await this.rentRepository.save(rent);

    // Create notification for livefeed
    await this.createHistoryNotification(data, saved);

    return saved;
  }

  private async handlePaymentHistoryEntry(
    data: CreatePropertyHistoryDto,
  ): Promise<PropertyHistory> {
    const parsedData = JSON.parse(data.event_description || '{}');
    const paymentAmount = parsedData.paymentAmount || 0;

    if (paymentAmount <= 0) {
      throw new HttpException(
        'Payment amount must be greater than 0',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!data.tenant_id) {
      throw new HttpException(
        'Tenant ID is required for payment entries',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Save the history entry
    const saved = await this.propertyHistoryRepository.save(data);

    // Find ALL rents for this tenant with outstanding balance, oldest first
    const rentsWithBalance = await this.rentRepository
      .createQueryBuilder('rent')
      .where('rent.tenant_id = :tenantId', { tenantId: data.tenant_id })
      .andWhere('rent.outstanding_balance > 0')
      .orderBy('rent.rent_start_date', 'ASC')
      .getMany();

    // Subtract payment across rents, overflowing to the next
    let remaining = paymentAmount;
    for (const rent of rentsWithBalance) {
      if (remaining <= 0) break;

      const owed = rent.outstanding_balance || 0;
      const deduction = Math.min(owed, remaining);

      rent.outstanding_balance = owed - deduction;
      rent.amount_paid = (rent.amount_paid || 0) + deduction;
      remaining -= deduction;

      if (rent.outstanding_balance === 0) {
        rent.payment_status = RentPaymentStatusEnum.PAID;
        rent.outstanding_balance_reason = null;
      }

      await this.rentRepository.save(rent);
    }

    // If there's still remaining payment (overpayment), store as credit on the active rent
    if (remaining > 0) {
      const activeRent = await this.rentRepository.findOne({
        where: {
          tenant_id: data.tenant_id,
          rent_status: RentStatusEnum.ACTIVE,
        },
      });

      if (activeRent) {
        activeRent.credit_balance = (activeRent.credit_balance || 0) + remaining;
        await this.rentRepository.save(activeRent);
        this.logger.log(
          `Overpayment of ₦${remaining} stored as credit for tenant ${data.tenant_id}`,
        );
      } else {
        this.logger.warn(
          `Overpayment of ₦${remaining} for tenant ${data.tenant_id} but no active rent found to store credit`,
        );
      }
    }

    // Create notification for livefeed
    await this.createHistoryNotification(data, saved);

    return saved;
  }

  private async createHistoryNotification(
    data: CreatePropertyHistoryDto,
    saved: PropertyHistory,
  ): Promise<void> {
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

      const displayType =
        data.event_type === 'user_added_tenancy'
          ? 'Historical Tenancy Recorded'
          : data.event_type === 'user_added_payment'
            ? 'Historical Payment Recorded'
            : parsedData.displayType || 'Custom Event';
      const tenantName = parsedData.tenantName || '';
      const propertyName = property?.name || parsedData.propertyName || '';
      const landlordId = property?.owner_id;

      const amount =
        parsedData.totalAmount ||
        parsedData.paymentAmount ||
        parsedData.amount ||
        null;
      const description = amount
        ? `₦${Number(amount).toLocaleString()}`
        : parsedData.description || '';

      if (landlordId) {
        await this.notificationService.create({
          date: new Date().toISOString(),
          type: NotificationType.USER_ADDED_HISTORY,
          description: `${displayType} — ${tenantName} — ${description}`,
          status: 'Completed',
          property_id: data.property_id,
          user_id: landlordId,
        });

        this.eventsGateway.emitHistoryAdded(landlordId, {
          propertyId: data.property_id,
          propertyName,
          tenantName,
          displayType,
          description,
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to create notification for ${data.event_type}`,
        error,
      );
    }
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

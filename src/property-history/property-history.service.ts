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
import { TenantBalancesService } from 'src/tenant-balances/tenant-balances.service';
import {
  TenantBalanceLedger,
  TenantBalanceLedgerType,
} from 'src/tenant-balances/entities/tenant-balance-ledger.entity';

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
    @InjectRepository(TenantBalanceLedger)
    private readonly ledgerRepository: Repository<TenantBalanceLedger>,
    private readonly notificationService: NotificationService,
    private readonly eventsGateway: EventsGateway,
    private readonly tenantBalancesService: TenantBalancesService,
  ) {}

  async createPropertyHistory(
    data: CreatePropertyHistoryDto,
  ): Promise<PropertyHistory> {
    // Validate required fields
    if (!data.property_id || data.property_id.trim() === '') {
      throw new HttpException(
        'Property ID is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Handle tenancy history entries: clash detection + outstanding balance update
    if (data.event_type === 'user_added_tenancy') {
      if (!data.tenant_id || data.tenant_id.trim() === '') {
        throw new HttpException(
          'Tenant ID is required for tenancy entries',
          HttpStatus.BAD_REQUEST,
        );
      }
      return this.handleTenancyHistoryEntry(data);
    }

    // Handle payment history entries: outstanding balance reduction
    if (data.event_type === 'user_added_payment') {
      if (!data.tenant_id || data.tenant_id.trim() === '') {
        throw new HttpException(
          'Tenant ID is required for payment entries',
          HttpStatus.BAD_REQUEST,
        );
      }
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
      property_id: data.property_id!,
      tenant_id: data.tenant_id!,
      rent_start_date: startDate,
      expiry_date: endDate,
      rental_price: rentAmount,
      service_charge: serviceChargeAmount,
      amount_paid: 0,
      payment_status: RentPaymentStatusEnum.PAID,
      rent_status: RentStatusEnum.INACTIVE,
    });
    await this.rentRepository.save(rent);

    // Record outstanding balance on TenantBalance if applicable
    if (totalAmount > 0 && data.tenant_id) {
      const property = await this.propertyRepository.findOne({
        where: { id: data.property_id },
      });
      if (property?.owner_id) {
        await this.tenantBalancesService.applyChange(
          data.tenant_id,
          property.owner_id,
          -totalAmount,
          {
            type: TenantBalanceLedgerType.INITIAL_BALANCE,
            description: 'Historical tenancy recorded',
            propertyId: data.property_id,
            relatedEntityType: 'rent',
            relatedEntityId: rent.id,
          },
        );
      }
    }

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

    // Look up landlord via property
    const property = await this.propertyRepository.findOne({
      where: { id: data.property_id },
    });

    if (property?.owner_id) {
      const landlordId = property.owner_id;
      const tenantId = data.tenant_id!;

      // Single entry: payment increases the wallet (positive change).
      // If wallet was negative (outstanding), it moves toward 0.
      // If it overshoots 0, the excess becomes credit (wallet goes positive).
      await this.tenantBalancesService.applyChange(
        tenantId,
        landlordId,
        paymentAmount,
        {
          type: TenantBalanceLedgerType.OB_PAYMENT,
          description: `Manual payment of ₦${paymentAmount.toLocaleString()} received`,
          propertyId: data.property_id,
          relatedEntityType: 'property_history',
          relatedEntityId: saved.id,
        },
      );
    }

    // Sync rent records to reflect the new payment
    await this.syncRentPaymentStatus(data.tenant_id!, data.property_id);

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
          ? 'Tenancy started'
          : data.event_type === 'user_added_payment'
            ? 'Payment received'
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
    const existing = await this.getPropertyHistoryById(id);

    if (existing.event_type === 'user_added_tenancy') {
      return this.handleUpdateTenancyHistoryEntry(id, existing, data);
    }

    if (existing.event_type === 'user_added_payment') {
      return this.handleUpdatePaymentHistoryEntry(id, existing, data);
    }

    return this.propertyHistoryRepository.update(id, data);
  }

  private async handleUpdateTenancyHistoryEntry(
    id: string,
    existing: PropertyHistory,
    data: UpdatePropertyHistoryDto,
  ): Promise<PropertyHistory> {
    const newStartDate = new Date(data.move_in_date!);
    const newEndDate = new Date(data.move_out_date!);

    if (isNaN(newStartDate.getTime()) || isNaN(newEndDate.getTime())) {
      throw new HttpException('Invalid tenancy dates', HttpStatus.BAD_REQUEST);
    }

    if (newStartDate >= newEndDate) {
      throw new HttpException(
        'Tenancy start date must be before end date',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Find the associated rent created with this history entry (match by tenant + old dates)
    const existingRent =
      existing.tenant_id && existing.move_in_date
        ? await this.rentRepository.findOne({
            where: {
              tenant_id: existing.tenant_id,
              rent_start_date: existing.move_in_date,
              rent_status: RentStatusEnum.INACTIVE,
            },
          })
        : null;

    // Clash check against active rents on this property, excluding the associated rent
    const clashQuery = this.rentRepository
      .createQueryBuilder('rent')
      .where('rent.property_id = :propertyId', {
        propertyId: existing.property_id,
      })
      .andWhere('rent.rent_start_date < :endDate', {
        endDate: newEndDate.toISOString(),
      })
      .andWhere('rent.expiry_date > :startDate', {
        startDate: newStartDate.toISOString(),
      });

    if (existingRent) {
      clashQuery.andWhere('rent.id != :rentId', { rentId: existingRent.id });
    }

    const clashingRents = await clashQuery.getMany();
    if (clashingRents.length > 0) {
      throw new HttpException(
        'This tenancy period overlaps with an existing tenancy record for this property',
        HttpStatus.CONFLICT,
      );
    }

    const oldParsedData = JSON.parse(existing.event_description || '{}');
    const oldTotalAmount: number = oldParsedData.totalAmount || 0;
    const newParsedData = JSON.parse(data.event_description || '{}');
    const newTotalAmount: number = newParsedData.totalAmount || 0;

    // Update the history record
    await this.propertyHistoryRepository.update(id, data);

    // Update the associated rent record dates and amounts
    if (existingRent) {
      await this.rentRepository.update(existingRent.id, {
        rent_start_date: newStartDate,
        expiry_date: newEndDate,
        rental_price: newParsedData.rentAmount || 0,
        service_charge: newParsedData.serviceChargeAmount || 0,
      });
    }

    // Adjust outstanding balance if total amount changed
    if (oldTotalAmount !== newTotalAmount && existing.tenant_id) {
      const property = await this.propertyRepository.findOne({
        where: { id: existing.property_id },
      });
      if (property?.owner_id) {
        // delta > 0 = more owed (charge, negative wallet change)
        // delta < 0 = less owed (credit back, positive wallet change)
        const delta = newTotalAmount - oldTotalAmount;
        await this.tenantBalancesService.applyChange(
          existing.tenant_id,
          property.owner_id,
          -delta,
          {
            type: TenantBalanceLedgerType.INITIAL_BALANCE,
            description: `Historical tenancy updated (amount ${delta > 0 ? 'increased' : 'decreased'})`,
            propertyId: existing.property_id,
            relatedEntityType: 'property_history',
            relatedEntityId: id,
          },
        );
      }
    }

    return this.getPropertyHistoryById(id);
  }

  private async handleUpdatePaymentHistoryEntry(
    id: string,
    existing: PropertyHistory,
    data: UpdatePropertyHistoryDto,
  ): Promise<PropertyHistory> {
    const newParsedData = JSON.parse(data.event_description || '{}');
    const newPaymentAmount: number = newParsedData.paymentAmount || 0;

    if (newPaymentAmount <= 0) {
      throw new HttpException(
        'Payment amount must be greater than 0',
        HttpStatus.BAD_REQUEST,
      );
    }

    const oldParsedData = JSON.parse(existing.event_description || '{}');
    const oldPaymentAmount: number = oldParsedData.paymentAmount || 0;

    // Update the history record first
    await this.propertyHistoryRepository.update(id, data);

    if (oldPaymentAmount === newPaymentAmount) {
      return this.getPropertyHistoryById(id);
    }

    const property = await this.propertyRepository.findOne({
      where: { id: existing.property_id },
    });

    if (!property?.owner_id || !existing.tenant_id) {
      return this.getPropertyHistoryById(id);
    }

    const tenantId = existing.tenant_id;
    const landlordId = property.owner_id;

    // Query ledger entries created by the original payment to reverse them precisely
    const ledgerEntries = await this.ledgerRepository.find({
      where: {
        related_entity_id: id,
        related_entity_type: 'property_history',
        tenant_id: tenantId,
      },
    });

    for (const entry of ledgerEntries) {
      // Reverse each ledger entry by applying the opposite balance change.
      const reversal = -Number(entry.balance_change);
      if (reversal !== 0) {
        await this.tenantBalancesService.applyChange(
          tenantId,
          landlordId,
          reversal,
          {
            type: TenantBalanceLedgerType.OB_PAYMENT,
            description: 'Historical payment updated (reversal)',
            propertyId: existing.property_id,
            relatedEntityType: 'property_history',
            relatedEntityId: id,
          },
        );
      }
    }

    // Apply the new payment amount as a single wallet change.
    await this.tenantBalancesService.applyChange(
      tenantId,
      landlordId,
      newPaymentAmount,
      {
        type: TenantBalanceLedgerType.OB_PAYMENT,
        description: `Manual payment of ₦${newPaymentAmount.toLocaleString()} received`,
        propertyId: existing.property_id,
        relatedEntityType: 'property_history',
        relatedEntityId: id,
      },
    );

    // Sync rent records to reflect the updated payment
    await this.syncRentPaymentStatus(tenantId, existing.property_id);

    return this.getPropertyHistoryById(id);
  }

  async deletePropertyHistoryById(id: string) {
    const existing = await this.getPropertyHistoryById(id);

    if (existing.event_type === 'user_added_tenancy') {
      await this.reverseBalancesForTenancyEntry(existing);
    } else if (existing.event_type === 'user_added_payment') {
      await this.reverseBalancesForPaymentEntry(id, existing);
    }

    return this.propertyHistoryRepository.delete(id);
  }

  private async reverseBalancesForTenancyEntry(
    existing: PropertyHistory,
  ): Promise<void> {
    if (!existing.tenant_id) return;

    const parsedData = JSON.parse(existing.event_description || '{}');
    const totalAmount: number = parsedData.totalAmount || 0;
    if (totalAmount <= 0) return;

    const property = await this.propertyRepository.findOne({
      where: { id: existing.property_id },
    });
    if (!property?.owner_id) return;

    await this.tenantBalancesService.applyChange(
      existing.tenant_id,
      property.owner_id,
      totalAmount,
      {
        type: TenantBalanceLedgerType.INITIAL_BALANCE,
        description: 'Historical tenancy deleted (balance reversal)',
        propertyId: existing.property_id,
        relatedEntityType: 'property_history',
        relatedEntityId: existing.id,
      },
    );
  }

  private async reverseBalancesForPaymentEntry(
    id: string,
    existing: PropertyHistory,
  ): Promise<void> {
    if (!existing.tenant_id) return;

    const property = await this.propertyRepository.findOne({
      where: { id: existing.property_id },
    });
    if (!property?.owner_id) return;

    const tenantId = existing.tenant_id;
    const landlordId = property.owner_id;

    const ledgerEntries = await this.ledgerRepository.find({
      where: {
        related_entity_id: id,
        related_entity_type: 'property_history',
        tenant_id: tenantId,
      },
    });

    for (const entry of ledgerEntries) {
      const reversal = -Number(entry.balance_change);
      if (reversal !== 0) {
        await this.tenantBalancesService.applyChange(
          tenantId,
          landlordId,
          reversal,
          {
            type: TenantBalanceLedgerType.OB_PAYMENT,
            description: 'Historical payment deleted (reversal)',
            propertyId: existing.property_id,
            relatedEntityType: 'property_history',
            relatedEntityId: id,
          },
        );
      }
    }

    // Sync rent records to reflect the deleted payment
    await this.syncRentPaymentStatus(tenantId, existing.property_id);
  }

  /**
   * Recalculates amount_paid and payment_status on all inactive rent records
   * for a tenant+property by sequentially allocating payments oldest-first.
   * Called after any payment add, edit, or delete so rent records stay in sync
   * with the tenant balance ledger.
   */
  private async syncRentPaymentStatus(
    tenantId: string,
    propertyId: string,
  ): Promise<void> {
    const paymentHistories = await this.propertyHistoryRepository.find({
      where: {
        tenant_id: tenantId,
        property_id: propertyId,
        event_type: 'user_added_payment',
      },
      order: { move_in_date: 'ASC' },
    });

    let remaining = paymentHistories.reduce((sum, ph) => {
      try {
        const parsed = JSON.parse(ph.event_description || '{}');
        return sum + (Number(parsed.paymentAmount) || 0);
      } catch {
        return sum;
      }
    }, 0);

    const inactiveRents = await this.rentRepository.find({
      where: {
        tenant_id: tenantId,
        property_id: propertyId,
        rent_status: RentStatusEnum.INACTIVE,
      },
      order: { rent_start_date: 'ASC' },
    });

    if (inactiveRents.length === 0) return;

    for (const rent of inactiveRents) {
      const fullAmount =
        (Number(rent.rental_price) || 0) + (Number(rent.service_charge) || 0);

      if (remaining >= fullAmount) {
        rent.amount_paid = fullAmount;
        rent.payment_status = RentPaymentStatusEnum.PAID;
        remaining -= fullAmount;
      } else {
        rent.amount_paid = remaining;
        rent.payment_status = RentPaymentStatusEnum.OWING;
        remaining = 0;
      }
    }

    await this.rentRepository.save(inactiveRents);
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

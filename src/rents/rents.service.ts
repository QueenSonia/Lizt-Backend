import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, Repository } from 'typeorm';
import {
  CreateRentDto,
  RentFilter,
  RentStatusEnum,
} from './dto/create-rent.dto';
import { UpdateRentDto } from './dto/update-rent.dto';
import { Rent } from './entities/rent.entity';
import { DateService } from 'src/utils/date.helper';
import { buildRentFilter } from 'src/filters/query-filter';
import { rentReminderEmailTemplate } from 'src/utils/email-template';
import { UtilService } from 'src/utils/utility-service';
import { config } from 'src/config';
import { RentIncrease } from './entities/rent-increase.entity';
import { CreateRentIncreaseDto } from './dto/create-rent-increase.dto';
import { Property } from 'src/properties/entities/property.entity';
import {
  PropertyStatusEnum,
  TenantStatusEnum,
} from 'src/properties/dto/create-property.dto';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';

@Injectable()
export class RentsService {
  constructor(
    @InjectRepository(Rent)
    private readonly rentRepository: Repository<Rent>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
    @InjectRepository(RentIncrease)
    private readonly rentIncreaseRepository: Repository<RentIncrease>,
    private readonly utilService: UtilService,
  ) { }

  async payRent(data: any): Promise<Rent> {
    const { lease_start_date, lease_end_date } = data;
    data.lease_start_date = DateService.getStartOfTheDay(lease_start_date);
    data.lease_end_date = DateService.getEndOfTheDay(lease_end_date);
    return this.rentRepository.save(data);
  }

  async getAllRents(queryParams: RentFilter) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;
    const query = await buildRentFilter(queryParams);
    const [rents, count] = await this.rentRepository.findAndCount({
      where: query,
      skip,
      take: size,
      order: { created_at: 'DESC' },
    });

    const totalPages = Math.ceil(count / size);
    return {
      rents,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  async getRentByTenantId(tenant_id: string, userId: string) {
    const rent = await this.rentRepository.findOne({
      where: { tenant_id },
      relations: ['tenant', 'property'],
    });
    if (!rent?.id) {
      throw new HttpException(
        `Tenant has never paid rent`,
        HttpStatus.NOT_FOUND,
      );
    }
    // Allow if user is the tenant OR the landlord (owner of the property)
    if (rent.tenant_id !== userId && rent.property.owner_id !== userId) {
      throw new HttpException(
        'You do not have permission to view this rent',
        HttpStatus.FORBIDDEN,
      );
    }
    return rent;
  }

  async getDueRentsWithinSevenDays(queryParams: RentFilter) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const query = await buildRentFilter(queryParams);
    const startDate = DateService.getStartOfTheDay(new Date());
    const endDate = DateService.getEndOfTheDay(
      DateService.addDays(new Date(), 7),
    );

    const [rents, count] = await this.rentRepository.findAndCount({
      where: {
        ...query,
        expiry_date: Between(startDate, endDate),
      },
      relations: ['tenant', 'property'],
      skip,
      take: size,
      order: { expiry_date: 'ASC' },
    });

    const totalPages = Math.ceil(count / size);
    return {
      rents,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  async getOverdueRents(queryParams: RentFilter) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const query = await buildRentFilter(queryParams);
    const currentDate = new Date();

    const [rents, count] = await this.rentRepository.findAndCount({
      where: {
        ...query,
        // expiry_date: LessThanOrEqual(currentDate),
      },
      relations: ['tenant', 'property'],
      skip,
      take: size,
      order: { expiry_date: 'ASC' },
    });

    const totalPages = Math.ceil(count / size);
    return {
      rents,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  async sendRentReminder(id: string, userId: string) {
    const rent = await this.rentRepository.findOne({
      where: { id },
      relations: ['tenant', 'property'],
    });

    if (!rent?.id) {
      throw new HttpException('Rent not found', HttpStatus.NOT_FOUND);
    }

    if (rent.property.owner_id !== userId) {
      throw new HttpException(
        'You do not have permission to send reminders for this rent',
        HttpStatus.FORBIDDEN,
      );
    }

    const emailContent = rentReminderEmailTemplate(
      `${rent?.tenant?.user.first_name} ${rent?.tenant?.user.last_name}`,
      rent?.property?.rental_price,
      DateService.getDateNormalFormat(rent?.expiry_date),
    );

    await this.utilService.sendEmail(
      rent?.tenant?.email,
      `Rent Reminder for ${rent.property.name}`,
      emailContent,
    );

    return { message: 'Reminder sent successfully' };
  }

  async getRentById(id: string, userId: string) {
    const rent = await this.rentRepository.findOne({
      where: { id },
      relations: ['tenant', 'property'],
    });
    if (!rent?.id) {
      throw new HttpException(`Rent not found`, HttpStatus.NOT_FOUND);
    }
    // Allow if user is the tenant OR the landlord
    if (rent.tenant_id !== userId && rent.property.owner_id !== userId) {
      throw new HttpException(
        'You do not have permission to view this rent',
        HttpStatus.FORBIDDEN,
      );
    }
    return rent;
  }

  async updateRentById(id: string, data: any, userId: string) {
    const rent = await this.rentRepository.findOne({
      where: { id },
      relations: ['property'],
    });
    if (!rent) {
      throw new HttpException('Rent not found', HttpStatus.NOT_FOUND);
    }
    if (rent.property.owner_id !== userId) {
      throw new HttpException(
        'You do not have permission to update this rent',
        HttpStatus.FORBIDDEN,
      );
    }
    return this.rentRepository.update(id, data);
  }

  async deleteRentById(id: string, userId: string) {
    const rent = await this.rentRepository.findOne({
      where: { id },
      relations: ['property'],
    });
    if (!rent) {
      throw new HttpException('Rent not found', HttpStatus.NOT_FOUND);
    }
    if (rent.property.owner_id !== userId) {
      throw new HttpException(
        'You do not have permission to delete this rent',
        HttpStatus.FORBIDDEN,
      );
    }
    return this.rentRepository.delete(id);
  }

  async saveOrUpdateRentIncrease(data: CreateRentIncreaseDto, userId: string) {
    const property = await this.propertyRepository.findOne({
      where: { id: data.property_id, owner_id: userId },
    });
    if (!property) {
      throw new HttpException(
        'You do not own this Property',
        HttpStatus.NOT_FOUND,
      );
    }

    const existingRentIncrease = await this.rentIncreaseRepository.findOne({
      where: { property_id: data.property_id },
    });

    await this.propertyRepository.update(data.property_id, {
      rental_price: data?.current_rent,
    });

    if (existingRentIncrease?.id) {
      return this.rentIncreaseRepository.update(existingRentIncrease.id, {
        ...data,
        rent_increase_date: DateService.getStartOfTheDay(new Date()),
      });
    }

    return this.rentIncreaseRepository.save({
      ...data,
      rent_increase_date: DateService.getStartOfTheDay(new Date()),
    });
  }

  async findActiveRent(query) {
    return this.rentRepository.findOne({
      where: {
        ...query,
        rent_status: RentStatusEnum.ACTIVE,
      },
    });
  }

  async deactivateTenant(data: { tenant_id: string; property_id: string }) {
    const { tenant_id, property_id } = data;

    // Find the active rent for this specific property and tenant
    const rent = await this.rentRepository.findOne({
      where: {
        tenant_id,
        property_id,
        rent_status: RentStatusEnum.ACTIVE,
      },
    });

    if (rent) {
      // Update property status to vacant
      await this.propertyRepository.update(
        { id: property_id },
        { property_status: PropertyStatusEnum.VACANT },
      );

      // Deactivate property-tenant relationship for this specific property
      await this.propertyTenantRepository.update(
        { tenant_id, property_id },
        { status: TenantStatusEnum.INACTIVE },
      );

      // Deactivate the specific rent record
      await this.rentRepository.update(
        { tenant_id, property_id, rent_status: RentStatusEnum.ACTIVE }, // More specific where condition
        { rent_status: RentStatusEnum.INACTIVE }, // update values
      );
    }
  }
}

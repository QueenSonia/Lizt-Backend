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
  ) {}

  payRent = async (data: any): Promise<Rent> => {
    const { lease_start_date, lease_end_date } = data;
    data.lease_start_date = DateService.getStartOfTheDay(lease_start_date);
    data.lease_end_date = DateService.getEndOfTheDay(lease_end_date);
    return this.rentRepository.save(data);
  };

  getAllRents = async (queryParams: RentFilter) => {
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
  };

  getRentByTenantId = async (tenant_id: string) => {
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
    return rent;
  };

  getDueRentsWithinSevenDays = async (queryParams: RentFilter) => {
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
  };

  getOverdueRents = async (queryParams: RentFilter) => {
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
  };

  sendRentReminder = async (id: string) => {
    const rent = await this.rentRepository.findOne({
      where: { id },
      relations: ['tenant', 'property'],
    });

    if (!rent?.id) {
      throw new HttpException('Rent not found', HttpStatus.NOT_FOUND);
    }

    const emailContent = rentReminderEmailTemplate(
      `${rent?.tenant?.user.first_name} ${rent?.tenant?.user.last_name}`,
      rent?.property?.rental_price,
      DateService.getDateNormalFormat(rent?.expiry_date),
    );

    await UtilService.sendEmail(
      rent?.tenant?.email,
      `Rent Reminder for ${rent.property.name}`,
      emailContent,
    );

    return { message: 'Reminder sent successfully' };
  };

  getRentById = async (id: string) => {
    const rent = await this.rentRepository.findOne({
      where: { id },
      relations: ['tenant', 'property'],
    });
    if (!rent?.id) {
      throw new HttpException(`Rent not found`, HttpStatus.NOT_FOUND);
    }
    return rent;
  };

  updateRentById = async (id: string, data: any) => {
    return this.rentRepository.update(id, data);
  };

  deleteRentById = async (id: string) => {
    return this.rentRepository.delete(id);
  };

  saveOrUpdateRentIncrease = async (
    data: CreateRentIncreaseDto,
    userId: string,
  ) => {
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
  };

  async findActiveRent(query) {
    return this.rentRepository.findOne({
      where: {
        ...query,
        rent_status: RentStatusEnum.ACTIVE,
      },
    });
  }

  deactivateTenant = async (data: {
    tenant_id: string;
    property_id: string;
  }) => {
    const { tenant_id, property_id } = data;
    const rent = await this.rentRepository.findOne({
      where: {
        tenant_id,
        property_id,
      },
    });

    if (rent) {
      await this.propertyRepository.update(
        { id: rent.property_id },
        { property_status: PropertyStatusEnum.VACANT },
      );
      await this.propertyTenantRepository.update(
        { tenant_id: rent.tenant_id },
        { status: TenantStatusEnum.INACTIVE },
      );

      await this.rentRepository.update(
        { tenant_id }, // where condition
        { rent_status: RentStatusEnum.INACTIVE }, // update values
      );
    }
  };
}

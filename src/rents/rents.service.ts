import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, Repository } from 'typeorm';
import { CreateRentDto, RentFilter } from './dto/create-rent.dto';
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

@Injectable()
export class RentsService {
  constructor(
    @InjectRepository(Rent)
    private readonly rentRepository: Repository<Rent>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(RentIncrease)
    private readonly rentIncreaseRepository: Repository<RentIncrease>,
  ) {}

  async payRent(data: CreateRentDto): Promise<Rent> {
    const { expiry_date } = data;
    data.expiry_date = DateService.getEndOfTheDay(expiry_date);
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

  async getRentByTenantId(tenant_id: string) {
    const rent = await this.rentRepository.findOne({
      where: { tenant_id },
      relations: ['tenant'],
    });
    if (!rent?.id) {
      throw new HttpException(
        `Tenant has never paid rent`,
        HttpStatus.NOT_FOUND,
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
        expiry_date: LessThanOrEqual(currentDate),
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

  async sendRentReminder(id: string) {
    const rent = await this.rentRepository.findOne({
      where: { id },
      relations: ['tenant', 'property'],
    });

    if (!rent?.id) {
      throw new HttpException('Rent not found', HttpStatus.NOT_FOUND);
    }

    const emailContent = rentReminderEmailTemplate(
      `${rent?.tenant?.first_name} ${rent?.tenant?.last_name}`,
      rent?.property?.rental_price,
      DateService.getDateNormalFormat(rent?.expiry_date),
    );

    await UtilService.sendEmail(
      rent?.tenant?.email,
      `Rent Reminder for ${rent.property.name}`,
      emailContent,
    );

    return { message: 'Reminder sent successfully' };
  }

  async getRentById(id: string) {
    const rent = await this.rentRepository.findOne({
      where: { id },
      relations: ['tenant', 'property'],
    });
    if (!rent?.id) {
      throw new HttpException(`Rent not found`, HttpStatus.NOT_FOUND);
    }
    return rent;
  }

  async updateRentById(id: string, data: UpdateRentDto) {
    return this.rentRepository.update(id, data);
  }

  async deleteRentById(id: string) {
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
}

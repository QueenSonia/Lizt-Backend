import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { CreateRentDto, RentFilter } from './dto/create-rent.dto';
import { UpdateRentDto } from './dto/update-rent.dto';
import { Rent } from './entities/rent.entity';
import { DateService } from 'src/utils/date.helper';
import { ConfigService } from '@nestjs/config';
import { buildRentFilter } from 'src/filters/query-filter';
import { rentReminderEmailTemplate } from 'src/utils/email-template';
import { UtilService } from 'src/utils/utility-service';

@Injectable()
export class RentsService {
  constructor(
    @InjectRepository(Rent)
    private readonly rentRepository: Repository<Rent>,
    private readonly configService: ConfigService,
  ) {}

  async payRent(data: CreateRentDto): Promise<Rent> {
    const { expiry_date } = data;
    data.expiry_date = DateService.getEndOfTheDay(expiry_date);
    return this.rentRepository.save(data);
  }

  async getAllRents(queryParams: RentFilter) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : Number(this.configService.get<string>('DEFAULT_PAGE_NO'));
    const size = queryParams?.size
      ? Number(queryParams.size)
      : Number(this.configService.get<string>('DEFAULT_PER_PAGE'));
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
    const rent = await this.rentRepository.findOne({ where: { tenant_id } });
    if (!rent?.id) {
      throw new HttpException(
        `Tenant has never paid rent`,
        HttpStatus.NOT_FOUND,
      );
    }
    return rent;
  }

  async getDueRents(queryParams: RentFilter) {
    const page = queryParams?.page ? Number(queryParams?.page) : 1;
    const size = queryParams?.size ? Number(queryParams.size) : 10;
    const skip = (page - 1) * size;

    const query = await buildRentFilter(queryParams);
    const dueDate = DateService.addDays(new Date(), 7);

    const [rents, count] = await this.rentRepository.findAndCount({
      where: {
        expiry_date: LessThanOrEqual(dueDate),
        ...query,
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

  async getRentById(id: string): Promise<CreateRentDto> {
    const rent = await this.rentRepository.findOne({
      where: { id },
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
}

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CreatePropertyHistoryDto,
  PropertyHistoryFilter,
} from './dto/create-property-history.dto';
import { UpdatePropertyHistoryDto } from './dto/update-property-history.dto';
import { PropertyHistory } from './entities/property-history.entity';
import { config } from 'src/config';
import { buildPropertyHistoryFilter } from 'src/filters/query-filter';

@Injectable()
export class PropertyHistoryService {
  constructor(
    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepository: Repository<PropertyHistory>,
  ) {}

  createPropertyHistory = async (
    data: CreatePropertyHistoryDto,
  ): Promise<CreatePropertyHistoryDto> => {
    return this.propertyHistoryRepository.save(data);
  };

  getAllPropertyHistories = async (queryParams: PropertyHistoryFilter) => {
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
  };

  getPropertyHistoryById = async (
    id: string,
  ): Promise<CreatePropertyHistoryDto> => {
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
  };

  updatePropertyHistoryById = async (
    id: string,
    data: UpdatePropertyHistoryDto,
  ) => {
    await this.getPropertyHistoryById(id);
    return this.propertyHistoryRepository.update(id, data);
  };

  deletePropertyHistoryById = async (id: string) => {
    await this.getPropertyHistoryById(id);
    return this.propertyHistoryRepository.delete(id);
  };

  getPropertyHistoryByTenantId = async (
    tenant_id: string,
    property_id: string,
    queryParams: PropertyHistoryFilter,
  ) => {
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
  };
}

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreatePropertyDto, PropertyFilter } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Property } from './entities/property.entity';
import { Repository } from 'typeorm';
import { buildPropertyFilter } from 'src/filters/query-filter';

@Injectable()
export class PropertiesService {
  constructor(
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
  ) {}

  async createProperty(data: CreatePropertyDto): Promise<CreatePropertyDto> {
    return this.propertyRepository.save(data);
  }

  async getAllProperties(queryParams: PropertyFilter) {
    const page = queryParams?.page ? Number(queryParams?.page) : 1;
    const size = queryParams?.size ? Number(queryParams.size) : 10;
    const skip = queryParams?.page ? (Number(queryParams.page) - 1) * size : 0;
    const query = await buildPropertyFilter(queryParams);
    const [properties, count] = await this.propertyRepository.findAndCount({
      where: query,
      skip,
      take: size,
      order: { created_at: 'DESC' },
    });

    const totalPages = Math.ceil(count / size);
    return {
      properties,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages: Math.ceil(count / size),
        hasNextPage: page < totalPages,
      },
    };
  }

  async getPropertyById(id: string): Promise<CreatePropertyDto> {
    const property = await this.propertyRepository.findOne({
      where: { id },
    });
    if (!property?.id) {
      throw new HttpException(
        `Property with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return property;
  }

  async updatePropertyById(id: string, data: UpdatePropertyDto) {
    return this.propertyRepository.update(id, data);
  }

  async deletePropertyById(id: string) {
    return this.propertyRepository.delete(id);
  }
}

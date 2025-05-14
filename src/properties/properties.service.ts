import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  CreatePropertyDto,
  PropertyFilter,
  PropertyStatusEnum,
  TenantStatusEnum,
} from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Property } from './entities/property.entity';
import { In, IsNull, Repository } from 'typeorm';
import { buildPropertyFilter } from 'src/filters/query-filter';
import { ServiceRequestStatusEnum } from 'src/service-requests/dto/create-service-request.dto';
import { DateService } from 'src/utils/date.helper';
import { connectionSource } from 'ormconfig';
import { PropertyTenant } from './entities/property-tenants.entity';
import { config } from 'src/config';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { MoveTenantInDto, MoveTenantOutDto } from './dto/move-tenant.dto';
import { PropertyGroup } from './entities/property-group.entity';
import { CreatePropertyGroupDto } from './dto/create-property-group.dto';
import { RentsService } from 'src/rents/rents.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class PropertiesService {
  constructor(
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(PropertyGroup)
    private readonly propertyGroupRepository: Repository<PropertyGroup>,

    private readonly rentService: RentsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createProperty(data: CreatePropertyDto): Promise<CreatePropertyDto> {
    const createdProperty = await this.propertyRepository.save(data);

    // ✅ Emit event after property is created
    this.eventEmitter.emit('property.created', {
      property_id: createdProperty.id,
      name: createdProperty.name, // assuming you have a name field
      // creator_id: createdProperty.creator_id, // optional if applicable
    });

    return createdProperty;
  }


  async getAllProperties(queryParams: PropertyFilter) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const query = await buildPropertyFilter(queryParams);
    const [properties, count] = await this.propertyRepository.findAndCount({
      where: query,
      relations: ['property_tenants', 'rents'],
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
      relations: [
        'rents',
        'property_tenants',
        'property_tenants.tenant',
        'owner',
      ],
    });
    if (!property?.id) {
      throw new HttpException(
        `Property with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return property;
  }

  async getRentsOfAProperty(id: string): Promise<CreatePropertyDto> {
    const propertyAndRent = await this.propertyRepository.findOne({
      where: { id },
      relations: ['rents', 'rents.tenant'],
    });
    if (!propertyAndRent?.id) {
      throw new HttpException(
        `Property with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return propertyAndRent;
  }

  async getServiceRequestOfAProperty(id: string): Promise<CreatePropertyDto> {
    const propertyAndRent = await this.propertyRepository.findOne({
      where: { id },
      relations: ['service_requests', 'service_requests.tenant'],
    });
    if (!propertyAndRent?.id) {
      throw new HttpException(
        `Property with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return propertyAndRent;
  }

  async updatePropertyById(id: string, data: UpdatePropertyDto) {
    try{
    const activeRent = (await this.rentService.findActiveRent({
      property_id: id,
    })) as any;

    if (!activeRent) {
      throw new HttpException('No active Rent', HttpStatus.NOT_FOUND);
    }
    await this.rentService.updateRentById(activeRent.id, {
      lease_start_date: data.lease_end_date,
      lease_end_date: data.lease_end_date,
      rental_price: data.rental_price,
      service_charge: data.service_charge
    });
    return this.propertyRepository.update(id,{
      name: data.name,
      location: data.location,
      no_of_bedrooms: data.no_of_bedrooms
    });
  }catch(error){
    throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
  }
  }

  async deletePropertyById(id: string) {
    return this.propertyRepository.delete(id);
  }

  async getAdminDashboardStats(user_id: string) {
    const stats = await this.propertyRepository
      .createQueryBuilder('property')
      .leftJoin('property.property_tenants', 'property_tenants')
      .leftJoin('property_tenants.tenant', 'tenant')
      .leftJoin('property.service_requests', 'requests')
      .leftJoin('property.rents', 'rent')
      .where('property.owner_id = :user_id', { user_id })
      .select([
        'COUNT(DISTINCT property.id) as total_properties',
        'COUNT(DISTINCT tenant.id) as total_tenants',
        'COUNT(DISTINCT CASE WHEN rent.expiry_date <= :dueDate THEN tenant.id END) as due_tenants',
        'COUNT(DISTINCT CASE WHEN requests.status IN (:...statuses) THEN requests.id END) as unresolved_requests',
      ])
      .setParameters({
        dueDate: DateService.addDays(new Date(), 7),
        statuses: [
          ServiceRequestStatusEnum.PENDING,
          ServiceRequestStatusEnum.URGENT,
        ],
      })
      .getRawOne();

    return {
      total_properties: Number(stats.total_properties),
      total_tenants: Number(stats.total_tenants),
      due_tenants: Number(stats.due_tenants),
      unresolved_requests: Number(stats.unresolved_requests),
    };
  }

  async moveTenantIn(moveInData: MoveTenantInDto) {
    const { property_id, tenant_id, move_in_date } = moveInData;

    if (!DateService.isValidFormat_YYYY_MM_DD(move_in_date)) {
      throw new HttpException(
        'Invalid date format. Use YYYY-MM-DD',
        HttpStatus.BAD_REQUEST,
      );
    }

    const queryRunner = connectionSource.createQueryRunner();

    try {
      await connectionSource.initialize();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const property = await queryRunner.manager.findOne(Property, {
        where: { id: property_id },
      });
      if (!property?.id) {
        throw new HttpException('Property not found', HttpStatus.NOT_FOUND);
      }
      const existingTenant = await queryRunner.manager.findOne(PropertyTenant, {
        where: {
          property_id,
          tenant_id,
          status: TenantStatusEnum.ACTIVE,
        },
      });

      if (existingTenant?.id) {
        throw new HttpException(
          'Tenant is already assigned to this property',
          HttpStatus.BAD_REQUEST,
        );
      }

      const moveTenantIn = await queryRunner.manager.save(PropertyTenant, {
        property_id,
        tenant_id,
        status: TenantStatusEnum.ACTIVE,
      });

      await queryRunner.manager.update(Property, property_id, {
        property_status: PropertyStatusEnum.NOT_VACANT,
      });

      await queryRunner.manager.save(PropertyHistory, {
        property_id,
        tenant_id,
        move_in_date: DateService.getStartOfTheDay(move_in_date),
        monthly_rent: property?.rental_price,
        owner_comment: null,
        tenant_comment: null,
        move_out_date: null,
        move_out_reason: null,
      });

      await queryRunner.commitTransaction();
      return moveTenantIn;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw new HttpException(
        error?.message || 'an error occurred while moving tenant in',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    } finally {
      await queryRunner.release();
      await connectionSource.destroy();
    }
  }

  async moveTenantOut(moveOutData: MoveTenantOutDto) {
    const { property_id, tenant_id, move_out_date } = moveOutData;
    if (!DateService.isValidFormat_YYYY_MM_DD(move_out_date)) {
      throw new HttpException(
        'Invalid date format. Use YYYY-MM-DD',
        HttpStatus.BAD_REQUEST,
      );
    }

    const queryRunner = connectionSource.createQueryRunner();

    try {
      await connectionSource.initialize();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const propertyTenant = await queryRunner.manager.findOne(PropertyTenant, {
        where: {
          property_id,
          tenant_id,
          status: TenantStatusEnum.ACTIVE,
        },
      });

      if (!propertyTenant?.id) {
        throw new HttpException(
          'Tenant is not currently assigned to this property',
          HttpStatus.BAD_REQUEST,
        );
      }

      await queryRunner.manager.delete(PropertyTenant, {
        property_id,
        tenant_id,
      });

      await queryRunner.manager.update(Property, property_id, {
        property_status: PropertyStatusEnum.VACANT,
      });

      const propertyHistory = await queryRunner.manager.findOne(
        PropertyHistory,
        {
          where: {
            property_id,
            tenant_id,
            move_out_date: IsNull(),
          },
          order: { created_at: 'DESC' },
        },
      );

      if (!propertyHistory) {
        throw new HttpException(
          'Property history record not found',
          HttpStatus.NOT_FOUND,
        );
      }

      const updatedHistory = await queryRunner.manager.save(PropertyHistory, {
        ...propertyHistory,
        move_out_date: DateService.getStartOfTheDay(move_out_date),
        move_out_reason: moveOutData?.move_out_reason || null,
        owner_comment: moveOutData?.owner_comment || null,
        tenant_comment: moveOutData?.tenant_comment || null,
      });

      await queryRunner.commitTransaction();
      return updatedHistory;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw new HttpException(
        error?.message || 'an error occurred while moving tenant out',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    } finally {
      await queryRunner.release();
      await connectionSource.destroy();
    }
  }
  async createPropertyGroup(data: CreatePropertyGroupDto, owner_id: string) {
    const properties = await this.propertyRepository.find({
      where: {
        id: In(data.property_ids),
        owner_id,
      },
    });

    if (properties.length !== data.property_ids.length) {
      throw new HttpException(
        'Some properties do not exist or do not belong to you',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.propertyGroupRepository.save({
      name: data.name,
      property_ids: data.property_ids,
      owner_id,
    });
  }

  async getPropertyGroupById(id: string, owner_id: string) {
    const propertyGroup = await this.propertyGroupRepository.findOne({
      where: { id, owner_id },
    });

    if (!propertyGroup) {
      throw new HttpException('Property group not found', HttpStatus.NOT_FOUND);
    }

    const properties = await this.propertyRepository.find({
      where: { id: In(propertyGroup.property_ids) },
    });

    return {
      ...propertyGroup,
      properties,
    };
  }

  async getAllPropertyGroups(owner_id: string) {
    const propertyGroups = await this.propertyGroupRepository.find({
      where: { owner_id },
      order: { created_at: 'DESC' },
    });

    const allPropertyIds = [
      ...new Set(propertyGroups.flatMap((group) => group.property_ids)),
    ];

    const properties = await this.propertyRepository.find({
      where: { id: In(allPropertyIds) },
    });

    const propertyMap = new Map(
      properties.map((property) => [property.id, property]),
    );

    const groupsWithProperties = propertyGroups.map((group) => ({
      ...group,
      properties: group.property_ids
        .map((id) => propertyMap.get(id))
        .filter(Boolean),
    }));

    return {
      property_groups: groupsWithProperties,
      total: propertyGroups.length,
    };
  }
}

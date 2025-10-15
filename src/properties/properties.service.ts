import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreatePropertyDto,
  PropertyFilter,
  PropertyStatusEnum,
  TenantStatusEnum,
} from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Property } from './entities/property.entity';
import { DataSource, In, IsNull, Repository } from 'typeorm';
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
import { Users } from 'src/users/entities/user.entity';
import { UsersService } from 'src/users/users.service';
import { AssignTenantDto } from './dto/assign-tenant.dto';
import { Rent } from 'src/rents/entities/rent.entity';
import {
  RentPaymentStatusEnum,
  RentStatusEnum,
} from 'src/rents/dto/create-rent.dto';
import { UtilService } from 'src/utils/utility-service';
import { WhatsappBotService } from 'src/whatsapp-bot/whatsapp-bot.service';

@Injectable()
export class PropertiesService {
  constructor(
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(PropertyGroup)
    private readonly propertyGroupRepository: Repository<PropertyGroup>,
    private readonly userService: UsersService,
    private readonly rentService: RentsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  async createProperty(data: CreatePropertyDto): Promise<CreatePropertyDto> {
    let createdProperty: Property;

    try {
      // create the property
      createdProperty = await this.propertyRepository.save(data);

      // ✅ Emit event after property is created
      this.eventEmitter.emit('property.created', {
        property_id: createdProperty.id,
        property_name: createdProperty.name,
        user_id: createdProperty.owner_id,
      });

      // Get the full property with relations for notification
      const property = await this.getPropertyById(createdProperty.id);

      if (!property?.owner?.user?.phone_number) {
        console.warn(
          'Property owner or phone number not found for notification',
        );
      } else {
        const admin_phone_number = UtilService.normalizePhoneNumber(
          property.owner.user.phone_number,
        );

        await this.userService
          .sendPropertiesNotification({
            phone_number: admin_phone_number,
            name: 'Admin',
            property_name: createdProperty.name,
          })
          .catch((error) => {
            // Log notification errors but don't fail the main operation
            console.error('Failed to send properties notification:', error);
          });
      }
      return createdProperty;
    } catch (error) {
      // Log the error for debugging
      console.error('Error creating property:', error);

      // Re-throw with a more descriptive message
      if (error instanceof Error) {
        throw new Error(`Failed to create property: ${error.message}`);
      }
      throw new Error('Failed to create property due to an unexpected error');
    }
  }

  async getAllProperties(queryParams: PropertyFilter) {
    const page = queryParams.page
      ? Number(queryParams.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const { query, order } = await buildPropertyFilter(queryParams);

    const qb = this.propertyRepository
      .createQueryBuilder('property')
      .leftJoinAndSelect('property.rents', 'rents')
      .leftJoinAndSelect('rents.tenant', 'tenant')
      .leftJoinAndSelect('property.property_tenants', 'property_tenants')
      .where(query);

    // Apply sorting (rent requires custom logic)
    if (queryParams.sort_by === 'rent' && queryParams?.sort_order) {
      qb.orderBy(
        'rents.rental_price',
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
    } else if (queryParams.sort_by === 'expiry' && queryParams?.sort_order) {
      qb.orderBy(
        'rents.lease_end_date',
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
    } else if (queryParams.sort_by && queryParams?.sort_order) {
      qb.orderBy(
        `property.${queryParams.sort_by}`,
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
    }

    const [properties, count] = await qb
      .skip(skip)
      .take(size)
      .getManyAndCount();

    const totalPages = Math.ceil(count / size);

    return {
      properties,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  async getVacantProperty(query: { owner_id: string }) {
    return await this.propertyRepository.find({
      where: {
        property_status: PropertyStatusEnum.VACANT,
        ...query,
      },
      relations: ['property_tenants', 'rents', 'rents.tenant'],
    });
  }

  async getPropertyById(id: string): Promise<any> {
    const property = await this.propertyRepository.findOne({
      where: { id },
      relations: [
        'rents',
        'property_tenants',
        'property_tenants.tenant',
        'property_tenants.tenant.user',
        'owner',
        'owner.user',
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

  // async updatePropertyById(id: string, data: UpdatePropertyDto) {
  //   try {
  //     const activeRent = (await this.rentService.findActiveRent({
  //       property_id: id,
  //     })) as any;

  //     if (!activeRent) {
  //       return this.propertyRepository.update(id, {
  //         name: data.name,
  //         location: data.location,
  //         no_of_bedrooms: data.no_of_bedrooms,
  //       });
  //     }

  //     await this.userService.updateUserById(activeRent.tenant_id, {
  //       first_name: data.first_name,
  //       last_name: data.last_name,
  //       phone_number: data.phone_number,
  //     });
  //     await this.rentService.updateRentById(activeRent.id, {
  //       lease_start_date: data.lease_end_date,
  //       lease_end_date: data.lease_end_date,
  //       rental_price: data.rental_price,
  //       service_charge: data.service_charge,
  //       security_deposit: data.security_deposit,
  //     });
  //     return this.propertyRepository.update(id, {
  //       name: data.name,
  //       location: data.location,
  //       property_status: data.occupancy_status,
  //     });
  //   } catch (error) {
  //     throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
  //   }
  // }

  async updatePropertyById(
    id: string,
    updatePropertyDto: UpdatePropertyDto,
    requesterId: string,
  ): Promise<Property> {
    // findOneByOrFail
    const property = await this.propertyRepository.findOneByOrFail({ id });

    // Auth check: Ensure the requester owns the property
    if (property.owner_id !== requesterId) {
      throw new ForbiddenException(
        'You are not authorized to update this property',
      );
    }

    // Merge new data from DTO into existing property entity
    Object.assign(property, updatePropertyDto);

    // Save the updated entity back to the db
    return this.propertyRepository.save(property);
  }

  async deletePropertyById(propertyId: string, ownerId: string): Promise<void> {
    try {
      // Ensure the property exists and belongs to the user making the request
      const property = await this.propertyRepository.findOneBy({
        id: propertyId,
        owner_id: ownerId,
      });

      if (!property) {
        // Property not found or does not belong to the owner
        throw new HttpException('Property not found', HttpStatus.NOT_FOUND);
      }

      if (property.property_status === PropertyStatusEnum.OCCUPIED) {
        throw new HttpException(
          'Cannot delete property that is not vacant',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Soft delete sets the deleted_at timestamp
      await this.propertyRepository.softDelete(propertyId);
    } catch (error) {
      // Step 4: Handle known HttpExceptions separately
      if (error instanceof HttpException) {
        throw error; // rethrow custom errors without wrapping
      }

      // Step 5: Catch unexpected errors
      console.error('Unexpected error while deleting property:', error);
      throw new HttpException(
        'Something went wrong while deleting the property',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
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
        property_status: PropertyStatusEnum.OCCUPIED,
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

  async assignTenant(id: string, data: AssignTenantDto) {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const property = await queryRunner.manager.findOne(Property, {
        where: { id },
      });

      if (!property?.id) {
        throw new HttpException(
          `Property with id: ${id} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      const tenant = await this.userService.getAccountById(data.tenant_id);
      if (!tenant) throw new NotFoundException('Tenant not found');

      await queryRunner.manager.save(Rent, {
        tenant_id: data.tenant_id,
        lease_start_date: data.lease_start_date,
        lease_end_date: data.lease_end_date,
        property_id: property.id,
        amount_paid: data.rental_price,
        rental_price: data.rental_price,
        security_deposit: data.security_deposit,
        service_charge: data.service_charge,
        payment_status: RentPaymentStatusEnum.PAID,
        rent_status: RentStatusEnum.ACTIVE,
      });

      await Promise.all([
        queryRunner.manager.save(PropertyTenant, {
          property_id: property.id,
          tenant_id: data.tenant_id,
          status: TenantStatusEnum.ACTIVE,
        }),
        queryRunner.manager.update(Property, property.id, {
          property_status: PropertyStatusEnum.OCCUPIED,
        }),
        queryRunner.manager.save(PropertyHistory, {
          property_id: property.id,
          tenant_id: data.tenant_id,
          move_in_date: DateService.getStartOfTheDay(new Date()),
          monthly_rent: data.rental_price,
          owner_comment: null,
          tenant_comment: null,
          move_out_date: null,
          move_out_reason: null,
        }),
      ]);

      await queryRunner.commitTransaction();

      return {
        message: 'Tenant Added Successfully',
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('Transaction rolled back due to:', error);
      throw new HttpException(
        error?.message ||
          'An error occurred while assigning Tenant To property',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    } finally {
      await queryRunner.release();
    }
  }
}

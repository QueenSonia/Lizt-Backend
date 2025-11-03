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
import { PerformanceMonitor } from 'src/utils/performance-monitor';
import { KYCApplicationService } from 'src/kyc-links/kyc-application.service';
import { KYCLink } from 'src/kyc-links/entities/kyc-link.entity';

@Injectable()
export class PropertiesService {
  constructor(
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(PropertyGroup)
    private readonly propertyGroupRepository: Repository<PropertyGroup>,
    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepository: Repository<PropertyHistory>,
    private readonly userService: UsersService,
    private readonly rentService: RentsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
    private readonly kycApplicationService: KYCApplicationService,
  ) {}

  async createProperty(
    propertyData: CreatePropertyDto,
    ownerId: string,
  ): Promise<Property> {
    try {
      // create the property
      const newProperty = this.propertyRepository.create({
        ...propertyData,
        owner_id: ownerId,
      });

      // save the single entity to the database
      const savedProperty = await this.propertyRepository.save(newProperty);

      //// Tenant assignment-on-property-creation option removed from frontend form
      // If tenant_id is provided, create PropertyTenant relationship
      // if (propertyData.tenant_id) {
      //   const propertyTenant = this.propertyTenantRepository.create({
      //     property_id: savedProperty.id,
      //     tenant_id: propertyData.tenant_id,
      //     status: TenantStatusEnum.ACTIVE,
      //   });

      //   await this.propertyTenantRepository.save(propertyTenant);

      //   // Update property status to NOT_VACANT
      //   savedProperty.property_status = PropertyStatusEnum.OCCUPIED;
      //   await this.propertyRepository.save(savedProperty);
      // }

      // ✅ Emit event after property is created
      this.eventEmitter.emit('property.created', {
        property_id: savedProperty.id,
        property_name: savedProperty.name,
        user_id: savedProperty.owner_id,
      });

      // Get the full property with relations for notification
      const property = await this.getPropertyById(savedProperty.id);

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
            property_name: savedProperty.name,
          })
          .catch((error) => {
            // Log notification errors but don't fail the main operation
            console.error('Failed to send properties notification:', error);
          });
      }
      return savedProperty;
    } catch (error) {
      // Log the detailed error and throw a standardized exception
      console.error('Error creating property in service:', error);
      throw new Error(`Failed to create property: ${error.message}`);
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

    const { query } = await buildPropertyFilter(queryParams);

    const qb = this.propertyRepository
      .createQueryBuilder('property')
      .leftJoinAndSelect(
        'property.rents',
        'rents',
        'rents.rent_status = :activeStatus',
        { activeStatus: RentStatusEnum.ACTIVE },
      )
      .leftJoinAndSelect('rents.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'user')
      .leftJoinAndSelect(
        'property.property_tenants',
        'property_tenants',
        'property_tenants.status = :tenantStatus',
        { tenantStatus: TenantStatusEnum.ACTIVE },
      )
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

  // async getVacantProperty(query: { owner_id: string }) {
  //   return await this.propertyRepository.find({
  //     where: {
  //       property_status: PropertyStatusEnum.VACANT,
  //       ...query,
  //     },
  //     relations: ['property_tenants', 'rents', 'rents.tenant'],
  //   });
  // }

  async getVacantProperties(ownerId: string): Promise<Property[]> {
    return this.propertyRepository
      .createQueryBuilder('property')
      .select([
        'property.id',
        'property.name',
        'property.location',
        'property.property_status',
      ])
      .where('property.owner_id = :ownerId', { ownerId })
      .andWhere('property.property_status = :status', {
        status: PropertyStatusEnum.VACANT,
      })
      .getMany();
  }

  async getPropertyById(id: string): Promise<any> {
    // Use query builder for better performance - only load active relationships
    const property = await this.propertyRepository
      .createQueryBuilder('property')
      .leftJoinAndSelect('property.rents', 'rent')
      .leftJoinAndSelect('rent.tenant', 'rentTenant')
      .leftJoinAndSelect('rentTenant.user', 'rentTenantUser')
      .leftJoinAndSelect('property.property_tenants', 'propertyTenant')
      .leftJoinAndSelect('propertyTenant.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'tenantUser')
      .leftJoinAndSelect('property.service_requests', 'serviceRequest')
      .leftJoinAndSelect('serviceRequest.tenant', 'srTenant')
      .leftJoinAndSelect('srTenant.user', 'srTenantUser')
      .leftJoinAndSelect('property.owner', 'owner')
      .leftJoinAndSelect('owner.user', 'ownerUser')
      .leftJoinAndSelect(
        'property.kyc_applications',
        'kycApplication',
        'kycApplication.status = :pendingStatus',
        { pendingStatus: 'pending' },
      )
      .leftJoinAndSelect(
        'property.kyc_links',
        'kycLink',
        'kycLink.is_active = :isActive',
        { isActive: true },
      )
      .where('property.id = :id', { id })
      .getOne();
    if (!property?.id) {
      throw new HttpException(
        `Property with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    const activeTenantRelation = property.property_tenants.find(
      (pt) => pt.status === 'active',
    );
    const activeRent = property.rents.find((r) => r.rent_status === 'active');

    let activeTenantInfo: any | null = null;
    if (activeTenantRelation && activeRent) {
      const tenantUser = activeTenantRelation.tenant.user;
      activeTenantInfo = {
        id: activeTenantRelation.tenant.id,
        name: `${tenantUser.first_name} ${tenantUser.last_name}`,
        email: tenantUser.email,
        phone: tenantUser.phone_number,
        rentAmount: activeRent.rental_price,
        leaseStartDate: activeRent.lease_start_date.toISOString(),
        rentExpiryDate: activeRent.lease_end_date.toISOString(),
      };
    }

    // 2. Format Rent Payments
    const rentPayments = property.rents.map((rent) => ({
      id: rent.id,
      paymentDate: rent.created_at,
      amountPaid: rent.amount_paid,
      status: rent.payment_status,
    }));

    // 3. Format Service Requests
    const serviceRequests = property.service_requests.map((sr) => ({
      id: sr.id,
      tenantName: `${sr.tenant.user.first_name} ${sr.tenant.user.last_name}`,
      propertyName: property.name,
      messagePreview: sr.description.substring(0, 100) + '...',
      dateReported: sr.date_reported.toISOString(),
      status: sr.status,
    }));

    // 4. Computed Description
    const computedDescription = `${property.name} is a ${property.no_of_bedrooms === -1 ? 'studio' : `${property.no_of_bedrooms}`}-bedroom ${property.property_type?.toLowerCase()} located in ${property.location}`;

    // 5. Format KYC Applications
    const kycApplications =
      property.kyc_applications?.map((app) => ({
        id: app.id,
        status: app.status,
        applicantName: `${app.first_name} ${app.last_name}`,
        email: app.email,
        phoneNumber: app.phone_number,
        submissionDate: app.created_at
          ? new Date(app.created_at).toISOString()
          : new Date().toISOString(),
      })) || [];

    // 6. KYC Link Status
    const hasActiveKYCLink =
      property.kyc_links?.some((link) => link.is_active) || false;
    const kycApplicationCount = kycApplications.length;

    // 7. Build the final DTO
    return {
      id: property.id,
      name: property.name,
      location: property.location,
      description: property.description || computedDescription,
      status: property.property_status.toUpperCase() as
        | 'VACANT'
        | 'OCCUPIED'
        | 'INACTIVE', // Normalize to uppercase for frontend type consistency
      propertyType: property.property_type,
      bedrooms: property.no_of_bedrooms,
      bathrooms: property.no_of_bathrooms,
      // size: property.size, //add field to repository
      // yearBuilt: property.year_built, // Add to property repository
      tenant: activeTenantInfo,
      rentPayments: rentPayments,
      serviceRequests: serviceRequests,
      kycApplications: kycApplications,
      kycApplicationCount: kycApplicationCount,
      hasActiveKYCLink: hasActiveKYCLink,
    };
  }

  @PerformanceMonitor.MonitorPerformance(2000) // Alert if takes more than 2 seconds
  async getPropertyDetails(id: string): Promise<any> {
    // Use query builder for better performance and selective loading
    const property = await this.propertyRepository
      .createQueryBuilder('property')
      .leftJoinAndSelect(
        'property.rents',
        'rent',
        'rent.rent_status = :activeStatus',
        { activeStatus: 'active' },
      )
      .leftJoinAndSelect('rent.tenant', 'rentTenant')
      .leftJoinAndSelect('rentTenant.user', 'rentTenantUser')
      .leftJoinAndSelect(
        'property.property_tenants',
        'propertyTenant',
        'propertyTenant.status = :tenantStatus',
        { tenantStatus: 'active' },
      )
      .leftJoinAndSelect('propertyTenant.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'tenantUser')
      .leftJoinAndSelect('property.property_histories', 'history')
      .leftJoinAndSelect('history.tenant', 'historyTenant')
      .leftJoinAndSelect('historyTenant.user', 'historyTenantUser')
      .leftJoinAndSelect('property.kyc_applications', 'kycApplication')
      .leftJoinAndSelect(
        'property.kyc_links',
        'kycLink',
        'kycLink.is_active = :isActive',
        { isActive: true },
      )
      .where('property.id = :id', { id })
      .getOne();

    if (!property?.id) {
      throw new HttpException(
        `Property with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    const activeTenantRelation = property.property_tenants.find(
      (pt) => pt.status === 'active',
    );
    const activeRent = property.rents.find((r) => r.rent_status === 'active');
    console.log('activeTenantRelation:', activeTenantRelation);
    console.log('activeRent:', activeRent);

    // Current tenant information
    let currentTenant: any | null = null;
    if (activeTenantRelation && activeRent) {
      const tenantUser = activeTenantRelation.tenant.user;
      console.log('Tenant:', tenantUser);
      currentTenant = {
        id: activeTenantRelation.tenant.id,
        name: `${tenantUser.first_name} ${tenantUser.last_name}`,
        email: tenantUser.email,
        phone: tenantUser.phone_number,
        tenancyStartDate: activeRent.lease_start_date
          .toISOString()
          .split('T')[0],
        paymentCycle: activeRent.payment_frequency || 'Monthly',
      };
    }

    // Property history from property_histories table
    const history = property.property_histories
      .sort((a, b) => {
        const dateA = a.move_out_date || a.move_in_date;
        const dateB = b.move_out_date || b.move_in_date;
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      })
      .map((hist, index) => {
        const tenantUser = hist.tenant.user;
        const tenantName = `${tenantUser.first_name} ${tenantUser.last_name}`;

        if (hist.move_out_date) {
          // Tenant moved out
          return {
            id: index + 1,
            date: hist.move_out_date.toISOString().split('T')[0],
            eventType: 'tenant_moved_out',
            title: 'Tenant Moved Out',
            description: `${tenantName} ended tenancy.`,
            details: hist.move_out_reason
              ? `Reason: ${hist.move_out_reason.replace('_', ' ')}`
              : null,
          };
        } else {
          // Tenant moved in
          return {
            id: index + 1,
            date: hist.move_in_date.toISOString().split('T')[0],
            eventType: 'tenant_moved_in',
            title: 'Tenant Moved In',
            description: `${tenantName} started tenancy.`,
            details: `Monthly rent: ₦${hist.monthly_rent?.toLocaleString()}`,
          };
        }
      });

    // Computed description
    const computedDescription = `${property.name} is a ${
      property.no_of_bedrooms === -1
        ? 'studio'
        : `${property.no_of_bedrooms}-bedroom`
    } ${property.property_type?.toLowerCase()} located at ${property.location}.`;

    // KYC Applications data
    const kycApplications =
      property.kyc_applications?.map((app) => ({
        id: app.id,
        status: app.status,
        applicantName: `${app.first_name} ${app.last_name}`,
        email: app.email,
        phoneNumber: app.phone_number,
        submissionDate: app.created_at
          ? new Date(app.created_at).toISOString()
          : new Date().toISOString(),
        employmentStatus: app.employment_status,
        monthlyIncome: app.monthly_net_income,
      })) || [];

    // KYC Link Status
    const hasActiveKYCLink =
      property.kyc_links?.some((link) => link.is_active) || false;
    const kycApplicationCount = kycApplications.length;
    const pendingApplicationsCount = kycApplications.filter(
      (app) => app.status === 'pending',
    ).length;

    // Build the comprehensive response
    return {
      id: property.id,
      name: property.name,
      address: property.location,
      type: property.property_type,
      bedrooms: property.no_of_bedrooms,
      bathrooms: property.no_of_bathrooms,
      status:
        property.property_status === 'occupied'
          ? 'Occupied'
          : property.property_status === 'inactive'
            ? 'Inactive'
            : 'Vacant',
      rent: activeRent?.rental_price || null,
      rentExpiryDate:
        activeRent?.lease_end_date?.toISOString().split('T')[0] || null,
      description: property.description || computedDescription,
      currentTenant,
      history,
      kycApplications,
      kycApplicationCount,
      pendingApplicationsCount,
      hasActiveKYCLink,
    };
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
    console.log(property);

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

      // Requirement 7.4: Cannot delete occupied or deactivated properties
      if (property.property_status === PropertyStatusEnum.OCCUPIED) {
        throw new HttpException(
          'Cannot delete property that is currently occupied. Please end the tenancy first.',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (property.property_status === PropertyStatusEnum.INACTIVE) {
        throw new HttpException(
          'Cannot delete property that is deactivated. Please reactivate the property first.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Requirement 7.2 & 7.3: Check if property has any tenancy history records
      const historyCount = await this.propertyHistoryRepository.count({
        where: { property_id: propertyId },
      });

      if (historyCount > 0) {
        throw new HttpException(
          'Cannot delete property with existing tenancy history. Properties that have been inhabited cannot be deleted.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Only vacant properties with no history can be deleted
      await this.propertyRepository.softDelete(propertyId);
    } catch (error) {
      // Handle known HttpExceptions separately
      if (error instanceof HttpException) {
        throw error; // rethrow custom errors without wrapping
      }

      // Catch unexpected errors
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

    const queryRunner = this.dataSource.createQueryRunner();

    try {
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
    }
  }

  async moveTenantOut(moveOutData: MoveTenantOutDto, requesterId?: string) {
    const { property_id, tenant_id, move_out_date } = moveOutData;
    if (!DateService.isValidFormat_YYYY_MM_DD(move_out_date)) {
      throw new HttpException(
        'Invalid date format. Use YYYY-MM-DD',
        HttpStatus.BAD_REQUEST,
      );
    }

    // If requesterId is provided (for landlords), validate ownership
    if (requesterId) {
      const property = await this.propertyRepository.findOneBy({
        id: property_id,
      });
      if (!property) {
        throw new HttpException('Property not found', HttpStatus.NOT_FOUND);
      }

      if (property.owner_id !== requesterId) {
        throw new ForbiddenException(
          'You are not authorized to end tenancy for this property',
        );
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();

    try {
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

      // Deactivate the rent record
      await queryRunner.manager.update(
        Rent,
        {
          property_id,
          tenant_id,
          rent_status: RentStatusEnum.ACTIVE,
        },
        {
          rent_status: RentStatusEnum.INACTIVE,
        },
      );

      // Remove property-tenant relationship
      await queryRunner.manager.delete(PropertyTenant, {
        property_id,
        tenant_id,
      });

      // Update property status to vacant
      await queryRunner.manager.update(Property, property_id, {
        property_status: PropertyStatusEnum.VACANT,
      });

      // Note: KYC links are not automatically reactivated when tenant moves out
      // Landlord needs to generate new KYC links if they want to find new tenants

      // Try to find existing PropertyHistory record for this tenant
      let propertyHistory = await queryRunner.manager.findOne(PropertyHistory, {
        where: {
          property_id,
          tenant_id,
          move_out_date: IsNull(),
        },
        order: { created_at: 'DESC' },
      });

      // If no PropertyHistory record exists, create one based on the current tenancy
      if (!propertyHistory) {
        console.log(
          `No PropertyHistory record found for tenant ${tenant_id} in property ${property_id}. Creating one...`,
        );

        // Get the active rent record to determine move-in date and rent amount
        const activeRent = await queryRunner.manager.findOne(Rent, {
          where: {
            property_id,
            tenant_id,
            rent_status: RentStatusEnum.ACTIVE,
          },
        });

        if (!activeRent) {
          throw new HttpException(
            'No active rent record found for this tenant and property',
            HttpStatus.BAD_REQUEST,
          );
        }

        // Create the missing PropertyHistory record
        propertyHistory = await queryRunner.manager.save(PropertyHistory, {
          property_id,
          tenant_id,
          move_in_date:
            activeRent.lease_start_date ||
            DateService.getStartOfTheDay(new Date()),
          monthly_rent: activeRent.rental_price,
          owner_comment: null,
          tenant_comment: null,
          move_out_date: null,
          move_out_reason: null,
        });

        console.log('Created PropertyHistory record:', propertyHistory.id);
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

  @PerformanceMonitor.MonitorPerformance(5000) // Alert if takes more than 5 seconds
  async syncPropertyStatuses() {
    // Method to fix data inconsistencies - sync property status with actual tenancy state
    // Use query builder for better performance
    const properties = await this.propertyRepository
      .createQueryBuilder('property')
      .leftJoinAndSelect(
        'property.rents',
        'rent',
        'rent.rent_status = :activeStatus',
        { activeStatus: RentStatusEnum.ACTIVE },
      )
      .where('property.property_status != :inactiveStatus', {
        inactiveStatus: PropertyStatusEnum.INACTIVE,
      })
      .getMany();

    let statusUpdates = 0;
    let historyRecordsCreated = 0;

    // Batch operations for better performance
    const propertiesToUpdate: Property[] = [];
    const historyRecordsToCreate: any[] = [];

    for (const property of properties) {
      const hasActiveRent = property.rents && property.rents.length > 0;
      const correctStatus = hasActiveRent
        ? PropertyStatusEnum.OCCUPIED
        : PropertyStatusEnum.VACANT;

      if (property.property_status !== correctStatus) {
        console.log(
          `Fixing property ${property.name}: ${property.property_status} -> ${correctStatus}`,
        );
        property.property_status = correctStatus;
        propertiesToUpdate.push(property);
        statusUpdates++;
      }

      // Check for missing history records for active rents
      if (hasActiveRent) {
        for (const rent of property.rents) {
          // Check if history record exists (batch query would be better but this is simpler for now)
          const existingHistory = await this.propertyHistoryRepository.findOne({
            where: {
              property_id: property.id,
              tenant_id: rent.tenant_id,
              move_out_date: IsNull(),
            },
          });

          if (!existingHistory) {
            console.log(
              `Creating missing PropertyHistory record for tenant ${rent.tenant_id} in property ${property.name}`,
            );

            historyRecordsToCreate.push({
              property_id: property.id,
              tenant_id: rent.tenant_id,
              move_in_date:
                rent.lease_start_date ||
                DateService.getStartOfTheDay(new Date()),
              monthly_rent: rent.rental_price,
              owner_comment: 'Auto-created during sync',
              tenant_comment: null,
              move_out_date: null,
              move_out_reason: null,
            });

            historyRecordsCreated++;
          }
        }
      }
    }

    // Batch save operations
    if (propertiesToUpdate.length > 0) {
      await this.propertyRepository.save(propertiesToUpdate);
    }

    if (historyRecordsToCreate.length > 0) {
      await this.propertyHistoryRepository.save(historyRecordsToCreate);
    }

    return {
      message: 'Property statuses synchronized successfully',
      statusUpdates,
      historyRecordsCreated,
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

      // Prevent tenant assignment to inactive properties
      if (property.property_status === PropertyStatusEnum.INACTIVE) {
        throw new HttpException(
          'Cannot assign tenant to inactive property. Please reactivate the property first.',
          HttpStatus.BAD_REQUEST,
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
        payment_frequency: data.payment_frequency || 'Monthly',
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
        // Deactivate any active KYC links for this property
        this.deactivateKYCLinksForProperty(queryRunner, property.id),
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

  /**
   * Deactivate KYC links when property becomes occupied
   * Requirements: 2.4, 2.5, 6.4
   */
  private async deactivateKYCLinksForProperty(
    queryRunner: any,
    propertyId: string,
  ): Promise<void> {
    await queryRunner.manager.update(
      'kyc_links',
      { property_id: propertyId, is_active: true },
      { is_active: false },
    );
  }
}

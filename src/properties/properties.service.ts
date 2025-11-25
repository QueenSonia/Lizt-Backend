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
import { ScheduledMoveOut } from './entities/scheduled-move-out.entity';
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
import { TenantKyc } from 'src/tenant-kyc/entities/tenant-kyc.entity';

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
    @InjectRepository(ScheduledMoveOut)
    private readonly scheduledMoveOutRepository: Repository<ScheduledMoveOut>,
    @InjectRepository(TenantKyc)
    private readonly tenantKycRepository: Repository<TenantKyc>,
    private readonly userService: UsersService,
    private readonly rentService: RentsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
    private readonly kycApplicationService: KYCApplicationService,
    private readonly utilService: UtilService,
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
        const admin_phone_number = this.utilService.normalizePhoneNumber(
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
        'user.tenant_kycs',
        'tenantKyc',
        'tenantKyc.admin_id = property.owner_id',
      )
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
      .leftJoinAndSelect(
        'tenantUser.tenant_kycs',
        'tenantKyc',
        'tenantKyc.admin_id = property.owner_id',
      )
      .leftJoinAndSelect('property.service_requests', 'serviceRequest')
      .leftJoinAndSelect('serviceRequest.tenant', 'srTenant')
      .leftJoinAndSelect('srTenant.user', 'srTenantUser')
      .leftJoinAndSelect(
        'srTenantUser.tenant_kycs',
        'srTenantKyc',
        'srTenantKyc.admin_id = property.owner_id',
      )
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
      const tenantKyc = tenantUser.tenant_kycs?.[0]; // Get TenantKyc data if available (filtered by admin_id)

      // Prioritize TenantKyc data over User data for consistency
      const firstName = tenantKyc?.first_name ?? tenantUser.first_name;
      const lastName = tenantKyc?.last_name ?? tenantUser.last_name;
      const phone = tenantKyc?.phone_number ?? tenantUser.phone_number;

      // For email, check if it's a placeholder and handle accordingly
      let email: string | null = tenantKyc?.email ?? tenantUser.email;
      if (
        email &&
        (email.includes('@placeholder.lizt.app') ||
          email.includes('@placeholder.com'))
      ) {
        email = null; // Don't show placeholder emails to frontend
      }
      // Also check if email is empty string
      if (email === '') {
        email = null;
      }

      activeTenantInfo = {
        id: activeTenantRelation.tenant.id,
        name: `${firstName} ${lastName}`,
        email: email,
        phone: phone,
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
    const serviceRequests = property.service_requests.map((sr) => {
      const tenantUser = sr.tenant.user;
      const tenantKyc = tenantUser.tenant_kycs?.[0]; // Filtered by admin_id in query

      // Prioritize TenantKyc data for consistency
      const firstName = tenantKyc?.first_name ?? tenantUser.first_name;
      const lastName = tenantKyc?.last_name ?? tenantUser.last_name;

      return {
        id: sr.id,
        tenantName: `${firstName} ${lastName}`,
        propertyName: property.name,
        messagePreview: sr.description.substring(0, 100) + '...',
        dateReported: sr.date_reported.toISOString(),
        status: sr.status,
      };
    });

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
      .leftJoinAndSelect(
        'tenantUser.tenant_kycs',
        'tenantKyc',
        'tenantKyc.admin_id = property.owner_id',
      )
      .leftJoinAndSelect('property.property_histories', 'history')
      .leftJoinAndSelect('history.tenant', 'historyTenant')
      .leftJoinAndSelect('historyTenant.user', 'historyTenantUser')
      .leftJoinAndSelect(
        'historyTenantUser.tenant_kycs',
        'historyTenantKyc',
        'historyTenantKyc.admin_id = property.owner_id',
      )
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

    // Current tenant information
    let currentTenant: any | null = null;
    if (activeTenantRelation && activeRent) {
      const tenantUser = activeTenantRelation.tenant.user;
      const tenantKyc = tenantUser.tenant_kycs?.[0]; // Get TenantKyc data if available (filtered by admin_id)

      // Prioritize TenantKyc data over User data for consistency
      const firstName = tenantKyc?.first_name ?? tenantUser.first_name;
      const lastName = tenantKyc?.last_name ?? tenantUser.last_name;
      const email = tenantKyc?.email ?? tenantUser.email;
      const phone = tenantKyc?.phone_number ?? tenantUser.phone_number;

      currentTenant = {
        id: activeTenantRelation.tenant.id,
        tenancyId: activeTenantRelation.id, // PropertyTenant entity ID for tenancy operations
        name: `${firstName} ${lastName}`,
        email: email,
        phone: phone,
        tenancyStartDate: activeRent.lease_start_date
          .toISOString()
          .split('T')[0],
        paymentCycle: activeRent.payment_frequency || 'Monthly',
      };
    }

    // Property history from property_histories table
    const history = property.property_histories
      .sort((a, b) => {
        // Sort by created_at for all event types
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      })
      .map((hist, index) => {
        const tenantUser = hist.tenant.user;
        const tenantKyc = tenantUser.tenant_kycs?.[0]; // Filtered by admin_id in query

        // Prioritize TenantKyc data for consistency
        const firstName = tenantKyc?.first_name ?? tenantUser.first_name;
        const lastName = tenantKyc?.last_name ?? tenantUser.last_name;
        const tenantName = `${firstName} ${lastName}`;

        // Handle different event types
        if (
          hist.event_type === 'service_request' ||
          hist.event_type === 'service_request_created'
        ) {
          // Service request created event
          const eventDate = hist.created_at
            ? new Date(hist.created_at).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];

          return {
            id: index + 1,
            date: eventDate,
            eventType: 'service_request_created',
            title: hist.event_description || 'Service request reported',
            description: 'Service request created',
            details: `Reported by: ${tenantName}`,
          };
        } else if (hist.event_type === 'service_request_updated') {
          // Service request updated event
          const eventDate = hist.created_at
            ? new Date(hist.created_at).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];

          // Parse status and description from event_description
          const parts = hist.event_description?.split('|||') || [];
          const status = parts[0] || 'updated';
          const description = parts[1] || 'Service request updated';

          // Format status label (e.g., "in_progress" -> "In Progress")
          const statusLabel = status
            .split('_')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

          return {
            id: index + 1,
            date: eventDate,
            eventType: 'service_request_updated',
            title: description,
            description: `Service request ${statusLabel.toLowerCase()}`,
            details: null,
          };
        } else if (hist.move_out_date) {
          // Tenant moved out
          return {
            id: index + 1,
            date: new Date(hist.move_out_date).toISOString().split('T')[0],
            eventType: 'tenant_moved_out',
            title: 'Tenant Moved Out',
            description: `${tenantName} ended tenancy.`,
            details: hist.move_out_reason
              ? `Reason: ${hist.move_out_reason.replace('_', ' ')}`
              : null,
          };
        } else if (hist.move_in_date) {
          // Tenant moved in
          return {
            id: index + 1,
            date: new Date(hist.move_in_date).toISOString().split('T')[0],
            eventType: 'tenant_moved_in',
            title: 'Tenant Moved In',
            description: `${tenantName} started tenancy.`,
            details: `Monthly rent: ₦${hist.monthly_rent?.toLocaleString()}`,
          };
        } else {
          // Fallback for any other event type
          const eventDate = hist.created_at
            ? new Date(hist.created_at).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];

          return {
            id: index + 1,
            date: eventDate,
            eventType: hist.event_type || 'unknown',
            title: hist.event_type || 'Event',
            description: hist.event_description || 'Event occurred',
            details: null,
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

  async getAllPropertiesNoAuth(): Promise<Property[]> {
    return this.propertyRepository.find({
      order: { created_at: 'DESC' },
    });
  }

  async forceDeleteProperty(propertyId: string): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Check if property exists
      const property = await queryRunner.manager.findOne(Property, {
        where: { id: propertyId },
      });

      if (!property) {
        throw new HttpException('Property not found', HttpStatus.NOT_FOUND);
      }

      // Delete all associated records in order (respecting foreign key constraints)

      // 1. Delete scheduled move-outs
      await queryRunner.manager.delete('scheduled_move_outs', {
        property_id: propertyId,
      });

      // 2. Delete notice agreements
      await queryRunner.manager.delete('notice_agreement', {
        property_id: propertyId,
      });

      // 3. Delete property history
      await queryRunner.manager.delete(PropertyHistory, {
        property_id: propertyId,
      });

      // 4. Delete property tenants
      await queryRunner.manager.delete(PropertyTenant, {
        property_id: propertyId,
      });

      // 5. Delete rents
      await queryRunner.manager.delete('rents', {
        property_id: propertyId,
      });

      // 6. Delete service requests
      await queryRunner.manager.delete('service_requests', {
        property_id: propertyId,
      });

      // 7. Delete KYC applications
      await queryRunner.manager.delete('kyc_applications', {
        property_id: propertyId,
      });

      // 8. Delete KYC links
      await queryRunner.manager.delete('kyc_links', {
        property_id: propertyId,
      });

      // 9. Remove property from property groups
      const propertyGroups = await queryRunner.manager.find(PropertyGroup, {
        where: {},
      });

      for (const group of propertyGroups) {
        if (group.property_ids.includes(propertyId)) {
          group.property_ids = group.property_ids.filter(
            (id) => id !== propertyId,
          );
          await queryRunner.manager.save(PropertyGroup, group);
        }
      }

      // 10. Finally, delete the property itself (hard delete)
      await queryRunner.manager.delete(Property, { id: propertyId });

      await queryRunner.commitTransaction();

      console.log(
        `✅ Force deleted property ${propertyId} and all associated records`,
      );
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('❌ Force delete failed:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        `Failed to force delete property: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      await queryRunner.release();
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

    // Check if the move-out date is in the future
    const moveOutDate = new Date(move_out_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    moveOutDate.setHours(0, 0, 0, 0);

    if (moveOutDate > today) {
      // Schedule the move-out for the future
      return this.scheduleMoveTenantOut(moveOutData, requesterId);
    }

    // Process immediate move-out
    return this.processMoveTenantOut(moveOutData, requesterId);
  }

  private async scheduleMoveTenantOut(
    moveOutData: MoveTenantOutDto,
    requesterId?: string,
  ) {
    const { property_id, tenant_id, move_out_date } = moveOutData;

    // Validate that tenant is currently assigned to the property
    const propertyTenant = await this.propertyTenantRepository.findOne({
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

    // Check if there's already a scheduled move-out for this tenant/property
    const existingScheduled = await this.scheduledMoveOutRepository.findOne({
      where: {
        property_id,
        tenant_id,
        processed: false,
      },
    });

    if (existingScheduled) {
      // Update the existing scheduled move-out
      await this.scheduledMoveOutRepository.update(existingScheduled.id, {
        effective_date: DateService.getStartOfTheDay(move_out_date),
        move_out_reason: moveOutData?.move_out_reason || null,
        owner_comment: moveOutData?.owner_comment || null,
        tenant_comment: moveOutData?.tenant_comment || null,
      });

      return {
        message: 'Move-out date updated successfully',
        scheduled: true,
        effective_date: move_out_date,
      };
    } else {
      // Create new scheduled move-out
      const scheduledMoveOut = await this.scheduledMoveOutRepository.save({
        property_id,
        tenant_id,
        effective_date: DateService.getStartOfTheDay(move_out_date),
        move_out_reason: moveOutData?.move_out_reason || null,
        owner_comment: moveOutData?.owner_comment || null,
        tenant_comment: moveOutData?.tenant_comment || null,
        processed: false,
      });

      return {
        message: 'Move-out scheduled successfully',
        scheduled: true,
        effective_date: move_out_date,
        id: scheduledMoveOut.id,
      };
    }
  }

  private async processMoveTenantOut(
    moveOutData: MoveTenantOutDto,
    requesterId?: string,
  ) {
    const { property_id, tenant_id, move_out_date } = moveOutData;

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

      // Get the active rent record BEFORE deactivating (needed for PropertyHistory creation)
      const activeRent = await queryRunner.manager.findOne(Rent, {
        where: {
          property_id,
          tenant_id,
          rent_status: RentStatusEnum.ACTIVE,
        },
      });

      // If no active rent exists, we still need to clean up the PropertyTenant relationship
      // This handles cases where data is inconsistent (PropertyTenant exists but no Rent)
      const hasActiveRent = !!activeRent;

      // Deactivate the rent record (if it exists)
      if (hasActiveRent) {
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
      }

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

        if (!hasActiveRent) {
          // No rent record exists - this is a data inconsistency
          // Create a minimal PropertyHistory record with placeholder data
          console.warn(
            `No active rent found for tenant ${tenant_id} in property ${property_id}. Creating PropertyHistory with default values.`,
          );

          propertyHistory = await queryRunner.manager.save(PropertyHistory, {
            property_id,
            tenant_id,
            move_in_date: DateService.getStartOfTheDay(new Date()),
            monthly_rent: 0, // No rent data available
            owner_comment: 'Auto-generated: No rent record found',
            tenant_comment: null,
            move_out_date: null,
            move_out_reason: null,
          });
        } else {
          // Use the activeRent we already fetched earlier
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
        }

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

  async processScheduledMoveOuts() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find all scheduled move-outs that are due today or overdue
    const scheduledMoveOuts = await this.scheduledMoveOutRepository.find({
      where: {
        processed: false,
      },
    });

    const dueScheduledMoveOuts = scheduledMoveOuts.filter((scheduled) => {
      const effectiveDate = new Date(scheduled.effective_date);
      effectiveDate.setHours(0, 0, 0, 0);
      return effectiveDate <= today;
    });

    console.log(
      `Processing ${dueScheduledMoveOuts.length} scheduled move-outs`,
    );

    for (const scheduled of dueScheduledMoveOuts) {
      try {
        // Process the move-out
        await this.processMoveTenantOut({
          property_id: scheduled.property_id,
          tenant_id: scheduled.tenant_id,
          move_out_date: scheduled.effective_date.toISOString().split('T')[0],
          move_out_reason: scheduled.move_out_reason || undefined,
          owner_comment: scheduled.owner_comment || undefined,
          tenant_comment: scheduled.tenant_comment || undefined,
        });

        // Mark as processed
        await this.scheduledMoveOutRepository.update(scheduled.id, {
          processed: true,
          processed_at: new Date(),
        });

        console.log(
          `Processed scheduled move-out for tenant ${scheduled.tenant_id} from property ${scheduled.property_id}`,
        );
      } catch (error) {
        console.error(
          `Failed to process scheduled move-out ${scheduled.id}:`,
          error,
        );
        // Continue processing other scheduled move-outs even if one fails
      }
    }

    return {
      processed: dueScheduledMoveOuts.length,
      total: scheduledMoveOuts.length,
    };
  }

  async getScheduledMoveOuts(ownerId?: string) {
    const queryBuilder = this.scheduledMoveOutRepository
      .createQueryBuilder('smo')
      .leftJoinAndSelect('smo.property_id', 'property')
      .leftJoinAndSelect('smo.tenant_id', 'tenant')
      .where('smo.processed = :processed', { processed: false });

    if (ownerId) {
      queryBuilder.andWhere('property.owner_id = :ownerId', { ownerId });
    }

    return queryBuilder.getMany();
  }

  async cancelScheduledMoveOut(scheduleId: string, ownerId?: string) {
    const scheduled = await this.scheduledMoveOutRepository.findOne({
      where: { id: scheduleId, processed: false },
      relations: ['property'],
    });

    if (!scheduled) {
      throw new HttpException(
        'Scheduled move-out not found or already processed',
        HttpStatus.NOT_FOUND,
      );
    }

    // If ownerId is provided, validate ownership
    if (ownerId) {
      const property = await this.propertyRepository.findOneBy({
        id: scheduled.property_id,
      });
      if (!property || property.owner_id !== ownerId) {
        throw new ForbiddenException(
          'You are not authorized to cancel this scheduled move-out',
        );
      }
    }

    await this.scheduledMoveOutRepository.delete(scheduleId);
    return { message: 'Scheduled move-out cancelled successfully' };
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
    const propertyIdsToUpdate: { id: string; status: PropertyStatusEnum }[] =
      [];
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
        propertyIdsToUpdate.push({ id: property.id, status: correctStatus });
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
              event_type: 'tenancy_record',
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

    // Batch update operations using query builder to avoid cascading to relations
    if (propertyIdsToUpdate.length > 0) {
      for (const { id, status } of propertyIdsToUpdate) {
        await this.propertyRepository.update(id, { property_status: status });
      }
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

  /**
   * Fix tenant data leakage issue by analyzing and reporting data consistency
   * This method provides information about the fix that has been applied
   */
  async fixTenantDataLeakage(landlordId?: string): Promise<{
    message: string;
    fixed: boolean;
    details: any;
  }> {
    console.log('🔧 Analyzing tenant data leakage fix...', { landlordId });

    try {
      // Get tenant KYC records (filtered by landlord if provided)
      let kycQuery = this.tenantKycRepository
        .createQueryBuilder('kyc')
        .leftJoinAndSelect('kyc.user', 'user');

      if (landlordId) {
        kycQuery = kycQuery.where('kyc.admin_id = :landlordId', { landlordId });
      }

      const allTenantKyc = await kycQuery.getMany();

      // Group by user_id to find users with multiple KYC records
      const userKycMap = new Map<string, TenantKyc[]>();
      allTenantKyc.forEach((kyc) => {
        if (kyc.user_id) {
          if (!userKycMap.has(kyc.user_id)) {
            userKycMap.set(kyc.user_id, []);
          }
          userKycMap.get(kyc.user_id)!.push(kyc);
        }
      });

      // Find users with multiple KYC records across different landlords
      const duplicateUsers = Array.from(userKycMap.entries()).filter(
        ([_, records]) => records.length > 1,
      );

      let crossPropertyUsers = 0;
      for (const [userId, records] of duplicateUsers) {
        const uniqueAdminIds = new Set(records.map((r) => r.admin_id));
        if (uniqueAdminIds.size > 1) {
          crossPropertyUsers++;
        }
      }

      const analysis = {
        totalTenantKycRecords: allTenantKyc.length,
        usersWithMultipleRecords: duplicateUsers.length,
        usersAcrossMultipleLandlords: crossPropertyUsers,
        fixApplied: true,
        fixDescription: [
          'Database queries have been updated to filter tenant_kyc records by property owner (admin_id)',
          'getPropertyDetails() now uses: tenantKyc.admin_id = property.owner_id',
          'getPropertyById() now uses: tenantKyc.admin_id = property.owner_id',
          'This prevents tenant data from other properties from being displayed',
        ],
        impact:
          crossPropertyUsers > 0
            ? `Fixed potential data leakage for ${crossPropertyUsers} users who have KYC records across multiple landlords`
            : 'No cross-landlord data leakage detected',
      };

      console.log('✅ Analysis complete:', analysis);

      return {
        message:
          'Tenant data leakage analysis completed. Database queries have been fixed.',
        fixed: true,
        details: analysis,
      };
    } catch (error) {
      console.error('❌ Analysis failed:', error);
      return {
        message: `Analysis failed: ${error.message}`,
        fixed: false,
        details: { error: error.message },
      };
    }
  }

  /**
   * Quick check to verify tenant data fix is working for a landlord
   */
  async checkTenantDataFix(landlordId: string): Promise<{
    message: string;
    isFixed: boolean;
    details: any;
  }> {
    console.log('🔍 Quick check for tenant data fix...', { landlordId });

    try {
      // Get a sample of properties with tenants for this landlord
      const properties = await this.propertyRepository
        .createQueryBuilder('property')
        .leftJoinAndSelect(
          'property.property_tenants',
          'propertyTenant',
          'propertyTenant.status = :tenantStatus',
          { tenantStatus: 'active' },
        )
        .leftJoinAndSelect('propertyTenant.tenant', 'tenant')
        .leftJoinAndSelect('tenant.user', 'tenantUser')
        .leftJoinAndSelect(
          'tenantUser.tenant_kycs',
          'tenantKyc',
          'tenantKyc.admin_id = property.owner_id',
        )
        .where('property.owner_id = :landlordId', { landlordId })
        .limit(10) // Check first 10 properties
        .getMany();

      const occupiedProperties = properties.filter(
        (p) => p.property_tenants && p.property_tenants.length > 0,
      );

      let correctlyFilteredCount = 0;
      let totalTenantsChecked = 0;
      const sampleResults: any[] = [];

      for (const property of occupiedProperties) {
        for (const propertyTenant of property.property_tenants) {
          totalTenantsChecked++;
          const tenant = propertyTenant.tenant;

          if (tenant && tenant.user) {
            // The fix should ensure that tenant_kycs is either empty or belongs to this landlord
            const tenantKyc = tenant.user.tenant_kycs?.[0];

            if (!tenantKyc || tenantKyc.admin_id === landlordId) {
              correctlyFilteredCount++;
              sampleResults.push({
                propertyId: property.id,
                propertyName: property.name,
                tenantName: `${tenant.user.first_name} ${tenant.user.last_name}`,
                kycFiltered: tenantKyc
                  ? 'Correctly filtered to this landlord'
                  : 'No KYC data (expected)',
                status: '✅ Correct',
              });
            } else {
              sampleResults.push({
                propertyId: property.id,
                propertyName: property.name,
                tenantName: `${tenant.user.first_name} ${tenant.user.last_name}`,
                kycFiltered: `❌ KYC belongs to different landlord: ${tenantKyc.admin_id}`,
                status: '❌ Issue detected',
              });
            }
          }
        }
      }

      const isFixed = correctlyFilteredCount === totalTenantsChecked;

      return {
        message: isFixed
          ? '✅ Tenant data fix is working correctly!'
          : '❌ Issues detected - tenant data may still be leaking',
        isFixed,
        details: {
          landlordId,
          propertiesChecked: properties.length,
          occupiedProperties: occupiedProperties.length,
          totalTenantsChecked,
          correctlyFilteredCount,
          fixEffectiveness:
            totalTenantsChecked > 0
              ? `${Math.round((correctlyFilteredCount / totalTenantsChecked) * 100)}%`
              : 'N/A',
          sampleResults: sampleResults.slice(0, 5), // Show first 5 results
          recommendations: isFixed
            ? [
                'The fix is working correctly',
                'Clear browser cache if you still see issues',
              ]
            : [
                'Database queries may need additional fixes',
                'Contact technical support',
              ],
        },
      };
    } catch (error) {
      console.error('❌ Check failed:', error);
      return {
        message: `Check failed: ${error.message}`,
        isFixed: false,
        details: { error: error.message },
      };
    }
  }

  /**
   * Deep diagnostic to find the exact source of tenant data leakage
   */
  async diagnoseTenantDataLeakage(landlordId: string): Promise<{
    message: string;
    issues: any[];
    details: any;
  }> {
    console.log('🔍 Deep diagnostic for tenant data leakage...', {
      landlordId,
    });

    try {
      const issues: any[] = [];

      // 1. Check for duplicate tenant assignments (same tenant on multiple properties)
      const duplicateAssignments = await this.propertyTenantRepository
        .createQueryBuilder('pt')
        .leftJoinAndSelect('pt.property', 'property')
        .leftJoinAndSelect('pt.tenant', 'tenant')
        .leftJoinAndSelect('tenant.user', 'user')
        .where('pt.status = :status', { status: 'active' })
        .andWhere('property.owner_id = :landlordId', { landlordId })
        .getMany();

      // Group by tenant to find duplicates
      const tenantAssignments = new Map();
      duplicateAssignments.forEach((assignment) => {
        const tenantId = assignment.tenant.id;
        if (!tenantAssignments.has(tenantId)) {
          tenantAssignments.set(tenantId, []);
        }
        tenantAssignments.get(tenantId).push(assignment);
      });

      // Find tenants assigned to multiple properties
      const duplicateTenants = Array.from(tenantAssignments.entries()).filter(
        ([_, assignments]) => assignments.length > 1,
      );

      duplicateTenants.forEach(([tenantId, assignments]) => {
        const tenantName = `${assignments[0].tenant.user.first_name} ${assignments[0].tenant.user.last_name}`;
        const propertyNames = assignments.map((a) => a.property.name);

        issues.push({
          type: 'DUPLICATE_TENANT_ASSIGNMENT',
          severity: 'HIGH',
          tenantId,
          tenantName,
          assignedToProperties: propertyNames,
          propertyIds: assignments.map((a) => a.property.id),
          message: `Tenant "${tenantName}" is assigned to multiple properties: ${propertyNames.join(', ')}`,
        });
      });

      // 2. Check for orphaned rent records
      const orphanedRents = await this.dataSource.query(
        `
        SELECT r.*, p.name as property_name, u.first_name, u.last_name
        FROM rents r
        LEFT JOIN properties p ON r.property_id = p.id
        LEFT JOIN accounts a ON r.tenant_id = a.id
        LEFT JOIN users u ON a."userId" = u.id
        WHERE r.rent_status = 'active' 
        AND p.owner_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM property_tenants pt 
          WHERE pt.property_id = r.property_id 
          AND pt.tenant_id = r.tenant_id 
          AND pt.status = 'active'
        )
      `,
        [landlordId],
      );

      orphanedRents.forEach((rent) => {
        issues.push({
          type: 'ORPHANED_RENT_RECORD',
          severity: 'MEDIUM',
          rentId: rent.id,
          propertyId: rent.property_id,
          propertyName: rent.property_name,
          tenantName: `${rent.first_name} ${rent.last_name}`,
          message: `Active rent record exists without corresponding property-tenant assignment`,
        });
      });

      // 3. Test the actual getAllProperties method that's causing issues
      const allPropertiesResult = await this.getAllProperties({
        owner_id: landlordId,
        page: 1,
        size: 50, // Check more properties
      });

      const propertiesWithTenants = allPropertiesResult.properties.filter(
        (p) =>
          p.rents &&
          p.rents.length > 0 &&
          p.rents.some((r) => r.rent_status === 'active'),
      );

      // 4. Check for tenant_kyc records that might be causing confusion
      const problematicKycRecords = await this.dataSource.query(
        `
        SELECT tk.*, u.first_name, u.last_name, u.email, u.phone_number,
               p.id as property_id, p.name as property_name
        FROM tenant_kyc tk
        LEFT JOIN users u ON tk.user_id = u.id
        LEFT JOIN properties p ON tk.admin_id = p.owner_id
        WHERE tk.admin_id != $1
        AND u.id IN (
          SELECT DISTINCT u2.id 
          FROM users u2
          JOIN accounts a ON u2.id = a."userId"
          JOIN property_tenants pt ON a.id = pt.tenant_id
          JOIN properties p2 ON pt.property_id = p2.id
          WHERE p2.owner_id = $1 AND pt.status = 'active'
        )
      `,
        [landlordId],
      );

      problematicKycRecords.forEach((record) => {
        issues.push({
          type: 'CROSS_LANDLORD_KYC_RECORD',
          severity: 'HIGH',
          tenantName: `${record.first_name} ${record.last_name}`,
          kycAdminId: record.admin_id,
          currentLandlordId: landlordId,
          message: `Tenant has KYC record with different landlord (${record.admin_id}) but is assigned to your property`,
        });
      });

      return {
        message: `Found ${issues.length} potential issues causing tenant data leakage`,
        issues,
        details: {
          landlordId,
          totalPropertiesChecked: allPropertiesResult.properties.length,
          propertiesWithTenants: propertiesWithTenants.length,
          duplicateTenantsFound: duplicateTenants.length,
          orphanedRentsFound: orphanedRents.length,
          crossLandlordKycRecords: problematicKycRecords.length,
          samplePropertiesWithTenants: propertiesWithTenants
            .slice(0, 5)
            .map((p) => ({
              id: p.id,
              name: p.name,
              activeRents: p.rents
                .filter((r) => r.rent_status === 'active')
                .map((r) => ({
                  tenantName: `${r.tenant.user.first_name} ${r.tenant.user.last_name}`,
                  tenantId: r.tenant.id,
                  hasFilteredKyc: !!r.tenant.user.tenant_kycs?.[0],
                  kycAdminId: r.tenant.user.tenant_kycs?.[0]?.admin_id,
                })),
            })),
        },
      };
    } catch (error) {
      console.error('❌ Diagnostic failed:', error);
      return {
        message: `Diagnostic failed: ${error.message}`,
        issues: [],
        details: { error: error.message },
      };
    }
  }

  /**
   * Clean up duplicate tenant assignments for a specific landlord
   */
  async cleanupDuplicateTenantAssignments(landlordId: string): Promise<{
    message: string;
    success: boolean;
    details: any;
  }> {
    console.log('🧹 Cleaning up duplicate tenant assignments...', {
      landlordId,
    });

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Find tenants with multiple active assignments
      const duplicateAssignments = await queryRunner.manager.query(
        `
        SELECT 
          u.id as user_id,
          u.first_name,
          u.last_name,
          a.id as account_id,
          COUNT(pt.property_id) as property_count,
          ARRAY_AGG(pt.property_id) as property_ids,
          ARRAY_AGG(p.name) as property_names
        FROM property_tenants pt
        JOIN accounts a ON pt.tenant_id = a.id
        JOIN users u ON a."userId" = u.id
        JOIN properties p ON pt.property_id = p.id
        WHERE pt.status = 'active' 
        AND p.owner_id = $1
        GROUP BY u.id, u.first_name, u.last_name, a.id
        HAVING COUNT(pt.property_id) > 1
      `,
        [landlordId],
      );

      let cleanedUpTenants = 0;
      let propertiesFreed = 0;
      const cleanupDetails: any[] = [];

      for (const duplicate of duplicateAssignments) {
        const tenantName = `${duplicate.first_name} ${duplicate.last_name}`;
        const propertyIds = duplicate.property_ids;
        const propertyNames = duplicate.property_names;

        console.log(
          `Cleaning up duplicate assignments for ${tenantName}:`,
          propertyNames,
        );

        // Keep the most recent assignment, deactivate others
        const assignments = await queryRunner.manager.query(
          `
          SELECT pt.id, pt.property_id, p.name, pt.created_at
          FROM property_tenants pt
          JOIN properties p ON pt.property_id = p.id
          WHERE pt.tenant_id = $1 
          AND pt.status = 'active'
          AND p.owner_id = $2
          ORDER BY pt.created_at DESC
        `,
          [duplicate.account_id, landlordId],
        );

        if (assignments.length > 1) {
          // Keep the most recent, deactivate the rest
          const [mostRecent, ...oldAssignments] = assignments;

          for (const oldAssignment of oldAssignments) {
            // Deactivate property-tenant relationship
            await queryRunner.manager.update(
              'property_tenants',
              { id: oldAssignment.id },
              { status: 'inactive' },
            );

            // Deactivate corresponding rent records
            await queryRunner.manager.update(
              'rents',
              {
                tenant_id: duplicate.account_id,
                property_id: oldAssignment.property_id,
                rent_status: 'active',
              },
              { rent_status: 'inactive' },
            );

            // Set property back to vacant
            await queryRunner.manager.update(
              'properties',
              { id: oldAssignment.property_id },
              { property_status: 'vacant' },
            );

            propertiesFreed++;
            console.log(`Freed property: ${oldAssignment.name}`);
          }

          // Ensure the kept property is marked as occupied
          await queryRunner.manager.update(
            'properties',
            { id: mostRecent.property_id },
            { property_status: 'occupied' },
          );

          cleanupDetails.push({
            tenantName,
            keptProperty: mostRecent.name,
            freedProperties: oldAssignments.map((a) => a.name),
            totalAssignments: assignments.length,
            cleanedUp: oldAssignments.length,
          });

          cleanedUpTenants++;
        }
      }

      await queryRunner.commitTransaction();

      const message = `Cleanup completed: ${cleanedUpTenants} tenants with duplicate assignments fixed, ${propertiesFreed} properties freed`;
      console.log('✅ Cleanup completed:', message);

      return {
        message,
        success: true,
        details: {
          landlordId,
          cleanedUpTenants,
          propertiesFreed,
          cleanupDetails,
        },
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('❌ Cleanup failed:', error);
      return {
        message: `Cleanup failed: ${error.message}`,
        success: false,
        details: { error: error.message },
      };
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Fix orphaned rent records (rents without valid tenant data)
   */
  async fixOrphanedRentRecords(landlordId: string): Promise<{
    message: string;
    success: boolean;
    details: any;
  }> {
    console.log('🔧 Fixing orphaned rent records...', { landlordId });

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Find rent records with missing or invalid tenant data
      const orphanedRents = await queryRunner.manager.query(
        `
        SELECT 
          r.id as rent_id,
          r.property_id,
          r.tenant_id,
          r.rental_price,
          p.name as property_name,
          a.id as account_id,
          u.id as user_id,
          u.first_name,
          u.last_name
        FROM rents r
        JOIN properties p ON r.property_id = p.id
        LEFT JOIN accounts a ON r.tenant_id = a.id
        LEFT JOIN users u ON a."userId" = u.id
        WHERE r.rent_status = 'active'
        AND p.owner_id = $1
        AND (a.id IS NULL OR u.id IS NULL OR u.first_name IS NULL)
      `,
        [landlordId],
      );

      let fixedRents = 0;
      let propertiesFreed = 0;
      const fixDetails: any[] = [];

      for (const orphanedRent of orphanedRents) {
        console.log(
          `Fixing orphaned rent for property: ${orphanedRent.property_name}`,
        );

        // Deactivate the orphaned rent record
        await queryRunner.manager.update(
          'rents',
          { id: orphanedRent.rent_id },
          { rent_status: 'inactive' },
        );

        // Set property back to vacant
        await queryRunner.manager.update(
          'properties',
          { id: orphanedRent.property_id },
          { property_status: 'vacant' },
        );

        // Remove any property-tenant assignments for this orphaned rent
        await queryRunner.manager.update(
          'property_tenants',
          {
            property_id: orphanedRent.property_id,
            tenant_id: orphanedRent.tenant_id,
            status: 'active',
          },
          { status: 'inactive' },
        );

        fixDetails.push({
          propertyName: orphanedRent.property_name,
          rentId: orphanedRent.rent_id,
          tenantId: orphanedRent.tenant_id,
          issue: orphanedRent.account_id
            ? 'Missing user data'
            : 'Missing account',
          action: 'Deactivated rent and set property to vacant',
        });

        fixedRents++;
        propertiesFreed++;
      }

      await queryRunner.commitTransaction();

      const message = `Fixed ${fixedRents} orphaned rent records, freed ${propertiesFreed} properties`;
      console.log('✅ Orphaned rent cleanup completed:', message);

      return {
        message,
        success: true,
        details: {
          landlordId,
          fixedRents,
          propertiesFreed,
          fixDetails,
        },
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('❌ Orphaned rent cleanup failed:', error);
      return {
        message: `Cleanup failed: ${error.message}`,
        success: false,
        details: { error: error.message },
      };
    } finally {
      await queryRunner.release();
    }
  }
}

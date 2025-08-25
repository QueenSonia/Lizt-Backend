import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateServiceRequestDto,
  ServiceRequestFilter,
  ServiceRequestStatusEnum,
} from './dto/create-service-request.dto';
import {
  UpdateServiceRequestDto,
  UpdateServiceRequestResponseDto,
} from './dto/update-service-request.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { ServiceRequest } from './entities/service-request.entity';
import { In, Repository } from 'typeorm';
import { buildServiceRequestFilter } from 'src/filters/query-filter';
import { UtilService } from 'src/utils/utility-service';
import { config } from 'src/config';
import { TenantStatusEnum } from 'src/properties/dto/create-property.dto';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AutoServiceRequest,
  ServiceRequestPriority,
  ServiceRequestSource,
  ServiceRequestStatus,
} from './entities/auto-service-request.entity';
import { Team } from 'src/users/entities/team.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { RolesEnum } from 'src/base.entity';

export interface TawkWebhookPayload {
  event: 'chat:start' | 'chat:end';
  chatId: string;
  time: string;
  message?: {
    text: string;
    type: string;
    sender: {
      type: 'visitor' | 'agent';
    };
  };
  visitor: {
    name: string;
    email: string;
    city: string;
    country: string;
  };
  property: {
    id: string;
    name: string;
  };
}

@Injectable()
export class ServiceRequestsService {
  constructor(
    @InjectRepository(ServiceRequest)
    private readonly serviceRequestRepository: Repository<ServiceRequest>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
     @InjectRepository(TeamMember)
    private readonly teamMemberRepository: Repository<TeamMember>,
     private readonly eventEmitter: EventEmitter2,

  ) {}



  private generateTitle(payload: TawkWebhookPayload): string {
    const eventType =
      payload.event === 'chat:start' ? 'New Chat' : 'Chat Ended';
    return `${eventType} - ${payload.property.name}`;
  }

  private generateDescription(payload: TawkWebhookPayload): string {
    const eventType = payload.event === 'chat:start' ? 'started' : 'ended';
    let description = `Chat ${eventType} on ${payload.property.name} at ${new Date(payload.time).toLocaleString()}.\n\n`;

    description += `Visitor: ${payload.visitor.name}\n`;
    description += `Email: ${payload.visitor.email}\n`;
    description += `Location: ${payload.visitor.city}, ${payload.visitor.country}\n`;

    if (payload.message?.text) {
      description += `\nInitial message: "${payload.message.text}"`;
    }

    return description;
  }

 async createServiceRequest(
  data: CreateServiceRequestDto,
): Promise<any> {
  const tenantExistInProperty = await this.propertyTenantRepository.findOne({
    where: {
      tenant_id: data.tenant_id,
      // property_id: data.property_id,
      // status: TenantStatusEnum.ACTIVE,
    },
    relations: ['tenant', 'property'],
  });

  if (!tenantExistInProperty?.id) {
    throw new HttpException(
      'You are not currently renting this property',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  // 1. Find all facility managers for the property's team
  const facilityManagers = await this.teamMemberRepository.find({
    where: {
      team: { creatorId: tenantExistInProperty.property.owner_id },
      role: RolesEnum.FACILITY_MANAGER,
    },
    relations: ['team',  'account', 'account.user'],
  });

  if (!facilityManagers.length) {
    throw new HttpException(
      'No facility manager assigned to this property yet',
      HttpStatus.BAD_REQUEST,
    );
  }

  // 2. Pick a random facility manager
  const randomIndex = Math.floor(Math.random() * facilityManagers.length);
  const selectedManager = facilityManagers[randomIndex];

  const requestId = UtilService.generateServiceRequestId();

  // 3. Save the service request with the selected manager
  // const serviceRequest = await this.serviceRequestRepository.save({
  //   ...data,
  //   issue_images: data?.issue_images || null,
  //   status: data?.status || ServiceRequestStatusEnum.PENDING,
  //   request_id: requestId,
  //   assigned_to: selectedManager.id, // 👈 store assigned manager
  // });
   const request = this.serviceRequestRepository.create({
        request_id: requestId,
        tenant_id: tenantExistInProperty.tenant.id,
        property_id: tenantExistInProperty.property?.id,
        tenant_name: tenantExistInProperty.tenant.profile_name,
        property_name: tenantExistInProperty.property?.name,
        issue_category: 'service',
        date_reported: new Date(),
        description: data.text,
        status: ServiceRequestStatusEnum.PENDING,
      });

      await this.serviceRequestRepository.save(request);

  this.eventEmitter.emit('service.created', {
    user_id: tenantExistInProperty.tenant.id,
    property_id: tenantExistInProperty.property?.id,
    tenant_name: tenantExistInProperty.tenant.profile_name,
    property_name: tenantExistInProperty.property.name,
    assigned_to: selectedManager.accountId,
  });

  let result = {
    ...request,
    property_name: tenantExistInProperty.property?.name,
    property_location: tenantExistInProperty.property?.location,
    facility_manager_phone: UtilService.normalizePhoneNumber(selectedManager.account.user.phone_number),
  }

  return result;
}

  async getAllServiceRequests(
    user_id: string,
    queryParams: ServiceRequestFilter,
  ) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const query = await buildServiceRequestFilter(queryParams);

    const [serviceRequests, count] =
      await this.serviceRequestRepository.findAndCount({
        where: {
          ...query,
          property: {
            owner_id: user_id,
          },
        },
        relations: ['tenant', 'property'],
        skip,
        take: size,
        order: { created_at: 'DESC' },
      });

    const totalPages = Math.ceil(count / size);
    return {
      service_requests: serviceRequests,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages: Math.ceil(count / size),
        hasNextPage: page < totalPages,
      },
    };
  }

  async getServiceRequestById(id: string): Promise<any> {
    const serviceRequest = await this.serviceRequestRepository.findOne({
      where: { id },
      relations: ['tenant', 'property'],
    });
    if (!serviceRequest?.id) {
      throw new HttpException(
        `Service request with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return serviceRequest;
  }

  async getServiceRequestByTenant(id: string, status?: string) {
    const statuses = Array.isArray(status)
      ? status
      : status
        ? [status]
        : ['pending', 'in_progress', 'urgent', 'resolved'];

    const serviceRequest = await this.serviceRequestRepository.find({
      where: {
        tenant_id: id,
        status: In(statuses),
      },
      relations: ['tenant', 'property'],
    });
    // if (!serviceRequest?.id) {
    //   throw new HttpException(
    //     `Service request with id: ${id} not found`,
    //     HttpStatus.NOT_FOUND,
    //   );
    // }
    return serviceRequest;
  }

  async updateServiceRequestById(
    id: string,
    data: UpdateServiceRequestResponseDto,
  ) {
    return this.serviceRequestRepository.update(id, data);
  }

  async deleteServiceRequestById(id: string) {
    return this.serviceRequestRepository.delete(id);
  }

  async getPendingAndUrgentRequests(
    queryParams: ServiceRequestFilter,
    owner_id: string,
  ) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const query = await buildServiceRequestFilter(queryParams);
    const [serviceRequests, count] =
      await this.serviceRequestRepository.findAndCount({
        where: {
          ...query,
          property: { owner_id },
          status: In(['pending', 'urgent']),
        },
        relations: ['tenant', 'property'],
        skip,
        take: size,
        order: { created_at: 'DESC' },
      });

    const totalPages = Math.ceil(count / size);
    return {
      service_requests: serviceRequests,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  async getServiceRequestsByTenant(
    tenant_id: string,
    // property_id: string,
    queryParams: ServiceRequestFilter,
  ) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;
    const [serviceRequests, count] =
      await this.serviceRequestRepository.findAndCount({
        where: {
          tenant_id,
        },
        relations: ['tenant', 'property'],
        skip,
        take: size,
        order: { created_at: 'DESC' },
      });
    const totalPages = Math.ceil(count / size);
    return {
      service_requests: serviceRequests,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  async getRequestById(id: string): Promise<ServiceRequest> {
    const request = await this.serviceRequestRepository.findOne({
      where: { id },
      relations: ['messages'],
    });

    if (!request) {
      throw new NotFoundException('Service request not found');
    }

    return request;
  }
}

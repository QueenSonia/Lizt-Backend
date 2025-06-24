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
    private readonly eventEmitter: EventEmitter2,
    @InjectRepository(AutoServiceRequest)
    private readonly autoServiceRequestRepository: Repository<AutoServiceRequest>,
  ) {}

  async tawkServiceRequest(
    payload: TawkWebhookPayload,
  ): Promise<AutoServiceRequest> {
    try {
      // Find the property tenant based on the property ID from Tawk
      const propertyTenant = await this.propertyTenantRepository.findOne({
        where: {
          // Assuming you have a property relation or property_id field
          property: { id: payload.property.id },
          // Or: propertyId: payload.property.id
        },
      });

      if (!propertyTenant) {
        throw new Error(
          `Property tenant not found for property ID: ${payload.property.id}`,
        );
      }

      // Create service request based on chat event
      const autoServiceRequest = new AutoServiceRequest();

      // Set basic properties
      autoServiceRequest.title = this.generateTitle(payload);
      autoServiceRequest.description = this.generateDescription(payload);
      autoServiceRequest.status = ServiceRequestStatus.OPEN; // or whatever your default status is
      autoServiceRequest.priority = ServiceRequestPriority.MEDIUM; // default priority
      autoServiceRequest.source = ServiceRequestSource.TAWK_CHAT;
      autoServiceRequest.externalId = payload.chatId;
      autoServiceRequest.propertyTenant = propertyTenant;

      // Set visitor/customer information
      autoServiceRequest.customerName = payload.visitor.name;
      autoServiceRequest.customerEmail = payload.visitor.email;
      autoServiceRequest.customerLocation = `${payload.visitor.city}, ${payload.visitor.country}`;

      // Set timestamps
      autoServiceRequest.createdAt = new Date(payload.time);
      autoServiceRequest.updatedAt = new Date();

      // Add event-specific metadata
      autoServiceRequest.metadata = {
        tawkChatId: payload.chatId,
        tawkEvent: payload.event,
        tawkPropertyName: payload.property.name,
        initialMessage: payload.message?.text,
        visitorInfo: {
          city: payload.visitor.city,
          country: payload.visitor.country,
        },
      };

      // Save to database
      const savedautoServiceRequest =
        await this.autoServiceRequestRepository.save(autoServiceRequest);

      // Emit event for other services to listen to
      this.eventEmitter.emit('service-request.created', {
        autoServiceRequest: savedautoServiceRequest,
        source: 'tawk_chat',
        event: payload.event,
      });

      return savedautoServiceRequest;
    } catch (error) {
      console.error('Error creating service request from Tawk webhook:', error);
      throw error;
    }
  }

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
  ): Promise<CreateServiceRequestDto> {
    const tenantExistInProperty = await this.propertyTenantRepository.findOne({
      where: {
        tenant_id: data.tenant_id,
        property_id: data.property_id,
        status: TenantStatusEnum.ACTIVE,
      },
    });

    if (!tenantExistInProperty?.id) {
      throw new HttpException(
        'You are not currently renting this property',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // const lastRequest = await this.serviceRequestRepository.findOne({
    //   where: {
    //     tenant_id: data.tenant_id,
    //     property_id: data.property_id,
    //   },
    //   order: { created_at: 'DESC' },
    // });

    const requestId = UtilService.generateServiceRequestId();

    const serviceRequest = this.serviceRequestRepository.save({
      ...data,
      issue_images: data?.issue_images || null,
      status: data?.status || ServiceRequestStatusEnum.PENDING,
      request_id: requestId,
    });

    this.eventEmitter.emit('service.created', {
      user_id: data.tenant_id,
      property_id: data.property_id,
    });

    return serviceRequest;
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

  async getServiceRequestById(id: string): Promise<CreateServiceRequestDto> {
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

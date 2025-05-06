import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
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

@Injectable()
export class ServiceRequestsService {
  constructor(
    @InjectRepository(ServiceRequest)
    private readonly serviceRequestRepository: Repository<ServiceRequest>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
  ) {}

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

    console.log({requestId})
    return this.serviceRequestRepository.save({
      ...data,
      issue_images: data?.issue_images || null,
      status: data?.status || ServiceRequestStatusEnum.PENDING,
      request_id: requestId,
    });
  }

  async getAllServiceRequests(queryParams: ServiceRequestFilter) {
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
        where: query,
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

  async getServiceRequestsByTenantId(
    tenant_id: string,
    property_id: string,
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
          property_id,
        },
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
}

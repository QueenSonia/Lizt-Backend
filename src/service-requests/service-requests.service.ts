import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  CreateServiceRequestDto,
  ServiceRequestFilter,
} from './dto/create-service-request.dto';
import { UpdateServiceRequestDto } from './dto/update-service-request.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { ServiceRequest } from './entities/service-request.entity';
import { In, Repository } from 'typeorm';
import { buildServiceRequestFilter } from 'src/filters/query-filter';
import { UtilService } from 'src/utils/utility-service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ServiceRequestsService {
  constructor(
    @InjectRepository(ServiceRequest)
    private readonly serviceRequestRepository: Repository<ServiceRequest>,
    private readonly configService: ConfigService,
  ) {}

  async createServiceRequest(
    data: CreateServiceRequestDto,
  ): Promise<CreateServiceRequestDto> {
    const lastRequest = await this.serviceRequestRepository.findOne({
      order: { created_at: 'DESC' },
    });

    const requestId = UtilService.generateServiceRequestId(
      lastRequest?.request_id,
    );
    return this.serviceRequestRepository.save({
      ...data,
      request_id: requestId,
    });
  }

  async getAllServiceRequests(queryParams: ServiceRequestFilter) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : Number(this.configService.get<string>('DEFAULT_PAGE_NO'));
    const size = queryParams?.size
      ? Number(queryParams.size)
      : Number(this.configService.get<string>('DEFAULT_PER_PAGE'));
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

  async updateServiceRequestById(id: string, data: UpdateServiceRequestDto) {
    return this.serviceRequestRepository.update(id, data);
  }

  async deleteServiceRequestById(id: string) {
    return this.serviceRequestRepository.delete(id);
  }

  async getPendingAndUrgentRequests(queryParams: ServiceRequestFilter) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : Number(this.configService.get<string>('DEFAULT_PAGE_NO'));
    const size = queryParams?.size
      ? Number(queryParams.size)
      : Number(this.configService.get<string>('DEFAULT_PER_PAGE'));
    const skip = (page - 1) * size;

    const query = await buildServiceRequestFilter(queryParams);
    const [serviceRequests, count] =
      await this.serviceRequestRepository.findAndCount({
        where: {
          ...query,
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
}

import { ApiProperty } from '@nestjs/swagger';
import { ServiceRequest } from '../entities/service-request.entity';

export class ServiceRequestPaginationMetadataDto {
  @ApiProperty({
    example: 100,
    description: 'The total number of service requests',
  })
  totalRows: number;

  @ApiProperty({
    example: 10,
    description: 'Number of service requests per page',
  })
  perPage: number;

  @ApiProperty({ example: 1, description: 'Current page number' })
  currentPage: number;

  @ApiProperty({ example: 10, description: 'Total number of pages' })
  totalPages: number;

  @ApiProperty({
    example: true,
    description: 'Indicates if there is a next page',
  })
  hasNextPage: boolean;
}

export class ServiceRequestPaginationResponseDto {
  @ApiProperty({
    type: [ServiceRequest],
    description: 'Array of service request objects',
  })
  service_requests: ServiceRequest[];

  @ApiProperty({
    type: ServiceRequestPaginationMetadataDto,
    description: 'Pagination metadata',
  })
  pagination: ServiceRequestPaginationMetadataDto;
}

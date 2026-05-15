import { ApiProperty } from '@nestjs/swagger';
import { MaintenanceRequest } from '../entities/maintenance-request.entity';

export class MaintenanceRequestPaginationMetadataDto {
  @ApiProperty({
    example: 100,
    description: 'The total number of maintenance requests',
  })
  totalRows: number;

  @ApiProperty({
    example: 10,
    description: 'Number of maintenance requests per page',
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

export class MaintenanceRequestPaginationResponseDto {
  @ApiProperty({
    type: [MaintenanceRequest],
    description: 'Array of maintenance request objects',
  })
  maintenance_requests: MaintenanceRequest[];

  @ApiProperty({
    type: MaintenanceRequestPaginationMetadataDto,
    description: 'Pagination metadata',
  })
  pagination: MaintenanceRequestPaginationMetadataDto;
}

// src/property-history/dto/paginate.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { PropertyHistory } from '../entities/property-history.entity';

export class PropertyHistoryPaginationMetadataDto {
  @ApiProperty({
    example: 100,
    description: 'The total number of property histories',
  })
  totalRows: number;

  @ApiProperty({
    example: 10,
    description: 'Number of property histories per page',
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

export class PropertyHistoryPaginationResponseDto {
  @ApiProperty({
    type: [PropertyHistory],
    description: 'Array of property history objects',
  })
  property_histories: PropertyHistory[];

  @ApiProperty({
    type: PropertyHistoryPaginationMetadataDto,
    description: 'Pagination metadata',
  })
  pagination: PropertyHistoryPaginationMetadataDto;
}

import { ApiProperty } from '@nestjs/swagger';
import { CreatePropertyDto } from './create-property.dto';

export class PaginationMetadataDto {
  @ApiProperty({
    example: 100,
    description: 'The total number of properties',
  })
  totalRows: number;

  @ApiProperty({
    example: 10,
    description: 'Number of properties per page',
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

export class PaginationResponseDto {
  @ApiProperty({
    type: [CreatePropertyDto],
    description: 'Array of property objects',
  })
  users: CreatePropertyDto[];

  @ApiProperty({
    type: PaginationMetadataDto,
    description: 'Pagination metadata',
  })
  pagination: PaginationMetadataDto;
}

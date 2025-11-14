import { ApiProperty } from '@nestjs/swagger';
import { CreatePropertyDto } from './create-property.dto';

export class PropertyPaginationMetadataDto {
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

export class PropertyPaginationResponseDto {
  @ApiProperty({
    type: [CreatePropertyDto],
    description: 'Array of property objects',
  })
  users: CreatePropertyDto[];

  @ApiProperty({
    type: PropertyPaginationMetadataDto,
    description: 'Pagination metadata',
  })
  pagination: PropertyPaginationMetadataDto;
}

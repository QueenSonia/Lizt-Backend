import { ApiProperty } from '@nestjs/swagger';
import { CreateNoticeAgreementDto } from './create-notice-agreement.dto';

export class PaginationMetadataDto {
  @ApiProperty({
    example: 100,
    description: 'The total number of notice agreements',
  })
  totalRows: number;

  @ApiProperty({
    example: 10,
    description: 'Number of notice agreements per page',
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
    type: [CreateNoticeAgreementDto],
    description: 'Array of notice agreement objects',
  })
  notice_agreements: CreateNoticeAgreementDto[];

  @ApiProperty({
    type: PaginationMetadataDto,
    description: 'Pagination metadata',
  })
  pagination: PaginationMetadataDto;
}

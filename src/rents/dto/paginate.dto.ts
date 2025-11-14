import { ApiProperty } from '@nestjs/swagger';
import { Rent } from '../entities/rent.entity';

class RentPaginationMetadataDto {
  @ApiProperty()
  totalRows: number;

  @ApiProperty()
  perPage: number;

  @ApiProperty()
  currentPage: number;

  @ApiProperty()
  totalPages: number;

  @ApiProperty()
  hasNextPage: boolean;
}

export class RentPaginationResponseDto {
  @ApiProperty({ type: [Rent] })
  rents: Rent[];

  @ApiProperty({ type: RentPaginationMetadataDto })
  pagination: RentPaginationMetadataDto;
}


import { ApiProperty } from '@nestjs/swagger';
import { Rent } from '../entities/rent.entity';

class PaginationDto {
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

export class PaginationResponseDto {
  @ApiProperty({ type: [Rent] })
  rents: Rent[];

  @ApiProperty({ type: PaginationDto })
  pagination: PaginationDto;
}
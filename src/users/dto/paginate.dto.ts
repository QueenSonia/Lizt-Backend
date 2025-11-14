import { ApiProperty } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

export class UserPaginationMetadataDto {
  @ApiProperty({ example: 100, description: 'The total number of users' })
  totalRows: number;

  @ApiProperty({ example: 10, description: 'Number of users per page' })
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

export class UserPaginationResponseDto {
  @ApiProperty({ type: [CreateUserDto], description: 'Array of user objects' })
  users: CreateUserDto[];

  @ApiProperty({
    type: UserPaginationMetadataDto,
    description: 'Pagination metadata',
  })
  pagination: UserPaginationMetadataDto;
}

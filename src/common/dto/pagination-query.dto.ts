import { Type } from 'class-transformer';
import { IsOptional, IsInt, Min, IsString, MaxLength } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  // Optional free-text search term (used by list endpoints that support it,
  // e.g. the Live Feed / notifications feed). Additive and safe for callers
  // that ignore it.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

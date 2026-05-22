import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SuggestArtisansDto {
  @ApiProperty({
    description:
      'Partial name or phone digits. Matched case-insensitively against artisan name and normalized phone form within the caller\'s team.',
    example: 'eme',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q: string;

  @ApiProperty({ required: false, example: 8, default: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

export class LookupArtisanByPhoneDto {
  @ApiProperty({
    description:
      'Phone in any form (local 0…, +234…, 234…). Server-side normalized before lookup.',
    example: '08012345678',
  })
  @IsString()
  @MinLength(7)
  @MaxLength(32)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  phone: string;
}

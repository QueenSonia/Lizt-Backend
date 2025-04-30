import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateRentIncreaseDto {
  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the property',
  })
  @IsNotEmpty()
  @IsUUID()
  property_id: string;

  @ApiProperty({
    example: 500000,
    description: 'Initial rent amount',
    type: 'integer',
  })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  initial_rent: number;

  @ApiProperty({
    example: 600000,
    description: 'New rent amount after increase',
    type: 'integer',
  })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  current_rent: number;

  @ApiProperty({
    example: 'Annual rent review increase',
    description: 'Reason for rent increase',
  })
  @IsOptional()
  @IsString()
  reason?: string | null;
}

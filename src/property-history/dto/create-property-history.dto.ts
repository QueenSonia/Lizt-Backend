import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { MoveOutReasonEnum } from '../entities/property-history.entity';

export class CreatePropertyHistoryDto {
  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the property',
  })
  @IsNotEmpty()
  @IsString()
  property_id: string;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the tenant',
  })
  @IsNotEmpty()
  @IsString()
  tenant_id: string;

  @ApiProperty({
    example: '2024-01-01',
    description: 'Date tenant moved in',
  })
  @IsString()
  @IsNotEmpty()
  move_in_date: Date | string;

  @ApiProperty({
    example: '2024-12-31',
    description: 'Move out date',
    required: false,
  })
  @IsString()
  @IsOptional()
  move_out_date?: Date | string | null;

  @ApiProperty({
    enum: MoveOutReasonEnum,
    example: MoveOutReasonEnum.LEASE_ENDED,
    description: 'Reason for moving out',
    required: false,
  })
  @IsOptional()
  @IsEnum(MoveOutReasonEnum)
  move_out_reason?: string | null;

  @ApiProperty({
    example: 'Great tenant, always paid on time',
    description: 'Comment from the owner',
    required: false,
  })
  @IsOptional()
  @IsString()
  owner_comment?: string | null;

  @ApiProperty({
    example: 'Wonderful property and management',
    description: 'Comment from the tenant',
    required: false,
  })
  @IsOptional()
  @IsString()
  tenant_comment?: string | null;

  @ApiProperty({
    example: 50000,
    description: 'Monthly rent amount',
    type: 'integer',
  })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  monthly_rent: number;
}

export interface PropertyHistoryFilter {
  tenant_id?: string;
  property_id?: string;
  status?: string;
  move_in_date?: string;
  move_out_date?: string;
  start_date?: string;
  end_date?: string;
  size?: number;
  page?: number;
}

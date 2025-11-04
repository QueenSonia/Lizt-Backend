// src/properties/dto/move-tenant.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { MoveOutReasonEnum } from 'src/property-history/entities/property-history.entity';

export class MoveTenantInDto {
  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the property',
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  property_id: string;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the tenant that is moving in',
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  tenant_id: string;

  @ApiProperty({
    example: '2024-03-21',
    description: 'Date tenant moved in',
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  move_in_date: string;
}

export class MoveTenantOutDto {
  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the property',
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  property_id: string;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the tenant that is moving out',
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  tenant_id: string;

  @ApiProperty({
    example: '2024-03-21',
    description: 'Date tenant moved out or will move out',
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  move_out_date: string;

  @ApiProperty({
    enum: MoveOutReasonEnum,
    example: MoveOutReasonEnum.LEASE_ENDED,
    description: 'Reason for moving out',
    required: false,
  })
  @IsOptional()
  @IsEnum(MoveOutReasonEnum)
  move_out_reason?: string;

  @ApiProperty({
    example: 'Great tenant, always paid on time',
    description: 'Comment from the owner',
    required: false,
  })
  @IsOptional()
  @IsString()
  owner_comment?: string;

  @ApiProperty({
    example: 'Wonderful property and management',
    description: 'Comment from the tenant',
    required: false,
  })
  @IsOptional()
  @IsString()
  tenant_comment?: string;
}

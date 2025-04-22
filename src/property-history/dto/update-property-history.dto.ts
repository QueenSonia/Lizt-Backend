import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreatePropertyHistoryDto } from './create-property-history.dto';
import { MoveOutReasonEnum } from '../entities/property-history.entity';

export class UpdatePropertyHistoryDto extends PartialType(
  CreatePropertyHistoryDto,
) {}

export class UpdatePropertyHistoryResponseDto {
  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the property',
  })
  property_id: string;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the tenant',
  })
  tenant_id: string;

  @ApiProperty({
    example: '2024-01-01',
    description: 'Date tenant moved in',
  })
  move_in_date: Date | string;

  @ApiProperty({
    example: '2024-12-31',
    description: 'Move out date',
    required: false,
  })
  move_out_date?: Date | string | null;

  @ApiProperty({
    enum: MoveOutReasonEnum,
    example: MoveOutReasonEnum.LEASE_ENDED,
    description: 'Reason for moving out',
    required: false,
  })
  move_out_reason?: MoveOutReasonEnum | null;

  @ApiProperty({
    example: 'Great tenant, always paid on time',
    description: 'Comment from the owner',
    required: false,
  })
  owner_comment?: string | null;

  @ApiProperty({
    example: 'Wonderful property and management',
    description: 'Comment from the tenant',
    required: false,
  })
  tenant_comment?: string | null;

  @ApiProperty({
    example: 50000,
    description: 'Monthly rent amount',
    type: 'integer',
  })
  monthly_rent: number;
}

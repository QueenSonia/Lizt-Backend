import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateRentDto } from './create-rent.dto';

export class UpdateRentDto extends PartialType(CreateRentDto) {}

export class UpdateRentResponseDto {
  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the property',
    required: false,
  })
  property_id: string;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the tenant',
    required: false,
  })
  tenant_id: string;

  @ApiProperty({
    example: '500000',
    description: 'Payment of the property',
    required: false,
  })
  amount_paid: number;

  @ApiProperty({
    example: '2024-03-21',
    description: 'Due date for the rent',
    required: false,
  })
  expiry_date: Date;

  // @ApiProperty({
  //   type: 'array',
  //   items: { type: 'string', format: 'binary' },
  //   required: false,
  //   description: 'Rent receipts',
  // })
  // rent_receipts: string[];

  @ApiProperty({
    example: 'Pending',
    description: 'Rent status',
    required: false,
  })
  status: string;
}

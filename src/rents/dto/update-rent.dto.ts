import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateRentDto } from './create-rent.dto';

export class UpdateRentDto extends PartialType(CreateRentDto) {}

export class UpdateRentResponseDto {
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
    example: '500000',
    description: 'Payment of the property',
  })
  amount_paid: number;

  @ApiProperty()
  expiry_date: Date;

  @ApiProperty({
    example: 'Pending',
    description: 'Rent status',
  })
  status: string;
}

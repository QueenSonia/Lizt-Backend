import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateServiceRequestDto } from './create-service-request.dto';

export class UpdateServiceRequestDto extends PartialType(
  CreateServiceRequestDto,
) {}

export class UpdateServiceRequestResponseDto {
  @ApiProperty({ example: 'John Doe', description: 'Name of the tenant' })
  tenant_name: string;

  @ApiProperty({
    example: 'Luxury Apartment',
    description: 'Name of the property',
  })
  property_name: string;

  @ApiProperty({
    example: 'pending',
    description: 'Status of the service request',
  })
  status: string;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the tenant',
  })
  tenant_id: string;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the property',
  })
  property_id: string;
}

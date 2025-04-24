import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateServiceRequestDto } from './create-service-request.dto';

export class UpdateServiceRequestDto extends PartialType(
  CreateServiceRequestDto,
) {}

export class UpdateServiceRequestResponseDto {
  @ApiProperty({
    example: 'John Doe',
    description: 'Name of the tenant',
    required: false,
  })
  tenant_name: string;

  @ApiProperty({
    example: 'Luxury Apartment',
    description: 'Name of the property',
    required: false,
  })
  property_name: string;

  @ApiProperty({
    example: 'pending',
    description: 'Status of the service request',
    required: false,
  })
  status: string;

  @ApiProperty({
    example: 'Broken Pipe',
    description: 'Category of the issue',
    required: false,
  })
  issue_category: string;

  @ApiProperty({
    example: '2024-03-21',
    description: 'Date when the issue was noticed',
    required: false,
  })
  effective_date: Date;

  @ApiProperty({
    example:
      'The pipe in the kitchen is leaking and needs immediate attention.',
    description: 'Description of the issue',
    required: false,
  })
  description: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'string', format: 'binary' },
    required: false,
    description: 'Images of the issue (optional)',
  })
  issue_images?: string[] | null;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the tenant',
    required: false,
  })
  tenant_id: string;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the property',
    required: false,
  })
  property_id: string;
}

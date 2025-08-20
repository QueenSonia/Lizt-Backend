import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {}

export class UpdateUserResponseDto {
  @ApiProperty({
    required: false,
    example: 'John',
    description: 'First name of the user',
  })
  first_name: string;

  @ApiProperty({
    required: false,
    example: 'Doe',
    description: 'Last name of the user',
  })
  last_name: string;

  @ApiProperty({
    required: false,
    example: 'user@example.com',
    description: 'Email of the user',
  })
  email: string;

  @ApiProperty({
    required: false,
    example: '+2348104467932',
    description: 'Phone number of the user',
  })
  phone_number: string;

  @ApiProperty({
    required: false,
    example: 'admin',
    description: 'Role of the user',
  })
  role: string;

  @ApiProperty({
    example: '2023-10-01',
    required: false,
    description: 'lease start date',
  })
  lease_start_date: Date;

  @ApiProperty({
    example: '2024-10-01',
    required: false,
    description: 'lease end date',
  })
  lease_end_date: Date;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the property',
    required: false,
  })
  property_id: string;
}

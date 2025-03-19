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
}

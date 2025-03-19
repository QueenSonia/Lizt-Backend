import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { RolesEnum } from 'src/base.entity';

export class CreateUserDto {
  @ApiProperty({ example: 'John', description: 'First name of the user' })
  @Transform((val) => val.value.toLowerCase())
  @IsNotEmpty()
  @IsString()
  first_name: string;

  @ApiProperty({ example: 'Doe', description: 'Last name of the user' })
  @Transform((val) => val.value.toLowerCase())
  @IsNotEmpty()
  @IsString()
  last_name: string;

  @ApiProperty({
    example: 'user@example.com',
    description: 'Email of the user',
  })
  @Transform((val) => val.value.toLowerCase())
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({
    example: '+2348104467932',
    description: 'Phone number of the user',
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(10)
  phone_number: string;

  @ApiProperty({
    example: 'admin',
    description: 'Role of the user',
    required: false,
  })
  @Transform((val) => val.value.toLowerCase())
  role: RolesEnum;
}

export class LoginDto {
  @ApiProperty({
    example: 'app-ag-ib-1@apple.com',
    description: 'The email of the user',
  })
  @Transform((val) => val.value.toLowerCase())
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'Password5%',
    description: 'The password of the user',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/,
    {
      message:
        'Password must be at least 6 characters long, include at least one uppercase letter, one lowercase letter, one number, and one special character.',
    },
  )
  password: string;
}

export interface IUser {
  id?: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  password?: string;
  role: string;
}

export interface UserFilter {
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  role: string;
  start_date?: string;
  end_date?: string;
  size?: number;
  page?: number;
}

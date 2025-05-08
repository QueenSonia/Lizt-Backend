import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

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
  @IsString()
  @IsOptional()
  @Transform((val) => val.value.toLowerCase())
  role?: string;

  @ApiProperty({
    example: '',
    description: 'lease start date',
  })
  @IsNotEmpty()
  @IsDateString()
  lease_start_date: Date;

  @ApiProperty({
    example: '',
    description: 'lease end date',
  })
  @IsNotEmpty()
  @IsDateString()
  lease_end_date: Date;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the property',
    required: false,
  })
  @IsString()
  @IsOptional()
  property_id: string;

  @ApiProperty({
    example: 'Password5%',
    description: 'Password of the user (admin only)',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/,
    {
      message:
        'Password must be at least 6 characters long, include at least one uppercase letter, one lowercase letter, one number, and one special character.',
    }
  )
  password?: string;
  

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

export class UploadLogoDto {
  @ApiProperty({
    type: 'array',
    items: {
      type: 'string',
      format: 'binary',
    },
    description: 'Admin logo image files (max 5)',
    required: true,
  })
  @IsOptional()
  logos: Express.Multer.File[];
}


export class CreateAdminDto {
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
  @IsString()
  @IsOptional()
  @Transform((val) => val.value.toLowerCase())
  role?: string;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the property',
    required: false,
  })
  @IsString()
  @IsOptional()
  property_id: string;

  @ApiProperty({
    example: 'Password5%',
    description: 'Password of the user (admin only)',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/,
    {
      message:
        'Password must be at least 6 characters long, include at least one uppercase letter, one lowercase letter, one number, and one special character.',
    }
  )
  password?: string;
  

}

export interface IUser {
  id?: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  role: string;
  password?: string;
  creator_id?: string | null;
}

export interface UserFilter {
  search?:string
  first_name?: string;
  last_name?: string;
  email?: string;
  creator_id?: string;
  phone_number?: string;
  role?: string;
  start_date?: string;
  end_date?: string;
  size?: number;
  page?: number;
}

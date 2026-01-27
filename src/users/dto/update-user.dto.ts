import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';
import {
  IsOptional,
  IsString,
  IsEmail,
  IsIn,
  IsDateString,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  Gender,
  MaritalStatus,
  EmploymentStatus,
} from '../../tenant-kyc/entities/tenant-kyc.entity';
import { NormalizePhoneNumber } from '../../utils/phone-number.transformer';

export class UpdateUserDto {
  @ApiProperty({
    required: false,
    example: 'John',
    description: 'First name of the user',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  first_name?: string;

  @ApiProperty({
    required: false,
    example: 'Doe',
    description: 'Last name of the user',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  last_name?: string;

  @ApiProperty({
    required: false,
    example: 'user@example.com',
    description: 'Email of the user',
  })
  @IsOptional()
  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  email?: string;

  @ApiProperty({
    required: false,
    example: '+2348104467932',
    description: 'Phone number of the user',
  })
  @IsOptional()
  @IsString()
  @NormalizePhoneNumber()
  phone_number?: string;

  @ApiProperty({
    required: false,
    example: '1990-01-01',
    description: 'Date of Birth',
  })
  @IsOptional()
  @IsDateString()
  date_of_birth?: string;

  @ApiProperty({
    required: false,
    example: 'male',
    description: 'Gender',
    enum: Gender,
  })
  @IsOptional()
  @IsIn(Object.values(Gender))
  gender?: `${Gender}`;

  @ApiProperty({
    required: false,
    example: 'Lagos',
    description: 'State of Origin',
  })
  @IsOptional()
  @IsString()
  state_of_origin?: string;

  @ApiProperty({
    required: false,
    example: 'Ikeja',
    description: 'Local Government Area',
  })
  @IsOptional()
  @IsString()
  lga?: string;

  @ApiProperty({
    required: false,
    example: 'Nigerian',
    description: 'Nationality',
  })
  @IsOptional()
  @IsString()
  nationality?: string;

  @ApiProperty({
    required: false,
    example: 'employed',
    description: 'Employment Status',
    enum: EmploymentStatus,
  })
  @IsOptional()
  @IsIn(Object.values(EmploymentStatus))
  employment_status?: `${EmploymentStatus}`;

  @ApiProperty({
    required: false,
    example: 'Company Ltd',
    description: 'Employer Name',
  })
  @IsOptional()
  @IsString()
  employer_name?: string;

  @ApiProperty({
    required: false,
    example: 'Software Engineer',
    description: 'Job Title',
  })
  @IsOptional()
  @IsString()
  job_title?: string;

  @ApiProperty({
    required: false,
    example: '123 Main St',
    description: 'Employer Address',
  })
  @IsOptional()
  @IsString()
  employer_address?: string;

  @ApiProperty({
    required: false,
    example: 'single',
    description: 'Marital Status',
    enum: MaritalStatus,
  })
  @IsOptional()
  @IsIn(Object.values(MaritalStatus))
  marital_status?: `${MaritalStatus}`;

  @ApiProperty({
    required: false,
    example: 'My Business',
    description: 'Business Name',
  })
  @IsOptional()
  @IsString()
  business_name?: string;

  @ApiProperty({
    required: false,
    example: 'Trading',
    description: 'Nature of Business',
  })
  @IsOptional()
  @IsString()
  nature_of_business?: string;

  @ApiProperty({
    required: false,
    example: '123 Biz St',
    description: 'Business Address',
  })
  @IsOptional()
  @IsString()
  business_address?: string;

  @ApiProperty({
    required: false,
    example: 'Jane Doe',
    description: 'Spouse Full Name',
  })
  @IsOptional()
  @IsString()
  spouse_full_name?: string;

  @ApiProperty({
    required: false,
    example: '+2348000000000',
    description: 'Spouse Phone Number',
  })
  @IsOptional()
  @IsString()
  spouse_phone_number?: string;

  @ApiProperty({
    required: false,
    example: 'Engineer',
    description: 'Spouse Occupation',
  })
  @IsOptional()
  @IsString()
  spouse_occupation?: string;

  @ApiProperty({
    required: false,
    example: 'Company Ltd',
    description: 'Spouse Employer',
  })
  @IsOptional()
  @IsString()
  spouse_employer?: string;

  @ApiProperty({
    required: false,
    example: 'husband',
    description: 'Source of Funds',
  })
  @IsOptional()
  @IsString()
  source_of_funds?: string;

  @ApiProperty({
    required: false,
    example: { enableLiveFeedSound: true, allowDuplicatePropertyNames: false },
    description: 'User preferences',
  })
  @IsOptional()
  preferences?: {
    enableLiveFeedSound?: boolean;
    allowDuplicatePropertyNames?: boolean;
  };

  @ApiProperty({
    required: false,
    example: {
      businessName: 'Property Kraft',
      businessAddress: '17 Ayinde Akinmade Street, Lekki Phase 1, Lagos State',
      contactInfo: 'contact@propertykraft.com | +234 901 234 5678',
      footerColor: '#6B6B6B',
      letterhead: null,
      signature: null,
      headingFont: 'Inter',
      bodyFont: 'Inter',
    },
    description: 'Offer letter branding settings',
  })
  @IsOptional()
  branding?: {
    businessName?: string;
    businessAddress?: string;
    contactInfo?: string;
    footerColor?: string;
    letterhead?: string;
    signature?: string;
    headingFont?: string;
    bodyFont?: string;
    updatedAt?: string;
  };
}

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
    description: 'rent start date',
  })
  rent_start_date: Date;

  @ApiProperty({
    example: '2024-10-01',
    required: false,
    description: 'lease agreement end date',
  })
  lease_agreement_end_date: Date;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the property',
    required: false,
  })
  property_id: string;
}

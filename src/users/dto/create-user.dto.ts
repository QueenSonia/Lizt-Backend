import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  Gender,
  MaritalStatus,
  EmploymentStatus,
} from '../../tenant-kyc/entities/tenant-kyc.entity';
import { NormalizePhoneNumber } from '../../utils/phone-number.transformer';

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  @NormalizePhoneNumber()
  phone_number: string;

  @IsString()
  @IsNotEmpty()
  full_name: string;

  @IsEmail()
  email: string;

  @IsUUID()
  property_id: string;

  // Rent details
  @IsNotEmpty()
  @IsDateString()
  rent_start_date: Date;

  @IsOptional()
  @IsDateString()
  lease_agreement_end_date?: Date;

  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  rental_price: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  security_deposit?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  service_charge?: number;

  @IsOptional()
  @IsString()
  payment_frequency?: string;
}

export class CreateTenantKycDto {
  @IsString()
  @IsNotEmpty()
  @NormalizePhoneNumber()
  phone_number: string;

  @IsString()
  @IsNotEmpty()
  first_name: string;

  @IsString()
  @IsNotEmpty()
  last_name: string;

  @IsEmail()
  email: string;

  @Type(() => Date)
  @IsDate()
  date_of_birth: Date;

  @IsEnum(Gender)
  gender: Gender;

  @IsString()
  state_of_origin: string;

  @IsString()
  lga: string;

  @IsString()
  nationality: string;

  @IsEnum(EmploymentStatus)
  employment_status: EmploymentStatus;

  @IsEnum(MaritalStatus)
  marital_status: MaritalStatus;

  @IsUUID()
  property_id: string;

  // Rent details
  @IsNotEmpty()
  @IsDateString()
  tenancy_start_date: Date;

  @IsNotEmpty()
  @IsDateString()
  tenancy_end_date: Date;

  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  rent_amount: number;

  // -----------------------
  // Employment (if EMPLOYED)
  // -----------------------
  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsString()
  @IsNotEmpty()
  employer_name: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsString()
  @IsNotEmpty()
  job_title: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsString()
  employer_address: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsNumber()
  @Type(() => Number)
  monthly_income: number;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsEmail()
  work_email: string;

  // -----------------------
  // Self-Employed (if SELF_EMPLOYED)
  // -----------------------
  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsString()
  business_name: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsString()
  nature_of_business: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsString()
  business_address: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsNumber()
  @Type(() => Number)
  business_monthly_income: number;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsOptional()
  @IsString()
  business_website?: string;

  // -----------------------
  // Unemployed (if UNEMPLOYED)
  // -----------------------
  @ValidateIf((o) => o.employment_status === EmploymentStatus.UNEMPLOYED)
  @IsString()
  source_of_funds: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.UNEMPLOYED)
  @IsNumber()
  @Type(() => Number)
  monthly_income_estimate: number;

  // -----------------------
  // Spouse (if MARRIED)
  // -----------------------
  @ValidateIf((o) => o.marital_status === MaritalStatus.MARRIED)
  @IsString()
  spouse_full_name: string;

  @ValidateIf((o) => o.marital_status === MaritalStatus.MARRIED)
  @IsString()
  spouse_phone_number: string;

  @ValidateIf((o) => o.marital_status === MaritalStatus.MARRIED)
  @IsString()
  spouse_occupation: string;

  @ValidateIf((o) => o.marital_status === MaritalStatus.MARRIED)
  @IsString()
  spouse_employer: string;
}

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
  @IsPhoneNumber()
  @MinLength(10)
  @NormalizePhoneNumber()
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
    description: 'rent start date',
  })
  @IsNotEmpty()
  @IsDateString()
  rent_start_date: Date;

  @ApiProperty({
    example: '',
    description: 'lease agreement end date',
  })
  @IsOptional()
  @IsDateString()
  lease_agreement_end_date?: Date;

  @ApiProperty({
    example: '90b7f325-be27-45a7-9688-fa49630cac8f',
    description: 'UUID of the property',
    required: false,
  })
  @IsString()
  @IsOptional()
  property_id: string;

  @ApiProperty({
    example: 500000,
    description: 'Rental price of the property',
    type: 'integer',
  })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  rental_price: number;

  @ApiProperty({
    example: 20000,
    description: 'Security payment',
    type: 'integer',
  })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  security_deposit: number;

  @ApiProperty({
    example: 50000,
    description: 'Service charge',
    type: 'integer',
  })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  service_charge: number;

  // @ApiProperty({
  //   example: 'Password5%',
  //   description: 'Password of the user (admin only)',
  //   required: false,
  // })
  // @IsOptional()
  // @IsString()
  // @Matches(
  //   /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/,
  //   {
  //     message:
  //       'Password must be at least 6 characters long, include at least one uppercase letter, one lowercase letter, one number, and one special character.',
  //   },
  // )
  // password?: string;

  @ApiProperty({ example: '1990-01-01', description: 'Date of Birth' })
  @IsNotEmpty()
  @IsDateString()
  date_of_birth: string;

  @ApiProperty({ example: 'male', description: 'Gender', enum: Gender })
  @IsNotEmpty()
  @IsIn(Object.values(Gender))
  gender: `${Gender}`;

  @ApiProperty({ example: 'Lagos', description: 'State of Origin' })
  @IsNotEmpty()
  @IsString()
  state_of_origin: string;

  @ApiProperty({ example: 'Ikeja', description: 'Local Government Area' })
  @IsNotEmpty()
  @IsString()
  lga: string;

  @ApiProperty({ example: 'Nigerian', description: 'Nationality' })
  @IsNotEmpty()
  @IsString()
  nationality: string;

  @ApiProperty({
    example: 'employed',
    description: 'Employment Status',
    enum: EmploymentStatus,
  })
  @IsNotEmpty()
  @IsIn(Object.values(EmploymentStatus))
  employment_status: `${EmploymentStatus}`;

  // Employed fields
  @ApiProperty({
    example: 'Company Ltd',
    description: 'Employer Name',
    required: false,
  })
  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsNotEmpty()
  @IsString()
  employer_name?: string;

  @ApiProperty({
    example: 'Software Engineer',
    description: 'Job Title',
    required: false,
  })
  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsNotEmpty()
  @IsString()
  job_title?: string;

  @ApiProperty({
    example: '123 Main St',
    description: 'Employer Address',
    required: false,
  })
  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsNotEmpty()
  @IsString()
  employer_address?: string;

  @ApiProperty({
    example: 100000,
    description: 'Monthly Income (₦)',
    required: false,
  })
  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  monthly_income?: number;

  @ApiProperty({
    example: 'work.email@company.com',
    description: 'Work Email (Optional)',
    required: false,
  })
  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsOptional()
  @IsEmail()
  work_email?: string;

  // Self-employed fields
  @ApiProperty({
    example: 'My Business',
    description: 'Business Name',
    required: false,
  })
  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsNotEmpty()
  @IsString()
  business_name?: string;

  @ApiProperty({
    example: 'Trading',
    description: 'Nature of Business',
    required: false,
  })
  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsNotEmpty()
  @IsString()
  nature_of_business?: string;

  @ApiProperty({
    example: '123 Biz St',
    description: 'Business Address',
    required: false,
  })
  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsNotEmpty()
  @IsString()
  business_address?: string;

  @ApiProperty({
    example: 100000,
    description: 'Monthly Income (₦)',
    required: false,
  })
  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  business_monthly_income?: number;

  @ApiProperty({
    example: 'www.business.com',
    description: 'Business Website (Optional)',
    required: false,
  })
  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsOptional()
  @IsString()
  business_website?: string;

  @ApiProperty({
    example: 'single',
    description: 'Marital Status',
    enum: MaritalStatus,
  })
  @IsNotEmpty()
  @IsIn(Object.values(MaritalStatus))
  marital_status: `${MaritalStatus}`;

  // Spouse info (if married)
  @ApiProperty({
    example: 'Jane Doe',
    description: 'Spouse Full Name',
    required: false,
  })
  @ValidateIf((o) => o.marital_status === MaritalStatus.MARRIED)
  @IsNotEmpty()
  @IsString()
  spouse_full_name?: string;

  @ApiProperty({
    example: '+2348000000000',
    description: 'Spouse Phone Number',
    required: false,
  })
  @ValidateIf((o) => o.marital_status === MaritalStatus.MARRIED)
  @IsNotEmpty()
  @IsPhoneNumber()
  spouse_phone_number?: string;

  @ApiProperty({
    example: 'Engineer',
    description: 'Spouse Occupation',
    required: false,
  })
  @ValidateIf((o) => o.marital_status === MaritalStatus.MARRIED)
  @IsNotEmpty()
  @IsString()
  spouse_occupation?: string;

  @ApiProperty({
    example: 'Company Ltd',
    description: 'Spouse Employer (Optional)',
    required: false,
  })
  @IsOptional()
  @IsString()
  spouse_employer?: string;

  @ApiProperty({
    example: 'husband',
    description: 'Source of Funds (if unemployed)',
    required: false,
  })
  @ValidateIf((o) => o.employment_status === EmploymentStatus.UNEMPLOYED)
  @IsNotEmpty()
  @IsString()
  source_of_funds?: string;

  @ApiProperty({
    example: 400000,
    description: 'Monthly Income Estimate (₦) (if unemployed)',
    required: false,
  })
  @ValidateIf((o) => o.employment_status === EmploymentStatus.UNEMPLOYED)
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  monthly_income_estimate?: number;

  //  @ApiProperty({
  //   example: false,
  //   description: 'Sub_Account',
  //   type: 'boolean',
  // })
  // @IsNotEmpty()
  // @IsBoolean()
  // @Type(() => Boolean)
  // is_sub_account: boolean;
}

export class LoginDto {
  @ApiProperty({
    description: 'Email address or phone number',
    example: 'user@example.com or +1234567890',
  })
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @ApiProperty({
    example: 'Password5%',
    description: 'The password of the user',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{6,}$/, {
    message:
      'Password must be at least 6 characters long, include at least one uppercase letter, one lowercase letter, one number, and one special character.',
  })
  password: string;
}

export class ResetDto {
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    example: 'Password5%',
    description: 'The password of the user',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{6,}$/, {
    message:
      'Password must be at least 6 characters long, include at least one uppercase letter, one lowercase letter, one number, and one special character.',
  })
  newPassword: string;
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
  @Transform(({ value }) => typeof value === 'string' && value.toLowerCase())
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
  @NormalizePhoneNumber()
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
    },
  )
  password: string;
}

export class CreateLandlordDto {
  @ApiProperty({ example: 'John', description: 'First name of the user' })
  @Transform(({ value }) => typeof value === 'string' && value.toLowerCase())
  @IsNotEmpty()
  @IsString()
  first_name: string;

  @ApiProperty({ example: 'Doe', description: 'Last name of the user' })
  @Transform((val) => val.value.toLowerCase())
  @IsNotEmpty()
  @IsString()
  last_name: string;

  @ApiProperty({ example: 'your_brand', description: 'Name of agency' })
  @Transform((val) => val.value.toLowerCase())
  @IsNotEmpty()
  @IsString()
  agency_name: string;

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
  @NormalizePhoneNumber()
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
    },
  )
  password: string;
}

export class CreateCustomerRepDto {
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
  @NormalizePhoneNumber()
  phone_number: string;

  @ApiProperty({
    example: 'Password5%',
    description: 'Password of the user (admin only)',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{6,}$/, {
    message:
      'Password must be at least 6 characters long, include at least one uppercase letter, one lowercase letter, one number, and one special character.',
  })
  password: string;

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

  // @ApiProperty({
  //   example: 'Password5%',
  //   description: 'Password of the user (admin only)',
  //   required: false,
  // })
  // @IsOptional()
  // @IsString()
  // @Matches(
  //   /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/,
  //   {
  //     message:
  //       'Password must be at least 6 characters long, include at least one uppercase letter, one lowercase letter, one number, and one special character.',
  //   }
  // )
  // password: string;
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
  search?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  creator_id?: string;
  userId?: string;
  phone_number?: string;
  role?: string;
  sort_by?: string;
  sort_order?: string;
  start_date?: string;
  end_date?: string;
  size?: number;
  page?: number;
}

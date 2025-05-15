// src/users/dto/create-kyc.dto.ts
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateKycDto {
  // @IsString()
  // @IsNotEmpty()
  // former_house_address: string;

  // @IsString()
  // @IsNotEmpty()
  // reason_for_leaving: string;

  // @IsString()
  // @IsNotEmpty()
  // former_accomodation_type: string;

  @IsString()
  @IsNotEmpty()
  occupation: string;

  @IsString()
  @IsNotEmpty()
  employers_name: string;

  @IsString()
  @IsNotEmpty()
  employers_address: string;

  @IsString()
  @IsNotEmpty()
  state_of_origin: string;

  // @IsString()
  // @IsNotEmpty()
  // lga_of_origin: string;

  // @IsString()
  // @IsNotEmpty()
  // home_town: string;

  @IsString()
  @IsNotEmpty()
  nationality: string;

  @IsString()
  @IsNotEmpty()
  religion: string;

  @IsString()
  @IsNotEmpty()
  marital_status: string;

  @IsOptional()
  @IsString()
  name_of_spouse?: string;

  // @IsString()
  // @IsNotEmpty()
  // next_of_kin: string;

  // @IsString()
  // @IsNotEmpty()
  // next_of_kin_address: string;

  // @IsString()
  // @IsNotEmpty()
  // guarantor: string;

  // @IsString()
  // @IsNotEmpty()
  // guarantor_address: string;

  // @IsString()
  // @IsNotEmpty()
  // guarantor_occupation: string;

  // @IsString()
  // @IsNotEmpty()
  // guarantor_phone_number: string;

  @IsString()
  @IsNotEmpty()
  monthly_income: string;

  @IsBoolean()
  @IsNotEmpty()
  accept_terms_and_condition: boolean;
}

import { IsNotEmpty, IsString } from 'class-validator';

export class SendOnboardingOtpDto {
  @IsString()
  @IsNotEmpty()
  phone: string;
}

export class VerifyOnboardingOtpDto {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  otp_code: string;
}

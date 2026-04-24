import { IsString, Length, IsOptional } from 'class-validator';

export class VerifyRenewalOtpDto {
  @IsString()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  otp: string;

  @IsString()
  @IsOptional()
  ipAddress?: string;
}

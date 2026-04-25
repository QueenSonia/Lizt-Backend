import { IsString, Length, IsOptional, MaxLength } from 'class-validator';

export class VerifyRejectRenewalOtpDto {
  @IsString()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  otp: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;

  @IsString()
  @IsOptional()
  ipAddress?: string;
}

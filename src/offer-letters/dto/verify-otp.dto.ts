import { IsString, Length } from 'class-validator';

/**
 * Verify OTP DTO
 * Used for verifying OTP when accepting an offer letter
 * Requirements: 10.6
 */
export class VerifyOfferOtpDto {
  @IsString()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  otp: string;
}

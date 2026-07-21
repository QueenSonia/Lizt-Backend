import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class SaveOnboardingDraftDto {
  // The whole wizard state (landlord fields + properties + uploaded doc URLs).
  // Stored verbatim as jsonb and rehydrated on resume; shape is owned by the
  // frontend wizard, so it is intentionally untyped here.
  @IsObject()
  @IsNotEmpty()
  data: Record<string, any>;

  // Short-lived OTP verification JWT, read by OnboardingVerifiedGuard from the
  // body because the Next.js proxy drops client-set Authorization headers.
  @IsOptional()
  @IsString()
  verificationToken?: string;
}

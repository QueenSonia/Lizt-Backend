import {
  OfferLetter,
  OfferLetterStatus,
  PaymentStatus,
} from '../entities/offer-letter.entity';
import { KYCApplication } from '../../kyc-links/entities/kyc-application.entity';
import { Property } from '../../properties/entities/property.entity';
import { Users } from '../../users/entities/user.entity';
import { PropertyStatusEnum } from '../../properties/dto/create-property.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Branding data for offer letters
 * Matches the frontend BrandingData interface
 */
export class BrandingData {
  @ApiProperty({ example: 'Property Kraft' })
  businessName: string;

  @ApiProperty({ example: '123 Lekki, Lagos' })
  businessAddress: string;

  @ApiProperty({ example: '+234 901 234 5678' })
  contactPhone: string;

  @ApiProperty({ example: 'contact@propertykraft.com' })
  contactEmail: string;

  @ApiProperty({ example: 'https://propertykraft.com' })
  websiteLink: string;

  @ApiProperty({ example: '#6B6B6B' })
  footerColor: string;

  @ApiPropertyOptional({ example: 'https://cloudinary.com/letterhead.png' })
  letterhead?: string;

  @ApiPropertyOptional({ example: 'https://cloudinary.com/signature.png' })
  signature?: string;

  @ApiProperty({ example: 'Inter' })
  headingFont: string;

  @ApiProperty({ example: 'Inter' })
  bodyFont: string;

  @ApiPropertyOptional({ example: '2024-01-01T12:00:00Z' })
  updatedAt?: string;
}

/**
 * Terms of Tenancy Response DTO
 */
export class TermsOfTenancyResponseDto {
  @ApiProperty({ example: 'Permitted Use' })
  title: string;

  @ApiProperty({ example: 'Residential' })
  content: string;
}

/**
 * Offer Letter Response DTO
 * Matches the frontend OfferLetterResponse interface
 * Requirements: 10.2
 */
export class OfferLetterResponse {
  @ApiProperty({ example: '00000000-0000-0000-0000-000000000000' })
  id: string;

  @ApiProperty({ example: 'abc-123-token' })
  token: string;

  @ApiProperty({ example: 'John Doe' })
  applicantName: string;

  @ApiProperty({ example: 'john@example.com' })
  applicantEmail: string;

  @ApiProperty({ example: '+234 810 123 4567' })
  applicantPhone: string;

  @ApiPropertyOptional({ example: 'male' })
  applicantGender?: string;

  @ApiProperty({ example: 'Studio Apartment' })
  propertyName: string;

  @ApiProperty({ example: '123 Lekki, Lagos' })
  propertyAddress: string;

  @ApiProperty({ example: 1000000 })
  rentAmount: number;

  @ApiProperty({ example: 'Annually' })
  rentFrequency: string;

  @ApiPropertyOptional({ example: 100000 })
  serviceCharge?: number;

  @ApiProperty({ example: '2024-01-01' })
  tenancyStartDate: string;

  @ApiProperty({ example: '2024-12-31' })
  tenancyEndDate: string;

  @ApiPropertyOptional({ example: 50000 })
  cautionDeposit?: number;

  @ApiPropertyOptional({ example: 20000 })
  legalFee?: number;

  @ApiPropertyOptional({ example: 30000 })
  agencyFee?: number;

  @ApiProperty({ enum: OfferLetterStatus, example: OfferLetterStatus.PENDING })
  status: OfferLetterStatus;

  @ApiProperty({ type: () => [TermsOfTenancyResponseDto] })
  termsOfTenancy: TermsOfTenancyResponseDto[];

  @ApiProperty({ example: '2024-01-01T12:00:00Z' })
  createdAt: string;

  @ApiPropertyOptional({ type: () => BrandingData })
  branding?: BrandingData;

  @ApiProperty({ example: 1200000 })
  totalAmount: number;

  @ApiProperty({ example: 0 })
  amountPaid: number;

  @ApiProperty({ example: 1200000 })
  outstandingBalance: number;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.UNPAID })
  paymentStatus: PaymentStatus;

  @ApiProperty({ example: true })
  isPropertyAvailable: boolean;

  @ApiPropertyOptional({ example: '456 Tenant St' })
  tenantAddress?: string;

  @ApiPropertyOptional({ example: 'https://cloudinary.com/offer-letter.pdf' })
  pdfUrl?: string;

  @ApiPropertyOptional({ example: '2024-01-15T15:32:45Z' })
  acceptedAt?: string;

  @ApiPropertyOptional({ example: '+234 901 234 5678' })
  acceptedByPhone?: string;

  @ApiPropertyOptional({ example: '748392' })
  acceptanceOtp?: string;

  @ApiPropertyOptional({ example: 'Ibrahim Mohammed' })
  acceptedByName?: string;
}

/**
 * Helper function to transform OfferLetter entity to API response
 * Requirements: 10.2
 */
export function toOfferLetterResponse(
  entity: OfferLetter,
  kycApplication: KYCApplication,
  property: Property,
  landlord?: Users,
): OfferLetterResponse {
  // Only use branding snapshot from offer letter - no fallback to current landlord branding
  // If no branding was saved at creation time, return undefined (no branding displayed)
  const branding: BrandingData | undefined = entity.branding
    ? {
        businessName: entity.branding.businessName || '',
        businessAddress: entity.branding.businessAddress || '',
        contactPhone: entity.branding.contactPhone || '',
        contactEmail: entity.branding.contactEmail || '',
        websiteLink: entity.branding.websiteLink || '',
        footerColor: entity.branding.footerColor || '#6B6B6B',
        letterhead: entity.branding.letterhead,
        signature: entity.branding.signature,
        headingFont: entity.branding.headingFont || 'Inter',
        bodyFont: entity.branding.bodyFont || 'Inter',
      }
    : undefined;

  // Calculate total amount if not set (for backward compatibility)
  const totalAmount = entity.total_amount
    ? Number(entity.total_amount)
    : Number(entity.rent_amount) +
      (entity.service_charge ? Number(entity.service_charge) : 0) +
      (entity.caution_deposit ? Number(entity.caution_deposit) : 0) +
      (entity.legal_fee ? Number(entity.legal_fee) : 0) +
      (entity.agency_fee ? Number(entity.agency_fee) : 0);

  // Calculate outstanding balance if not set
  const amountPaid = Number(entity.amount_paid || 0);
  const outstandingBalance = entity.outstanding_balance
    ? Number(entity.outstanding_balance)
    : totalAmount - amountPaid;

  // Determine if property is still available (not occupied)
  const isPropertyAvailable =
    property.property_status !== PropertyStatusEnum.OCCUPIED;

  return {
    id: entity.id,
    token: entity.token,
    applicantName: `${kycApplication.first_name} ${kycApplication.last_name}`,
    applicantEmail: kycApplication.email || '',
    applicantPhone: kycApplication.phone_number,
    applicantGender: kycApplication.gender,
    propertyName: property.name,
    propertyAddress: property.location,
    rentAmount: Number(entity.rent_amount),
    rentFrequency: entity.rent_frequency,
    serviceCharge: entity.service_charge
      ? Number(entity.service_charge)
      : undefined,
    tenancyStartDate: formatDate(entity.tenancy_start_date),
    tenancyEndDate: formatDate(entity.tenancy_end_date),
    cautionDeposit: entity.caution_deposit
      ? Number(entity.caution_deposit)
      : undefined,
    legalFee: entity.legal_fee ? Number(entity.legal_fee) : undefined,
    agencyFee: entity.agency_fee ? Number(entity.agency_fee) : undefined,
    status: entity.status,
    termsOfTenancy: entity.terms_of_tenancy as TermsOfTenancyResponseDto[],
    createdAt:
      entity.created_at instanceof Date
        ? entity.created_at.toISOString()
        : entity.created_at || new Date().toISOString(),
    branding,
    // Payment-related fields (Task 2.2)
    totalAmount,
    amountPaid,
    outstandingBalance,
    paymentStatus: entity.payment_status || PaymentStatus.UNPAID,
    isPropertyAvailable,
    tenantAddress: kycApplication.contact_address,
    pdfUrl: entity.pdf_url,
    acceptedAt: entity.accepted_at
      ? entity.accepted_at instanceof Date
        ? entity.accepted_at.toISOString()
        : entity.accepted_at
      : undefined,
    acceptedByPhone: entity.accepted_by_phone || undefined,
    acceptanceOtp: entity.acceptance_otp || undefined,
    acceptedByName: entity.accepted_at
      ? `${kycApplication.first_name} ${kycApplication.last_name}`
      : undefined,
  };
}

/**
 * Helper function to format date to YYYY-MM-DD string
 */
function formatDate(date: Date | string): string {
  if (date instanceof Date) {
    return date.toISOString().split('T')[0];
  }
  // If it's already a string, try to parse and format it
  const parsed = new Date(date);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }
  return date;
}

/**
 * Acceptance initiation response
 * Requirements: 10.5
 */
export class AcceptanceInitiationResponse {
  @ApiProperty({ example: 'OTP sent to your phone number' })
  message: string;

  @ApiProperty({ example: '1234' })
  phoneLastFour: string;
}

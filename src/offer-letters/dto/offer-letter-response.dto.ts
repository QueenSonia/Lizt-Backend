import {
  OfferLetter,
  OfferLetterStatus,
  TermsOfTenancy,
} from '../entities/offer-letter.entity';
import { KYCApplication } from '../../kyc-links/entities/kyc-application.entity';
import { Property } from '../../properties/entities/property.entity';
import { Users } from '../../users/entities/user.entity';

/**
 * Branding data for offer letters
 * Matches the frontend BrandingData interface
 */
export interface BrandingData {
  businessName: string;
  businessAddress: string;
  contactInfo: string;
  footerColor: string;
  letterhead?: string;
  signature?: string;
  headingFont: string;
  bodyFont: string;
  updatedAt?: string;
}

/**
 * Offer Letter Response DTO
 * Matches the frontend OfferLetterResponse interface
 * Requirements: 10.2
 */
export interface OfferLetterResponse {
  id: string;
  token: string;
  applicantName: string;
  applicantEmail: string;
  applicantPhone: string;
  propertyName: string;
  propertyAddress: string;
  rentAmount: number;
  rentFrequency: string;
  serviceCharge?: number;
  tenancyStartDate: string;
  tenancyEndDate: string;
  cautionDeposit: number;
  legalFee: number;
  agencyFee: string;
  status: OfferLetterStatus;
  termsOfTenancy: TermsOfTenancy[];
  createdAt: string;
  branding?: BrandingData;
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
  // Build branding data from landlord's user record
  const branding: BrandingData | undefined = landlord?.branding
    ? {
        businessName: landlord.branding.businessName || 'Property Kraft',
        businessAddress:
          landlord.branding.businessAddress ||
          '17 Ayinde Akinmade Street, Lekki Phase 1, Lagos State',
        contactInfo:
          landlord.branding.contactInfo ||
          'contact@propertykraft.com | +234 901 234 5678',
        footerColor: landlord.branding.footerColor || '#6B6B6B',
        letterhead: landlord.branding.letterhead,
        signature: landlord.branding.signature,
        headingFont: landlord.branding.headingFont || 'Inter',
        bodyFont: landlord.branding.bodyFont || 'Inter',
        updatedAt: landlord.branding.updatedAt,
      }
    : undefined;

  return {
    id: entity.id,
    token: entity.token,
    applicantName: `${kycApplication.first_name} ${kycApplication.last_name}`,
    applicantEmail: kycApplication.email || '',
    applicantPhone: kycApplication.phone_number,
    propertyName: property.name,
    propertyAddress: property.location,
    rentAmount: Number(entity.rent_amount),
    rentFrequency: entity.rent_frequency,
    serviceCharge: entity.service_charge
      ? Number(entity.service_charge)
      : undefined,
    tenancyStartDate: formatDate(entity.tenancy_start_date),
    tenancyEndDate: formatDate(entity.tenancy_end_date),
    cautionDeposit: Number(entity.caution_deposit),
    legalFee: Number(entity.legal_fee),
    agencyFee: entity.agency_fee,
    status: entity.status,
    termsOfTenancy: entity.terms_of_tenancy,
    createdAt:
      entity.created_at instanceof Date
        ? entity.created_at.toISOString()
        : entity.created_at || new Date().toISOString(),
    branding,
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
export interface AcceptanceInitiationResponse {
  message: string;
  phoneLastFour: string;
}

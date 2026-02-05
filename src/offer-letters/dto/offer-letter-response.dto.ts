import {
  OfferLetter,
  OfferLetterStatus,
  PaymentStatus,
  TermsOfTenancy,
} from '../entities/offer-letter.entity';
import { KYCApplication } from '../../kyc-links/entities/kyc-application.entity';
import { Property } from '../../properties/entities/property.entity';
import { Users } from '../../users/entities/user.entity';
import { PropertyStatusEnum } from '../../properties/dto/create-property.dto';

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
  cautionDeposit?: number;
  legalFee?: number;
  agencyFee?: number;
  status: OfferLetterStatus;
  termsOfTenancy: TermsOfTenancy[];
  createdAt: string;
  branding?: BrandingData;
  // Payment-related fields (Task 2.2)
  totalAmount: number;
  amountPaid: number;
  outstandingBalance: number;
  paymentStatus: PaymentStatus;
  isPropertyAvailable: boolean;
  tenantAddress?: string;
  pdfUrl?: string;
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
      contactInfo: entity.branding.contactInfo || '',
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
    termsOfTenancy: entity.terms_of_tenancy,
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

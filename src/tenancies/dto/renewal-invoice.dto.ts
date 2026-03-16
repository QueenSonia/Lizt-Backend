import { ApiProperty } from '@nestjs/swagger';

export class RenewalPeriodDto {
  @ApiProperty({
    description: 'Renewal start date (ISO format)',
    example: '2025-01-01',
  })
  startDate: string;

  @ApiProperty({
    description: 'Renewal end date (ISO format)',
    example: '2025-12-31',
  })
  endDate: string;
}

export class ChargesDto {
  @ApiProperty({
    description: 'Rent amount',
    example: 500000,
  })
  rentAmount: number;

  @ApiProperty({
    description: 'Service charge',
    example: 50000,
  })
  serviceCharge: number;

  @ApiProperty({
    description: 'Legal fee',
    example: 25000,
  })
  legalFee: number;

  @ApiProperty({
    description: 'Other charges',
    example: 0,
  })
  otherCharges: number;
}

export class RenewalInvoiceDto {
  @ApiProperty({
    description: 'Invoice ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Renewal token',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  token: string;

  @ApiProperty({
    description: 'Property name',
    example: 'Sunset Apartments',
  })
  propertyName: string;

  @ApiProperty({
    description: 'Property address',
    example: '123 Main Street, Lagos',
  })
  propertyAddress: string;

  @ApiProperty({
    description: 'Tenant name',
    example: 'John Doe',
  })
  tenantName: string;

  @ApiProperty({
    description: 'Tenant email address',
    example: 'tenant@example.com',
  })
  tenantEmail: string;

  @ApiProperty({
    description: 'Tenant phone number',
    example: '+2348012345678',
  })
  tenantPhone: string;

  @ApiProperty({
    description: 'Renewal period',
    type: RenewalPeriodDto,
  })
  renewalPeriod: RenewalPeriodDto;

  @ApiProperty({
    description: 'Charges breakdown',
    type: ChargesDto,
  })
  charges: ChargesDto;

  @ApiProperty({
    description: 'Total amount',
    example: 575000,
  })
  totalAmount: number;

  @ApiProperty({
    description: 'Payment status',
    example: 'unpaid',
    enum: ['unpaid', 'paid'],
  })
  paymentStatus: 'unpaid' | 'paid';

  @ApiProperty({
    description: 'Payment date (ISO format)',
    example: '2025-01-15T10:30:00Z',
    required: false,
  })
  paidAt?: string;

  @ApiProperty({
    description: 'Payment reference',
    example: 'RENEWAL_1234567890_abcd1234',
    required: false,
  })
  paymentReference?: string;

  @ApiProperty({
    description: 'Landlord branding information',
    required: false,
    example: {
      businessName: 'Property Kraft',
      businessAddress: '123 Business Street, Lagos',
      contactPhone: '+2348012345678',
      contactEmail: 'info@propertykraft.com',
      websiteLink: 'https://propertykraft.com',
    },
  })
  landlordBranding?: {
    businessName?: string;
    businessAddress?: string;
    contactPhone?: string;
    contactEmail?: string;
    websiteLink?: string;
    footerColor?: string;
    letterhead?: string;
    signature?: string;
    headingFont?: string;
    bodyFont?: string;
    updatedAt?: string;
  };

  @ApiProperty({
    description: 'Landlord logo URL',
    example: 'https://example.com/logo.png',
    required: false,
  })
  landlordLogoUrl?: string;
}

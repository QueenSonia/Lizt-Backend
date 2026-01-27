import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as puppeteer from 'puppeteer';
import { OfferLetter } from './entities/offer-letter.entity';
import { KYCApplication } from '../kyc-links/entities/kyc-application.entity';
import { Property } from '../properties/entities/property.entity';

/**
 * PDF Generator Service
 * Generates PDF documents for offer letters using Puppeteer
 * Requirements: 4.1, 4.3, 4.4
 */
@Injectable()
export class PDFGeneratorService {
  private readonly logger = new Logger(PDFGeneratorService.name);

  constructor(
    @InjectRepository(OfferLetter)
    private readonly offerLetterRepository: Repository<OfferLetter>,
    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepository: Repository<KYCApplication>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
  ) {}

  /**
   * Generate PDF for an offer letter by token
   * Requirements: 4.1, 4.3, 4.4
   */
  async generateOfferLetterPDF(token: string): Promise<Buffer> {
    const offerLetter = await this.offerLetterRepository.findOne({
      where: { token },
      relations: ['landlord', 'landlord.user'], // Load landlord and their user data for branding
    });

    if (!offerLetter) {
      throw new NotFoundException('Offer letter not found');
    }

    const kycApplication = await this.kycApplicationRepository.findOne({
      where: { id: offerLetter.kyc_application_id },
    });

    const property = await this.propertyRepository.findOne({
      where: { id: offerLetter.property_id },
    });

    if (!kycApplication || !property) {
      throw new NotFoundException('Offer letter data incomplete');
    }

    const html = this.generateOfferLetterHTML(
      offerLetter,
      kycApplication,
      property,
    );
    return this.htmlToPDF(html);
  }

  /**
   * Convert HTML to PDF using Puppeteer
   */
  private async htmlToPDF(html: string): Promise<Buffer> {
    let browser: puppeteer.Browser | null = null;

    try {
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });

      const page = await browser.newPage();
      await page.setContent(html, {
        waitUntil: 'domcontentloaded',
        timeout: 10000,
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '15mm',
          bottom: '20mm',
          left: '15mm',
        },
      });

      return Buffer.from(pdfBuffer);
    } catch (error) {
      this.logger.error(
        `Failed to generate PDF: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Format date to match frontend format (e.g., "1st January, 2026")
   */
  private formatDate(dateString: string): string {
    const date = new Date(dateString);
    const day = date.getDate();
    const month = date.toLocaleString('en-US', { month: 'long' });
    const year = date.getFullYear();

    const suffix =
      day === 1 || day === 21 || day === 31
        ? 'st'
        : day === 2 || day === 22
          ? 'nd'
          : day === 3 || day === 23
            ? 'rd'
            : 'th';

    return `${day}${suffix} ${month}, ${year}`;
  }

  /**
   * Calculate tenancy term in words (e.g., "One Year Fixed")
   */
  private calculateTenancyTerm(startDate: Date, endDate: Date): string {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const months = Math.round(
      (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30),
    );

    if (months >= 12) {
      const years = Math.floor(months / 12);
      return `${years} Year${years > 1 ? 's' : ''} Fixed`;
    }
    return `${months} Month${months > 1 ? 's' : ''} Fixed`;
  }

  /**
   * Format currency with Naira symbol
   */
  private formatCurrency(amount: number): string {
    return `₦${amount.toLocaleString()}`;
  }

  /**
   * Get standard terms of tenancy (matches frontend STANDARD_TERMS)
   */
  private getStandardTerms(): Array<{ title: string; content: string }> {
    return [
      {
        title: 'Permitted Use',
        content:
          'The Property shall be used solely for residential purposes. Commercial use, Airbnb/short-let, or subletting is strictly prohibited without the prior written consent of the Landlord.',
      },
      {
        title: 'Condition of Property',
        content:
          'The Property is being let "as is" based on its condition as at the date of inspection and acceptance by the Tenant. No further works, renovations, replacements, or modifications are required from the Landlord as a condition of taking possession, unless expressly stated in writing and agreed upon by both parties.',
      },
      {
        title: 'Conduct & Restrictions',
        content:
          "The Tenant shall not engage in any activity that may constitute a nuisance or disturbance to other occupants or neighbours. No noisy generators are allowed on the premises, however, the Tenant may install an inverter system. Pets must remain inside the Tenant's apartment at all times; pets in common areas are strictly prohibited. No illegal or immoral activity is permitted within the Property or on the premises.",
      },
      {
        title: 'Caution Deposit',
        content:
          'The Caution Deposit is refundable only after the Tenant has vacated and returned possession of the Property to the Landlord in good condition, fair wear and tear excepted. Deductions may be made from the Caution Deposit for damages beyond fair wear and tear, outstanding rent, utilities, or any other obligations under this Agreement.',
      },
      {
        title: 'Repairs & Maintenance',
        content:
          "The Tenant shall be responsible for all internal repairs and minor maintenance, including but not limited to plumbing fixtures, electrical fittings, door locks, and general upkeep of the interior. The Landlord shall be responsible for structural repairs and major building systems including the roof, foundation, and main building infrastructure. Any damage to the Property caused by the Tenant's negligence or misuse shall be the sole responsibility of the Tenant.",
      },
      {
        title: 'Access',
        content:
          "The Landlord or the Landlord's authorized representative may access the Property with reasonable notice to the Tenant for the purposes of inspection, repairs, maintenance, or in the event of an emergency. The Tenant shall grant such access and shall not unreasonably refuse entry.",
      },
      {
        title: 'Service of Notices',
        content:
          "Any notice to be served on the Tenant under this Agreement will be considered duly served if delivered by any of the following means: (i) left on the door of the Property; (ii) sent via WhatsApp to the Tenant's registered mobile number; (iii) sent via email to the Tenant's registered email address; or (iv) delivered by hand to the Tenant or any person of suitable age and discretion at the Property.",
      },
      {
        title: 'Breach & Termination',
        content:
          'In the event of a breach of any term or condition of this Agreement by the Tenant, the Landlord reserves the right to terminate the tenancy, disconnect the Property from general utilities and services, and commence eviction proceedings in accordance with applicable law. The Tenant shall remain liable for all rent and other obligations up to the date of termination.',
      },
      {
        title: 'Rent Refund',
        content:
          'If the tenancy is terminated before the expiry date, whether by the Tenant or by the Landlord (in the case of breach by the Tenant), the Tenant shall only be entitled to a refund of the rent for the unused days remaining on the tenancy, calculated on a pro-rata basis. The refund will be processed only after the Tenant has fully vacated the Property, returned possession to the Landlord, and settled all outstanding obligations including utilities, damages, and any other charges due under this Agreement.',
      },
    ];
  }

  /**
   * Generate HTML content for offer letter
   * Matches the OfferLetterDocument component exactly
   * Requirements: 4.3, 4.4
   */
  private generateOfferLetterHTML(
    offerLetter: OfferLetter,
    kycApplication: KYCApplication,
    property: Property,
  ): string {
    const applicantName = `${kycApplication.first_name} ${kycApplication.last_name}`;
    const nameParts = applicantName.split(' ');
    const lastName = nameParts[nameParts.length - 1];

    const today = this.formatDate(new Date().toISOString());
    const tenancyStartDate = this.formatDate(
      offerLetter.tenancy_start_date.toString(),
    );
    const tenancyEndDate = this.formatDate(
      offerLetter.tenancy_end_date.toString(),
    );
    const tenancyTerm = this.calculateTenancyTerm(
      offerLetter.tenancy_start_date,
      offerLetter.tenancy_end_date,
    );
    const tenancyPeriod = `${tenancyStartDate} to ${tenancyEndDate}`;

    const propertyName = property.name || 'Property';

    // Get landlord branding data from landlord.user
    const landlordUser = offerLetter.landlord?.user;
    const branding = landlordUser?.branding || {};
    const businessName = branding.businessName || 'Business Name';
    const businessAddress =
      branding.businessAddress ||
      '17 Ayinde Akinmade Street, Lekki Phase 1, Lagos State';
    const contactInfo =
      branding.contactInfo || 'contact@propertykraft.com | +234 901 234 5678';
    const footerColor = branding.footerColor || '#6B6B6B';
    const letterhead = branding.letterhead || '';
    const signature = branding.signature || '';
    const headingFont = branding.headingFont || 'Inter';
    const bodyFont = branding.bodyFont || 'Inter';

    // Use terms from database, or fall back to standard terms if none exist
    const terms =
      offerLetter.terms_of_tenancy && offerLetter.terms_of_tenancy.length > 0
        ? offerLetter.terms_of_tenancy
        : this.getStandardTerms();

    // Generate terms HTML
    const termsHtml = terms
      .map(
        (term, index) => `
      <div style="margin-bottom: 24px;">
        <h3 style="font-weight: 700; font-size: 14px; margin-bottom: 8px; font-family: ${headingFont}, sans-serif;">
          ${index + 1}. ${this.escapeHtml(term.title)}
        </h3>
        <div style="font-size: 14px; text-align: justify;">
          ${this.escapeHtml(term.content)}
        </div>
      </div>
    `,
      )
      .join('');

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Offer Letter - ${applicantName}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: ${bodyFont}, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #000;
      background: #fff;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 64px 80px;
    }
    
    /* Header Section */
    .header {
      display: flex;
      justify-content: flex-end;
      align-items: flex-start;
      margin-bottom: 48px;
    }
    .header img {
      height: 64px;
      max-width: 200px;
      object-fit: contain;
    }
    
    /* Date */
    .date-section {
      margin-bottom: 32px;
      font-size: 14px;
    }
    
    /* Recipient Address */
    .recipient-section {
      margin-bottom: 32px;
    }
    .recipient-section p {
      margin-bottom: 4px;
    }
    .recipient-section .name {
      font-weight: 700;
    }
    
    /* Salutation */
    .salutation {
      margin-bottom: 24px;
    }
    
    /* Main Heading */
    .main-heading {
      margin-bottom: 24px;
    }
    .main-heading h1 {
      font-family: ${headingFont}, sans-serif;
      font-weight: 700;
      font-size: 14px;
      text-transform: uppercase;
      text-decoration: underline;
    }
    
    /* Introduction */
    .intro-text {
      margin-bottom: 24px;
      font-size: 14px;
      text-align: justify;
    }
    
    /* Commercial Terms - Bullet Points */
    .terms-bullets {
      margin-bottom: 24px;
      font-size: 14px;
    }
    .terms-bullets .term-item {
      display: flex;
      margin-bottom: 8px;
    }
    .terms-bullets .bullet {
      margin-right: 8px;
      flex-shrink: 0;
    }
    .terms-bullets .term-content {
      flex: 1;
    }
    .terms-bullets strong {
      font-weight: 700;
    }
    
    /* Agreement Text */
    .agreement-text {
      margin-bottom: 32px;
      font-size: 14px;
      text-align: justify;
    }
    
    /* Closing Section */
    .closing-section {
      margin-bottom: 8px;
      font-size: 14px;
    }
    
    /* Signature Space */
    .signature-space {
      height: 64px;
      display: flex;
      align-items: center;
      margin-bottom: 8px;
    }
    .signature-space img {
      height: 48px;
      max-width: 200px;
      object-fit: contain;
    }
    
    /* For Landlord */
    .for-landlord {
      margin-bottom: 48px;
      font-size: 14px;
    }
    .for-landlord em {
      font-style: italic;
    }
    
    /* Page Divider */
    .page-divider {
      margin: 48px 0;
      border-top: 2px solid #d1d5db;
    }
    
    /* Terms of Tenancy Section */
    .terms-section {
      margin-bottom: 48px;
    }
    .terms-section h2 {
      font-family: ${headingFont}, sans-serif;
      font-weight: 700;
      font-size: 16px;
      text-transform: uppercase;
      margin-bottom: 24px;
      text-decoration: underline;
    }
    
    /* Footer Section */
    .footer-section {
      margin-top: 64px;
      padding-top: 32px;
      border-top: 1px solid #e5e7eb;
      text-align: right;
      color: ${footerColor};
    }
    .footer-section p {
      margin-bottom: 4px;
    }
    .footer-section .business-name,
    .footer-section .business-address {
      font-weight: 700;
      font-size: 14px;
    }
    .footer-section .contact-info {
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header Section -->
    <div class="header">
      ${letterhead ? `<img src="${letterhead}" alt="Logo" />` : ''}
    </div>

    <!-- Date -->
    <div class="date-section">
      <p>${today}</p>
    </div>

    <!-- Recipient Address -->
    <div class="recipient-section">
      <p class="name">${applicantName}</p>
      <p>Lagos, Nigeria</p>
    </div>

    <!-- Salutation -->
    <div class="salutation">
      <p>Dear Mr/Ms ${lastName},</p>
    </div>

    <!-- Main Heading -->
    <div class="main-heading">
      <h1>OFFER FOR RENT OF ${propertyName.toUpperCase()}</h1>
    </div>

    <!-- Introduction -->
    <div class="intro-text">
      <p>Following your visit and review of the property "${propertyName}" (hereafter the "Property"), we hereby make you an offer to rent the Property upon the following terms:</p>
    </div>

    <!-- Commercial Terms - Bullet Points -->
    <div class="terms-bullets">
      <div class="term-item">
        <span class="bullet">•</span>
        <div class="term-content">
          <strong>Permitted Use:</strong> Residential
        </div>
      </div>

      <div class="term-item">
        <span class="bullet">•</span>
        <div class="term-content">
          <strong>Rent:</strong> ${this.formatCurrency(offerLetter.rent_amount)}
        </div>
      </div>

      <div class="term-item">
        <span class="bullet">•</span>
        <div class="term-content">
          <strong>Service Charge:</strong> ${offerLetter.service_charge ? this.formatCurrency(offerLetter.service_charge) : '₦0'}
        </div>
      </div>

      <div class="term-item">
        <span class="bullet">•</span>
        <div class="term-content">
          <strong>Caution (Refundable):</strong> ${this.formatCurrency(offerLetter.caution_deposit)}
        </div>
      </div>

      <div class="term-item">
        <span class="bullet">•</span>
        <div class="term-content">
          <strong>Legal Fee:</strong> ${this.formatCurrency(offerLetter.legal_fee)}
        </div>
      </div>

      <div class="term-item">
        <span class="bullet">•</span>
        <div class="term-content">
          <strong>Agency Fee:</strong> ${this.escapeHtml(offerLetter.agency_fee)}
        </div>
      </div>

      <div class="term-item">
        <span class="bullet">•</span>
        <div class="term-content">
          <strong>Tenancy Term:</strong> ${tenancyTerm}
        </div>
      </div>

      <div class="term-item">
        <span class="bullet">•</span>
        <div class="term-content">
          <strong>Tenancy Period:</strong> ${tenancyPeriod}
        </div>
      </div>
    </div>

    <!-- Non-binding Agreement Text -->
    <div class="agreement-text">
      <p>This Offer and the attached Terms of Tenancy (together the "Agreement") is non-binding until you have accepted this offer, made payment of all sums due into the company's designated bank account, and have been granted possession of the Property by the Landlord or the Landlord's authorized representative.</p>
    </div>

    <!-- Closing Section -->
    <div class="closing-section">
      <p>Yours faithfully,</p>
    </div>

    <!-- Signature Space -->
    <div class="signature-space">
      ${signature ? `<img src="${signature}" alt="Signature" />` : ''}
    </div>

    <!-- For Landlord -->
    <div class="for-landlord">
      <p><em>For Landlord</em></p>
    </div>

    <!-- Page Divider -->
    <div class="page-divider"></div>

    <!-- Terms of Tenancy Section -->
    <div class="terms-section">
      <h2>Terms of Tenancy</h2>
      <div>
        ${termsHtml}
      </div>
    </div>

    <!-- Footer Section -->
    <div class="footer-section">
      <p class="business-name">${this.escapeHtml(businessName)}</p>
      <p class="business-address">${this.escapeHtml(businessAddress)}</p>
      <p class="contact-info">${this.escapeHtml(contactInfo)}</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    const htmlEntities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return text.replace(/[&<>"']/g, (char) => htmlEntities[char]);
  }
}

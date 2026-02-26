import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as puppeteer from 'puppeteer';
import { OfferLetter, TermsOfTenancy } from './entities/offer-letter.entity';
import { KYCApplication } from '../kyc-links/entities/kyc-application.entity';
import { Property } from '../properties/entities/property.entity';
import { FileUploadService } from '../utils/cloudinary';

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
    private readonly fileUploadService: FileUploadService,
  ) {}

  /**
   * Generate PDF for an offer letter by token
   * Requirements: 4.1, 4.3, 4.4
   */
  async generateOfferLetterPDF(token: string): Promise<Buffer> {
    const offerLetter = await this.offerLetterRepository.findOne({
      where: { token },
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
   * Generate and cache PDF in the background
   */
  async generatePDFInBackground(token: string): Promise<void> {
    try {
      const offerLetter = await this.offerLetterRepository.findOne({
        where: { token },
      });

      if (!offerLetter) {
        this.logger.error(
          `Cannot generate PDF: Offer letter with token ${token} not found`,
        );
        return;
      }

      // Generate the PDF
      const pdfBuffer = await this.generateOfferLetterPDF(token);

      // Upload to Cloudinary
      const filename = `offer-letter-${token.substring(0, 8)}-${Date.now()}`;
      const uploadResult = await this.fileUploadService.uploadBuffer(
        pdfBuffer,
        filename,
      );

      // Update offer letter with cached URL
      await this.offerLetterRepository.update(offerLetter.id, {
        pdf_url: uploadResult.secure_url,
        pdf_generated_at: new Date(),
      });

      this.logger.log(
        `Background PDF generation successful for token: ${token}`,
      );
    } catch (error) {
      this.logger.error(
        `Background PDF generation failed: ${error.message}`,
        error.stack,
      );
    }
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
   * Format date to readable string (e.g., "January 15, 2025")
   */
  private formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  /**
   * Calculate tenancy term in months/years
   */
  private calculateTenancyTerm(startDate: Date, endDate: Date): string {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const months =
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth());

    if (months >= 12) {
      const years = Math.floor(months / 12);
      const remainingMonths = months % 12;
      if (remainingMonths === 0) {
        return years === 1 ? '1 year' : `${years} years`;
      }
      return `${years} year${years > 1 ? 's' : ''} and ${remainingMonths} month${remainingMonths > 1 ? 's' : ''}`;
    }
    return months === 1 ? '1 month' : `${months} months`;
  }

  /**
   * Format currency with Naira symbol
   */
  private formatCurrency(amount: number | undefined | null): string {
    if (amount === undefined || amount === null || isNaN(amount)) return '₦0';
    // Use regex for formatting to avoid locale issues in Node environments
    const parts = amount.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `₦${parts.join('.')}`;
  }

  /**
   * Generate HTML content for offer letter
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
    const snapshot = offerLetter.content_snapshot;

    // Use snapshot if available, otherwise format manually
    const tenancyStartDateFormatted =
      snapshot?.tenancy_period?.split(' to ')[0] ||
      this.formatDate(offerLetter.tenancy_start_date.toString());
    const tenancyEndDateFormatted =
      snapshot?.tenancy_period?.split(' to ')[1] ||
      this.formatDate(offerLetter.tenancy_end_date.toString());
    const tenancyTerm =
      snapshot?.tenancy_term ||
      this.calculateTenancyTerm(
        offerLetter.tenancy_start_date,
        offerLetter.tenancy_end_date,
      );
    const tenancyPeriod =
      snapshot?.tenancy_period ||
      `${tenancyStartDateFormatted} to ${tenancyEndDateFormatted}`;

    const propertyName = property.name || 'Property';
    const propertyAddress = snapshot?.tenant_address || 'Lagos, Nigeria';

    // Get landlord branding data from branding field
    const branding = offerLetter.branding || ({} as any);
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
        : [];

    // Generate terms HTML
    const termsHtml =
      terms.length > 0
        ? terms
            .map(
              (term, index) => `
      <div style="margin-bottom: 24px;">
        <h3 style="font-weight: 700; font-size: 14px; margin-bottom: 12px; font-family: ${headingFont}, sans-serif;">
          ${index + 1}. ${this.escapeHtml(term.title)}
        </h3>
        <div style="font-size: 14px; line-height: 1.6; text-align: justify;">
          ${this.formatTermContent(term.content)}
        </div>
      </div>
    `,
            )
            .join('')
        : '<p>Standard terms of tenancy apply.</p>';

    const offerTitle =
      snapshot?.offer_title ||
      `OFFER FOR RENT OF ${propertyName.toUpperCase()}`;
    const introText =
      snapshot?.intro_text ||
      `Following your visit and review of the property "${propertyName}" (hereafter the "Property"), we hereby make you an offer to rent the Property upon the following terms:`;
    const agreementText =
      snapshot?.agreement_text ||
      'This Offer and the attached Terms of Tenancy (together the "Agreement") is non-binding until you have accepted this offer, made payment of all sums due into the company\'s designated bank account, and have been granted possession of the Property by the Landlord or the Landlord\'s authorized representative.';

    // Strip HTML tags from editable fields (they may contain HTML from contentEditable)
    const cleanOfferTitle = this.stripHtmlTags(offerTitle);
    const cleanIntroText = this.stripHtmlTags(introText);
    const cleanAgreementText = this.stripHtmlTags(agreementText);
    const cleanClosingText = this.stripHtmlTags(
      snapshot?.closing_text || 'Yours faithfully,',
    );
    const cleanForLandlordText = this.stripHtmlTags(
      snapshot?.for_landlord_text || 'For Landlord',
    );
    const cleanPermittedUse = this.stripHtmlTags(
      snapshot?.permitted_use || 'Residential',
    );

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Offer Letter - ${applicantName}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: ${bodyFont === 'Inter' ? "'Inter', sans-serif" : bodyFont}, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      line-height: 1.428;
      color: #000;
      background: #fff;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 64px 80px;
    }
    
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
    
    .date-section {
      margin-bottom: 32px;
      font-size: 14px;
    }
    
    .recipient-section {
      margin-bottom: 32px;
    }
    .recipient-section p {
      margin-bottom: 4px;
    }
    .recipient-section .name {
      font-weight: 700;
    }
    
    .salutation {
      margin-bottom: 24px;
    }
    
    .main-heading {
      margin-bottom: 24px;
    }
    .main-heading h1 {
      font-family: ${headingFont === 'Inter' ? "'Inter', sans-serif" : headingFont}, sans-serif;
      font-weight: 700;
      font-size: 14px;
      text-transform: uppercase;
      text-decoration: underline;
    }
    
    .intro-text {
      margin-bottom: 32px;
      font-size: 14px;
      text-align: justify;
    }
    .intro-text p {
      margin-bottom: 0;
    }
    
    .terms-bullets {
      margin-bottom: 32px;
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
    
    .agreement-text {
      margin-bottom: 32px;
      font-size: 14px;
      text-align: justify;
    }
    .agreement-text p {
      margin-bottom: 0;
    }
    
    .closing-section {
      margin-bottom: 8px;
      font-size: 14px;
    }
    
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
    
    .for-landlord {
      margin-bottom: 48px;
      font-size: 14px;
    }
    .for-landlord em {
      font-style: italic;
    }
    
    .page-divider {
      margin: 48px 0;
      border-top: 2px solid #d1d5db;
      page-break-after: always;
    }
    
    .terms-section {
      margin-bottom: 48px;
    }
    .terms-section h2 {
      font-family: ${headingFont === 'Inter' ? "'Inter', sans-serif" : headingFont}, sans-serif;
      font-weight: 700;
      font-size: 16px;
      text-transform: uppercase;
      margin-bottom: 24px;
      text-decoration: underline;
    }
    .terms-section h3 {
      font-weight: 700;
      font-size: 14px;
      margin-bottom: 12px;
      line-height: 1.4;
    }
    .terms-section p {
      margin: 0;
      line-height: 1.6;
    }
    .terms-section ul {
      margin: 0;
      padding-left: 24px;
      list-style-type: disc;
    }
    .terms-section li {
      margin-bottom: 8px;
      line-height: 1.6;
    }
    
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
    <div class="header">
      ${letterhead ? `<img src="${letterhead}" alt="Logo" />` : ''}
    </div>

    <div class="date-section">
      <p>${today}</p>
    </div>

    <div class="recipient-section">
      <p class="name">${applicantName}</p>
      <p>${this.escapeHtml(propertyAddress)}</p>
    </div>

    <div class="salutation">
      <p>Dear Mr/Ms ${lastName},</p>
    </div>

    <div class="main-heading">
      <h1>${this.escapeHtml(cleanOfferTitle)}</h1>
    </div>

    <div class="intro-text">
      <p>${this.escapeHtml(cleanIntroText)}</p>
    </div>

    <div class="terms-bullets">
      <div class="term-item">
        <span class="bullet">•</span>
        <div class="term-content">
          <strong>Permitted Use:</strong> ${this.escapeHtml(cleanPermittedUse)}
        </div>
      </div>

      <div class="term-item">
        <span class="bullet">•</span>
        <div class="term-content">
          <strong>Rent:</strong> ${snapshot?.rent_amount_formatted || this.formatCurrency(offerLetter.rent_amount)}
        </div>
      </div>

      <div class="term-item">
        <span class="bullet">•</span>
        <div class="term-content">
          <strong>Service Charge:</strong> ${snapshot?.service_charge_formatted || (offerLetter.service_charge ? this.formatCurrency(offerLetter.service_charge) : '₦0')}
        </div>
      </div>

      ${
        (snapshot?.caution_deposit_formatted &&
          snapshot.caution_deposit_formatted !== '₦0' &&
          snapshot.caution_deposit_formatted !== '') ||
        (offerLetter.caution_deposit && offerLetter.caution_deposit > 0)
          ? `
      <div class="term-item">
        <span class="bullet">•</span>
        <div class="term-content">
          <strong>Caution (Refundable):</strong> ${snapshot?.caution_deposit_formatted || this.formatCurrency(offerLetter.caution_deposit)}
        </div>
      </div>
      `
          : ''
      }

      ${
        (snapshot?.legal_fee_formatted &&
          snapshot.legal_fee_formatted !== '₦0' &&
          snapshot.legal_fee_formatted !== '') ||
        (offerLetter.legal_fee && offerLetter.legal_fee > 0)
          ? `
      <div class="term-item">
        <span class="bullet">•</span>
        <div class="term-content">
          <strong>Legal Fee:</strong> ${snapshot?.legal_fee_formatted || this.formatCurrency(offerLetter.legal_fee)}
        </div>
      </div>
      `
          : ''
      }

      <div class="term-item">
        <span class="bullet">•</span>
        <div class="term-content">
          <strong>Agency Fee:</strong> ${snapshot?.agency_fee_formatted || this.escapeHtml(offerLetter.agency_fee?.toString() || 'N/A')}
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

    <div class="agreement-text">
      <p>${this.escapeHtml(cleanAgreementText)}</p>
    </div>

    <div class="closing-section">
      <p>${this.escapeHtml(cleanClosingText)}</p>
    </div>

    <div class="signature-space">
      ${signature ? `<img src="${signature}" alt="Signature" />` : ''}
    </div>

    <div class="for-landlord">
      <p><em>${this.escapeHtml(cleanForLandlordText)}</em></p>
    </div>

    <div class="page-divider"></div>

    <div class="terms-section">
      <h2>Terms of Tenancy</h2>
      <div>
        ${termsHtml}
      </div>
    </div>

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
   * Get human-readable rent frequency label
   */
  private getRentFrequencyLabel(frequency: string): string {
    const labels: Record<string, string> = {
      monthly: 'per month',
      quarterly: 'per quarter',
      biannually: 'per 6 months',
      annually: 'per year',
    };
    return labels[frequency] || frequency;
  }

  /**
   * Generate HTML for terms of tenancy
   */
  private generateTermsHtml(terms: TermsOfTenancy[]): string {
    if (!terms || terms.length === 0) {
      return '<p>Standard terms of tenancy apply.</p>';
    }

    const termItems = terms
      .map(
        (term) =>
          `<li><strong>${this.escapeHtml(term.title)}:</strong> ${this.escapeHtml(term.content)}</li>`,
      )
      .join('\n');

    return `<ol class="terms-list">${termItems}</ol>`;
  }

  /**
   * Format term content - converts newlines to proper HTML structure
   * Handles both plain text and newline-separated lists
   */
  private formatTermContent(content: string): string {
    if (!content) return '';

    // Split by newlines to detect if it's a list
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    // If single line, return as paragraph
    if (lines.length === 1) {
      return `<p style="margin: 0;">${this.escapeHtml(lines[0])}</p>`;
    }

    // If multiple lines, render as bullet list
    const listItems = lines
      .map(
        (line) =>
          `<li style="margin-bottom: 8px;">${this.escapeHtml(line)}</li>`,
      )
      .join('');

    return `<ul style="margin: 0; padding-left: 24px; list-style-type: disc;">${listItems}</ul>`;
  }

  /**
   * Strip HTML tags and convert to plain text while preserving basic formatting
   * Used for contentEditable fields that may contain HTML
   */
  private stripHtmlTags(html: string): string {
    if (!html) return '';

    // Replace <br> and <br/> with newlines
    let text = html.replace(/<br\s*\/?>/gi, '\n');

    // Replace </p> and </div> with newlines
    text = text.replace(/<\/(p|div)>/gi, '\n');

    // Remove all other HTML tags
    text = text.replace(/<[^>]*>/g, '');

    // Decode HTML entities
    text = this.decodeHtmlEntities(text);

    // Clean up multiple newlines
    text = text.replace(/\n\s*\n/g, '\n');

    // Trim whitespace
    return text.trim();
  }

  /**
   * Decode common HTML entities
   */
  private decodeHtmlEntities(text: string): string {
    const entities: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&nbsp;': ' ',
    };

    let decoded = text;
    for (const [entity, char] of Object.entries(entities)) {
      decoded = decoded.replace(new RegExp(entity, 'g'), char);
    }

    return decoded;
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

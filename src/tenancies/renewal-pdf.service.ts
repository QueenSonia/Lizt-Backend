import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as puppeteer from 'puppeteer';
import { RenewalInvoice } from './entities/renewal-invoice.entity';

/**
 * Renewal PDF Service
 * Generates PDF invoices for renewal payments using Puppeteer
 * Requirements: 9.1-9.5
 */
@Injectable()
export class RenewalPDFService {
  private readonly logger = new Logger(RenewalPDFService.name);

  constructor(
    @InjectRepository(RenewalInvoice)
    private readonly renewalInvoiceRepository: Repository<RenewalInvoice>,
  ) {}

  /**
   * Generate PDF invoice for a renewal by token
   * Requirements: 9.2-9.5
   */
  async generateRenewalInvoicePDF(token: string): Promise<Buffer> {
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { token },
      relations: ['property', 'tenant', 'tenant.user', 'propertyTenant'],
    });

    if (!invoice) {
      throw new NotFoundException('Renewal invoice not found');
    }

    if (invoice.payment_status !== 'paid') {
      throw new NotFoundException('Invoice must be paid to generate PDF');
    }

    const html = this.generateInvoiceHTML(invoice);
    return this.htmlToPDF(html);
  }

  /**
   * Generate filename for renewal invoice PDF
   * Format: renewal-invoice-{propertyName}-{date}.pdf
   * Requirements: 9.5
   */
  generateFilename(propertyName: string, date: Date = new Date()): string {
    // Sanitize property name for filename
    const sanitizedName = propertyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    // Format date as YYYY-MM-DD
    const dateStr = date.toISOString().split('T')[0];

    return `renewal-invoice-${sanitizedName}-${dateStr}.pdf`;
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
  private formatDate(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  /**
   * Format currency with Naira symbol
   */
  private formatCurrency(amount: number | undefined | null): string {
    if (amount === undefined || amount === null || isNaN(amount)) return '₦0';
    const parts = amount.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `₦${parts.join('.')}`;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    if (!text) return '';
    const htmlEntities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return text.replace(/[&<>"']/g, (char) => htmlEntities[char]);
  }

  /**
   * Generate HTML template for renewal invoice PDF
   * Requirements: 9.3, 9.4
   */
  private generateInvoiceHTML(invoice: RenewalInvoice): string {
    const propertyName = invoice.property?.name || 'Property';
    const propertyAddress = invoice.property?.location || 'Lagos, Nigeria';
    const tenantName = invoice.tenant?.user
      ? `${invoice.tenant.user.first_name} ${invoice.tenant.user.last_name}`
      : 'Tenant';

    const today = this.formatDate(new Date());
    const startDate = this.formatDate(invoice.start_date);
    const endDate = this.formatDate(invoice.end_date);
    const paymentDate = invoice.paid_at
      ? this.formatDate(invoice.paid_at)
      : 'N/A';
    const paymentReference = invoice.payment_reference || 'N/A';

    const rentAmount = this.formatCurrency(Number(invoice.rent_amount));
    const serviceCharge = this.formatCurrency(Number(invoice.service_charge));
    const legalFee = this.formatCurrency(Number(invoice.legal_fee));
    const otherCharges = this.formatCurrency(Number(invoice.other_charges));
    const totalAmount = this.formatCurrency(Number(invoice.total_amount));

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Renewal Invoice - ${this.escapeHtml(propertyName)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #1f2937;
      background: #fff;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 48px 60px;
    }
    
    .header {
      text-align: center;
      margin-bottom: 40px;
      padding-bottom: 24px;
      border-bottom: 3px solid #10b981;
    }
    .header h1 {
      font-size: 28px;
      font-weight: 700;
      color: #10b981;
      margin-bottom: 8px;
    }
    .header .subtitle {
      font-size: 16px;
      color: #6b7280;
      font-weight: 600;
    }
    
    .invoice-info {
      display: flex;
      justify-content: space-between;
      margin-bottom: 32px;
      padding: 20px;
      background: #f9fafb;
      border-radius: 8px;
    }
    .invoice-info .section {
      flex: 1;
    }
    .invoice-info .label {
      font-size: 12px;
      color: #6b7280;
      text-transform: uppercase;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .invoice-info .value {
      font-size: 14px;
      color: #1f2937;
      font-weight: 600;
    }
    
    .property-section,
    .tenant-section {
      margin-bottom: 24px;
    }
    .section-title {
      font-size: 14px;
      font-weight: 700;
      color: #374151;
      text-transform: uppercase;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e5e7eb;
    }
    .section-content {
      padding-left: 16px;
    }
    .section-content p {
      margin-bottom: 4px;
      font-size: 14px;
    }
    .section-content .label {
      font-weight: 600;
      color: #6b7280;
      display: inline-block;
      width: 140px;
    }
    
    .charges-section {
      margin: 32px 0;
    }
    .charges-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 16px;
    }
    .charges-table thead {
      background: #f3f4f6;
    }
    .charges-table th {
      text-align: left;
      padding: 12px 16px;
      font-size: 13px;
      font-weight: 700;
      color: #374151;
      text-transform: uppercase;
      border-bottom: 2px solid #d1d5db;
    }
    .charges-table td {
      padding: 12px 16px;
      font-size: 14px;
      border-bottom: 1px solid #e5e7eb;
    }
    .charges-table .amount {
      text-align: right;
      font-weight: 600;
    }
    .charges-table .total-row {
      background: #f9fafb;
      font-weight: 700;
    }
    .charges-table .total-row td {
      padding: 16px;
      font-size: 16px;
      border-top: 2px solid #10b981;
      border-bottom: 2px solid #10b981;
    }
    
    .payment-confirmation {
      margin: 32px 0;
      padding: 24px;
      background: #d1fae5;
      border-left: 4px solid #10b981;
      border-radius: 8px;
    }
    .payment-confirmation h2 {
      font-size: 16px;
      font-weight: 700;
      color: #065f46;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
    }
    .payment-confirmation h2::before {
      content: "✓";
      display: inline-block;
      width: 24px;
      height: 24px;
      background: #10b981;
      color: white;
      border-radius: 50%;
      text-align: center;
      line-height: 24px;
      margin-right: 12px;
      font-size: 16px;
    }
    .payment-confirmation .detail {
      margin-bottom: 8px;
      font-size: 14px;
    }
    .payment-confirmation .detail .label {
      font-weight: 600;
      color: #065f46;
      display: inline-block;
      width: 160px;
    }
    .payment-confirmation .detail .value {
      color: #047857;
    }
    
    .footer {
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #6b7280;
      font-size: 12px;
    }
    .footer p {
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>RENEWAL INVOICE</h1>
      <div class="subtitle">Payment Receipt</div>
    </div>

    <div class="invoice-info">
      <div class="section">
        <div class="label">Invoice Date</div>
        <div class="value">${today}</div>
      </div>
      <div class="section">
        <div class="label">Invoice ID</div>
        <div class="value">${this.escapeHtml(invoice.token.substring(0, 8).toUpperCase())}</div>
      </div>
    </div>

    <div class="property-section">
      <div class="section-title">Property Details</div>
      <div class="section-content">
        <p><span class="label">Property Name:</span> ${this.escapeHtml(propertyName)}</p>
        <p><span class="label">Property Address:</span> ${this.escapeHtml(propertyAddress)}</p>
        <p><span class="label">Renewal Period:</span> ${startDate} to ${endDate}</p>
      </div>
    </div>

    <div class="tenant-section">
      <div class="section-title">Tenant Information</div>
      <div class="section-content">
        <p><span class="label">Tenant Name:</span> ${this.escapeHtml(tenantName)}</p>
      </div>
    </div>

    <div class="charges-section">
      <div class="section-title">Charges Breakdown</div>
      <table class="charges-table">
        <thead>
          <tr>
            <th>Description</th>
            <th class="amount">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Rent Amount</td>
            <td class="amount">${rentAmount}</td>
          </tr>
          ${
            Number(invoice.service_charge) > 0
              ? `
          <tr>
            <td>Service Charge</td>
            <td class="amount">${serviceCharge}</td>
          </tr>
          `
              : ''
          }
          ${
            Number(invoice.legal_fee) > 0
              ? `
          <tr>
            <td>Legal Fee</td>
            <td class="amount">${legalFee}</td>
          </tr>
          `
              : ''
          }
          ${
            Number(invoice.other_charges) > 0
              ? `
          <tr>
            <td>Other Charges</td>
            <td class="amount">${otherCharges}</td>
          </tr>
          `
              : ''
          }
          <tr class="total-row">
            <td>Total Amount</td>
            <td class="amount">${totalAmount}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="payment-confirmation">
      <h2>Payment Confirmed</h2>
      <div class="detail">
        <span class="label">Payment Date:</span>
        <span class="value">${paymentDate}</span>
      </div>
      <div class="detail">
        <span class="label">Transaction Reference:</span>
        <span class="value">${this.escapeHtml(paymentReference)}</span>
      </div>
      <div class="detail">
        <span class="label">Amount Paid:</span>
        <span class="value">${totalAmount}</span>
      </div>
    </div>

    <div class="footer">
      <p>This is an automatically generated invoice.</p>
      <p>Thank you for your payment.</p>
    </div>
  </div>
</body>
</html>
    `;
  }
}

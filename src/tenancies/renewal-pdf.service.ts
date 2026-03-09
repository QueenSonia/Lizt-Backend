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
      relations: [
        'property',
        'property.owner',
        'property.owner.user',
        'tenant',
        'tenant.user',
        'propertyTenant',
      ],
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
        waitUntil: 'networkidle0',
        timeout: 15000,
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
   * Matches the frontend UI at /renewal-invoice/[token]
   * Requirements: 9.3, 9.4
   */
  private generateInvoiceHTML(invoice: RenewalInvoice): string {
    const propertyName = invoice.property?.name || 'Property';
    const propertyAddress = invoice.property?.location || 'Lagos, Nigeria';
    const tenantName = invoice.tenant?.user
      ? `${invoice.tenant.user.first_name} ${invoice.tenant.user.last_name}`
      : 'Tenant';

    const startDate = this.formatDate(invoice.start_date);
    const endDate = this.formatDate(invoice.end_date);
    const paymentDate = invoice.paid_at
      ? this.formatDate(invoice.paid_at)
      : null;
    const paymentReference = invoice.payment_reference || null;

    const rentAmount = this.formatCurrency(Number(invoice.rent_amount));
    const serviceCharge = Number(invoice.service_charge);
    const legalFee = Number(invoice.legal_fee);
    const otherCharges = Number(invoice.other_charges);
    const totalAmount = this.formatCurrency(Number(invoice.total_amount));

    const isPaid = invoice.payment_status === 'paid';

    // Get landlord logo URL
    const landlordUser = (invoice.property as any)?.owner?.user;
    const landlordLogoUrl =
      landlordUser?.logo_urls?.[0] ||
      landlordUser?.branding?.letterhead ||
      null;
    const landlordName =
      landlordUser?.branding?.businessName ||
      (landlordUser
        ? `${landlordUser.first_name} ${landlordUser.last_name}`
        : 'Landlord');

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
      background: #f9fafb;
      color: #1a1b23;
    }
    .invoice-wrapper {
      display: flex;
      justify-content: center;
    }
    .invoice-card {
      background: #fff;
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      max-width: 850px;
      width: 100%;
      padding: 48px;
    }
    .landlord-logo {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 32px;
    }
    .landlord-logo img {
      height: 50px;
      width: auto;
      object-fit: contain;
    }
    .invoice-title {
      font-size: 16px;
      line-height: 22px;
      font-weight: 700;
      color: #1a1b23;
      margin-bottom: 32px;
      text-transform: uppercase;
      text-align: center;
    }
    .paid-badge {
      display: flex;
      justify-content: center;
      margin-bottom: 24px;
    }
    .paid-badge-inner {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      background: #dcfce7;
      color: #166534;
      border-radius: 9999px;
      font-size: 14px;
      font-weight: 500;
    }
    .paid-dot {
      width: 8px;
      height: 8px;
      background: #16a34a;
      border-radius: 50%;
    }
    .info-section {
      margin-bottom: 32px;
    }
    .info-group {
      margin-bottom: 16px;
    }
    .info-label {
      font-size: 11px;
      line-height: 15px;
      color: #6b7280;
      margin-bottom: 4px;
    }
    .info-value {
      font-size: 11px;
      line-height: 15px;
      color: #1a1b23;
    }
    .info-value-bold {
      font-size: 11px;
      line-height: 15px;
      color: #1a1b23;
      font-weight: 700;
    }
    .gradient-separator {
      height: 1px;
      background: linear-gradient(to right, transparent, #d1d5db, transparent);
      margin: 32px 0;
    }
    .charges-title {
      font-size: 12px;
      line-height: 16px;
      font-weight: 700;
      color: #1a1b23;
      margin-bottom: 24px;
      text-transform: uppercase;
    }
    .charge-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .charge-label {
      font-size: 11px;
      line-height: 15px;
      color: #1a1b23;
    }
    .charge-amount {
      font-size: 11px;
      line-height: 15px;
      color: #1a1b23;
      font-weight: 700;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 16px;
      margin-top: 8px;
      border-top: 2px solid #111827;
    }
    .total-label {
      font-size: 14px;
      line-height: 18px;
      color: #1a1b23;
      font-weight: 700;
      text-transform: uppercase;
    }
    .total-amount {
      font-size: 18px;
      line-height: 24px;
      color: #1a1b23;
      font-weight: 700;
    }
    .payment-box {
      margin-bottom: 32px;
      padding: 16px;
      background: #f0fdf4;
      border-radius: 8px;
      border: 1px solid #bbf7d0;
    }
    .payment-box-title {
      font-size: 12px;
      line-height: 16px;
      font-weight: 700;
      color: #14532d;
      margin-bottom: 8px;
      text-transform: uppercase;
    }
    .payment-detail {
      font-size: 11px;
      line-height: 15px;
      color: #166534;
      margin-bottom: 4px;
    }
    .payment-detail-bold {
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="invoice-wrapper">
    <div class="invoice-card">

      ${
        landlordLogoUrl
          ? `<!-- Landlord logo -->
      <div class="landlord-logo">
        <img alt="${this.escapeHtml(landlordName)}" src="${this.escapeHtml(landlordLogoUrl)}" />
      </div>`
          : ''
      }

      <!-- Title -->
      <h1 class="invoice-title">Tenancy Renewal Invoice</h1>

      ${
        isPaid
          ? `<!-- Paid badge -->
      <div class="paid-badge">
        <div class="paid-badge-inner">
          <span class="paid-dot"></span>
          Paid
        </div>
      </div>`
          : ''
      }

      <!-- Property and Tenant Information -->
      <div class="info-section">
        <div class="info-group">
          <p class="info-label">Property Name</p>
          <p class="info-value-bold">${this.escapeHtml(propertyName)}</p>
          <p class="info-value">${this.escapeHtml(propertyAddress)}</p>
        </div>

        <div class="info-group">
          <p class="info-label">Tenant Name</p>
          <p class="info-value-bold">${this.escapeHtml(tenantName)}</p>
        </div>

        <div class="info-group">
          <p class="info-label">Renewal Period</p>
          <p class="info-value">${startDate} to ${endDate}</p>
        </div>
      </div>

      <!-- Gradient separator -->
      <div class="gradient-separator"></div>

      <!-- Breakdown of Charges -->
      <div style="margin-bottom: 32px;">
        <h2 class="charges-title">Breakdown of Charges</h2>

        <div class="charge-row">
          <span class="charge-label">Rent</span>
          <span class="charge-amount">${rentAmount}</span>
        </div>

        ${
          serviceCharge > 0
            ? `<div class="charge-row">
          <span class="charge-label">Service Charge</span>
          <span class="charge-amount">${this.formatCurrency(serviceCharge)}</span>
        </div>`
            : ''
        }

        ${
          legalFee > 0
            ? `<div class="charge-row">
          <span class="charge-label">Legal Fee</span>
          <span class="charge-amount">${this.formatCurrency(legalFee)}</span>
        </div>`
            : ''
        }

        ${
          otherCharges > 0
            ? `<div class="charge-row">
          <span class="charge-label">Other Charges</span>
          <span class="charge-amount">${this.formatCurrency(otherCharges)}</span>
        </div>`
            : ''
        }

        <!-- Total -->
        <div class="total-row">
          <span class="total-label">Total Amount Payable</span>
          <span class="total-amount">${totalAmount}</span>
        </div>
      </div>

      ${
        isPaid && paymentDate
          ? `<!-- Gradient separator -->
      <div class="gradient-separator"></div>

      <!-- Payment Confirmed -->
      <div class="payment-box">
        <h3 class="payment-box-title">Payment Confirmed</h3>
        <p class="payment-detail">
          <span class="payment-detail-bold">Payment Date:</span> ${paymentDate}
        </p>
        ${
          paymentReference
            ? `<p class="payment-detail">
          <span class="payment-detail-bold">Reference:</span> ${this.escapeHtml(paymentReference)}
        </p>`
            : ''
        }
      </div>`
          : ''
      }

      <!-- Gradient separator -->
      <div class="gradient-separator"></div>

    </div>
  </div>
</body>
</html>
    `;
  }
}

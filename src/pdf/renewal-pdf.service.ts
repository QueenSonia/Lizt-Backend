import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Browser } from 'puppeteer';

import { launchBrowser } from '../common/puppeteer-launch';
import { renderUnifiedReceiptHTML } from '../common/html/unified-receipt-template';
import { resolveBrandingUser } from '../common/branding/branding.util';
import { RenewalInvoice } from '../tenancies/entities/renewal-invoice.entity';
import { renewalInvoiceToFees, sumAll, Fee } from '../common/billing/fees';

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
        'property.owner.creator',
        'property.owner.creator.user',
        'tenant',
        'tenant.user',
        'tenant.user.tenant_kycs',
        'propertyTenant',
      ],
    });

    if (!invoice) {
      throw new NotFoundException('Renewal invoice not found');
    }

    const html = this.generateInvoiceHTML(invoice);
    return this.htmlToPDF(html);
  }
  /**
   * Generate PDF receipt for renewal payment
   * Requirements: 6.1, 6.2, 6.3, 6.4, 9.1, 9.2, 9.3, 9.4, 9.5
   */
  async generateRenewalReceiptPDF(receiptToken: string): Promise<Buffer> {
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { receipt_token: receiptToken },
      relations: [
        'property',
        'property.owner',
        'property.owner.user',
        'property.owner.creator',
        'property.owner.creator.user',
        'tenant',
        'tenant.user',
        'propertyTenant',
      ],
    });

    if (!invoice) {
      throw new NotFoundException('Receipt not found');
    }

    if (
      invoice.payment_status !== 'paid' &&
      invoice.payment_status !== 'partial'
    ) {
      throw new NotFoundException('Receipt not available - payment required');
    }

    const html = this.generateReceiptHTML(invoice);
    return this.htmlToPDF(html);
  }

  /**
   * Generate filename for receipt PDF in format "payment-receipt-{propertyName}-{date}.pdf"
   * Requirements: 6.3
   */
  generateReceiptFilename(
    propertyName: string,
    date: Date = new Date(),
  ): string {
    // Sanitize property name for filename
    const sanitizedName = propertyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    // Format date as YYYY-MM-DD
    const dateStr = date.toISOString().split('T')[0];

    return `payment-receipt-${sanitizedName}-${dateStr}.pdf`;
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
    let browser: Browser | null = null;

    try {
      browser = await launchBrowser();

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
   * Matches the frontend UI at /renewal-invoice/[token] exactly
   * Requirements: 9.3, 9.4, 10.1-10.4, 11.1-11.4
   */
  private generateInvoiceHTML(invoice: RenewalInvoice): string {
    const propertyName = invoice.property?.name || 'Property';
    const propertyAddress = invoice.property?.location || 'Lagos, Nigeria';
    const tenantName = invoice.tenant?.user
      ? `${invoice.tenant.user.first_name} ${invoice.tenant.user.last_name}`
      : 'Tenant';

    const startDate = this.formatDate(invoice.start_date);
    const endDate = this.formatDate(invoice.end_date);

    // Billing v2 — render the jsonb snapshot verbatim. Falls back to the
    // legacy scalar columns for invoices created before fee_breakdown existed.
    const fees: Fee[] = renewalInvoiceToFees(invoice);
    const feeRowsHtml = fees
      .map(
        (f) => `<div class="charge-row">
            <span class="charge-label">${this.escapeHtml(f.label)}</span>
            <span class="charge-amount">${this.formatCurrency(f.amount)}</span>
          </div>`,
      )
      .join('');
    const walletBalance = Number(invoice.wallet_balance);
    const totalAmountNum = Number(invoice.total_amount);
    const totalAmount = this.formatCurrency(totalAmountNum);
    // A negative wallet bundles this period's own charge with real prior debt.
    // The backend folds only the prior debt into total_amount, so the true
    // previous balance is total − this period's own charges. Deriving it this
    // way stops the current rent from being re-shown as a "Previous Outstanding
    // Balance" row (mirrors renewal-invoice/[token]/page.tsx).
    const netPreviousOutstanding = Math.max(
      0,
      Math.round((totalAmountNum - sumAll(fees)) * 100) / 100,
    );

    const isPaid = invoice.payment_status === 'paid';
    const paidDateFormatted =
      isPaid && invoice.paid_at ? this.formatDate(invoice.paid_at) : null;

    // Get landlord logo URL
    const landlordUser = resolveBrandingUser((invoice.property as any)?.owner);
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
    .page-wrapper {
      background: #f9fafb;
    }
    .invoice-wrapper {
      display: flex;
      justify-content: center;
      padding: 0 16px 48px;
    }
    .invoice-card {
      background: #fff;
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      max-width: 850px;
      width: 100%;
      padding: 48px;
      position: relative;
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
    /* Paid stamp overlay */
    .paid-stamp-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 10;
    }
    .paid-stamp-container {
      transform: rotate(-15deg) translateX(-100px) translateY(-50px);
    }
    .paid-stamp {
      padding: 16px 32px;
      border: 4px solid rgba(34, 139, 34, 0.6);
      background: transparent;
      border-radius: 6px;
      opacity: 0.85;
      position: relative;
    }
    .paid-stamp-inner-border {
      position: absolute;
      top: 4px;
      left: 4px;
      right: 4px;
      bottom: 4px;
      border: 2px solid rgba(34, 139, 34, 0.4);
      border-radius: 3px;
      pointer-events: none;
    }
    .paid-stamp-text {
      font-size: 36px;
      font-weight: 800;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: rgba(34, 139, 34, 0.6);
      font-family: Impact, "Arial Black", "Franklin Gothic Bold", sans-serif;
      text-shadow: 2px 2px 0px rgba(34, 139, 34, 0.25);
      -webkit-text-stroke: 1px rgba(34, 139, 34, 0.3);
      text-align: center;
    }
    .paid-stamp-date {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: rgba(34, 139, 34, 0.6);
      font-family: Impact, "Arial Black", "Franklin Gothic Bold", sans-serif;
      text-shadow: 1px 1px 0px rgba(34, 139, 34, 0.25);
      text-align: center;
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <div class="page-wrapper">
    <div class="invoice-wrapper">
      <div class="invoice-card">

        ${
          isPaid
            ? `<!-- Paid stamp overlay -->
        <div class="paid-stamp-overlay">
          <div class="paid-stamp-container">
            <div class="paid-stamp">
              <div class="paid-stamp-inner-border"></div>
              <div class="paid-stamp-text">PAID</div>
              ${paidDateFormatted ? `<div class="paid-stamp-date">${paidDateFormatted}</div>` : ''}
            </div>
          </div>
        </div>`
            : ''
        }

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

        <!-- Property and Tenant Information -->
        <div class="info-section">
          <div class="info-group">
            <p class="info-label">Property Name</p>
            <p class="info-value-bold">${this.escapeHtml(propertyName)}</p>
            <p class="info-value">${this.escapeHtml(propertyAddress)}</p>
          </div>

          ${
            landlordUser?.branding?.businessName
              ? `<div class="info-group">
            <p class="info-label">Landlord Name</p>
            <p class="info-value-bold">${this.escapeHtml(landlordUser.branding.businessName)}</p>
          </div>`
              : ''
          }

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

          ${feeRowsHtml}

          ${
            walletBalance > 0
              ? `<div class="charge-row">
            <span class="charge-label" style="color:#059669;">Rent Advance Applied</span>
            <span class="charge-amount" style="color:#059669;">-${this.formatCurrency(walletBalance)}</span>
          </div>`
              : ''
          }

          ${
            walletBalance < 0 && netPreviousOutstanding > 0
              ? `<div class="charge-row">
            <span class="charge-label">Previous Outstanding Balance</span>
            <span class="charge-amount">+${this.formatCurrency(netPreviousOutstanding)}</span>
          </div>`
              : ''
          }

          <!-- Total -->
          <div class="total-row">
            <span class="total-label">Total Amount Payable</span>
            <span class="total-amount">${totalAmount}</span>
          </div>
        </div>

        <!-- Gradient separator -->
        <div class="gradient-separator"></div>

      </div>
    </div>
  </div>
</body>
</html>
    `;
  }
  /**
   * Generate HTML for renewal receipt PDF using the unified template.
   */
  private generateReceiptHTML(invoice: RenewalInvoice): string {
    const propertyName = invoice.property?.name || 'Property';
    const tenantUser = invoice.tenant?.user as any;
    const tenantName = tenantUser
      ? `${tenantUser.first_name ?? ''} ${tenantUser.last_name ?? ''}`.trim()
      : 'Tenant';
    const tenantPhone: string | null = tenantUser?.phone_number ?? null;

    const fees: Fee[] = renewalInvoiceToFees(invoice);
    const rows: Array<{ label: string; amount: number }> = fees
      .filter((f) => Number(f.amount) > 0)
      .map((f) => ({ label: f.label, amount: Number(f.amount) }));

    const totalAmountNum = Number(invoice.total_amount) || 0;
    const walletBalance = Number(invoice.wallet_balance) || 0;
    // For a negative wallet, show only the prior debt folded into the total
    // (total − this period's own charges), never the raw wallet which also
    // includes this period's own charge already listed in the fee rows above.
    const netPreviousOutstanding = Math.max(
      0,
      Math.round((totalAmountNum - sumAll(fees)) * 100) / 100,
    );
    if (walletBalance > 0) {
      rows.push({ label: 'Wallet credit applied', amount: -walletBalance });
    } else if (walletBalance < 0 && netPreviousOutstanding > 0) {
      rows.push({
        label: 'Outstanding balance offset',
        amount: netPreviousOutstanding,
      });
    }

    const amountPaidNum = Number(invoice.amount_paid ?? totalAmountNum) || 0;
    const remaining = Math.max(totalAmountNum - amountPaidNum, 0);

    const landlordUser = resolveBrandingUser((invoice.property as any)?.owner);
    const branding = landlordUser?.branding ?? {};
    const landlordLogoUrl =
      landlordUser?.logo_urls?.[0] ?? branding?.letterhead ?? null;

    return renderUnifiedReceiptHTML({
      receiptNumber: invoice.receipt_number || 'N/A',
      tenantName,
      tenantPhone,
      propertyName,
      paymentDate: invoice.paid_at ?? null,
      paymentMethod: invoice.payment_method ?? null,
      landlord: {
        logoUrl: landlordLogoUrl,
        businessName: branding?.businessName ?? null,
        phone: branding?.contactPhone ?? null,
        email: branding?.contactEmail ?? null,
        address: branding?.businessAddress ?? null,
      },
      descriptionRows: rows,
      amountPaid: amountPaidNum,
      remainingBalance: remaining,
    });
  }
}

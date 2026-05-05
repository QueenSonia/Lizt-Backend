import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Browser } from 'puppeteer';

import { launchBrowser } from '../common/puppeteer-launch';
import { PropertyHistory } from './entities/property-history.entity';
import { KYCApplication } from '../kyc-links/entities/kyc-application.entity';

export interface PaymentReceiptView {
  receiptNumber: string;
  receiptDate: string | null;
  paymentAmount: number;
  paymentMethod: string;
  paymentReference: string | null;
  property: {
    id: string;
    name: string;
    address: string;
  };
  tenant: {
    name: string;
  };
  landlordBranding: {
    businessName: string;
    businessAddress: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    logoUrl: string | null;
  };
}

/**
 * Lightweight receipt PDF generator for `user_added_payment` history rows.
 * Mirrors AdHocInvoicePdfService — content is regenerated live from the
 * row at every download, so edits to amount/date propagate without any
 * snapshot or cache. The token persists unchanged across edits and across
 * the staged-applicant → tenant replay re-tag.
 */
@Injectable()
export class PaymentHistoryPdfService {
  private readonly logger = new Logger(PaymentHistoryPdfService.name);

  constructor(
    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepository: Repository<PropertyHistory>,
    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepository: Repository<KYCApplication>,
  ) {}

  async getPaymentReceiptView(
    receiptToken: string,
  ): Promise<PaymentReceiptView> {
    const row = await this.loadRow(receiptToken);
    return this.buildView(row);
  }

  async generatePaymentReceiptPDF(receiptToken: string): Promise<Buffer> {
    const row = await this.loadRow(receiptToken);
    const view = await this.buildView(row);
    return this.htmlToPDF(this.generateReceiptHTML(view));
  }

  generateReceiptFilename(
    propertyName: string,
    date: Date = new Date(),
  ): string {
    const slug = (propertyName || 'property')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const dateStr = date.toISOString().split('T')[0];
    return `payment-receipt-${slug}-${dateStr}.pdf`;
  }

  private async loadRow(receiptToken: string): Promise<PropertyHistory> {
    const row = await this.propertyHistoryRepository.findOne({
      where: {
        receipt_token: receiptToken,
        event_type: 'user_added_payment',
      },
      relations: [
        'property',
        'property.owner',
        'property.owner.user',
        'tenant',
        'tenant.user',
      ],
    });
    if (!row) {
      throw new NotFoundException('Receipt not found');
    }
    return row;
  }

  private async buildView(
    row: PropertyHistory,
  ): Promise<PaymentReceiptView> {
    const parsed = this.parseDescription(row.event_description);
    const paymentAmount = Number(parsed.paymentAmount) || 0;
    const paymentDate = row.move_in_date ?? row.created_at ?? null;

    const property = row.property as any;
    const propertyName = property?.name || 'Property';
    const propertyAddress = property?.location || '';

    const tenantName = await this.resolveTenantName(row, parsed);
    const branding = this.resolveLandlordBranding(row);

    return {
      receiptNumber: row.receipt_number || 'N/A',
      receiptDate: paymentDate
        ? new Date(paymentDate).toISOString()
        : null,
      paymentAmount,
      paymentMethod: 'Manual',
      paymentReference: parsed.paymentReference || null,
      property: {
        id: row.property_id,
        name: propertyName,
        address: propertyAddress,
      },
      tenant: { name: tenantName },
      landlordBranding: branding,
    };
  }

  private parseDescription(desc: string | null | undefined): any {
    if (!desc) return {};
    try {
      return JSON.parse(desc);
    } catch {
      return {};
    }
  }

  private async resolveTenantName(
    row: PropertyHistory,
    parsed: any,
  ): Promise<string> {
    // Tenant-mode: pull from the linked Account → Users.
    const tenantUser = (row.tenant as any)?.user;
    if (tenantUser) {
      return (
        `${tenantUser.first_name ?? ''} ${tenantUser.last_name ?? ''}`.trim() ||
        parsed.tenantName ||
        'Tenant'
      );
    }
    // Staged-applicant mode: tenant_id is NULL pre-attach. Pull from the
    // event_description JSON (modal already stamps `tenantName` there)
    // or fall back to the linked KYCApplication.
    if (parsed.tenantName) return String(parsed.tenantName);
    if (row.related_entity_type === 'kyc_application' && row.related_entity_id) {
      const app = await this.kycApplicationRepository.findOne({
        where: { id: row.related_entity_id },
      });
      if (app) {
        return `${app.first_name ?? ''} ${app.last_name ?? ''}`.trim() ||
          'Applicant';
      }
    }
    return 'Tenant';
  }

  private resolveLandlordBranding(
    row: PropertyHistory,
  ): PaymentReceiptView['landlordBranding'] {
    const property = row.property as any;
    const account = property?.owner;
    const landlordUser = account?.user;
    const branding = landlordUser?.branding || null;
    const logoUrl =
      landlordUser?.logo_urls?.[0] || branding?.letterhead || null;
    const fallbackName = landlordUser
      ? `${landlordUser.first_name ?? ''} ${landlordUser.last_name ?? ''}`.trim()
      : '';
    const businessName =
      branding?.businessName ||
      account?.profile_name ||
      fallbackName ||
      'Landlord';
    return {
      businessName,
      businessAddress: branding?.businessAddress || null,
      contactPhone: branding?.contactPhone || null,
      contactEmail: branding?.contactEmail || null,
      logoUrl,
    };
  }

  private async htmlToPDF(html: string): Promise<Buffer> {
    let browser: Browser | null = null;
    try {
      browser = await launchBrowser();
      const page = await browser.newPage();
      await page.setContent(html, {
        waitUntil: 'networkidle0',
        timeout: 15000,
      });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '15mm',
          bottom: '20mm',
          left: '15mm',
        },
      });
      return Buffer.from(pdf);
    } catch (err) {
      this.logger.error(
        `Failed to generate payment-history receipt PDF: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    } finally {
      if (browser) await browser.close();
    }
  }

  private formatCurrency(amount: number): string {
    if (amount === null || amount === undefined || isNaN(Number(amount))) {
      return '₦0';
    }
    const parts = Number(amount).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `₦${parts.join('.')}`;
  }

  private formatDate(date: string | null): string {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  private escapeHtml(text: string | null | undefined): string {
    if (!text) return '';
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return String(text).replace(/[&<>"']/g, (c) => map[c]);
  }

  private generateReceiptHTML(view: PaymentReceiptView): string {
    const b = view.landlordBranding;
    const totalAmount = this.formatCurrency(view.paymentAmount);
    const paymentDate = this.formatDate(view.receiptDate);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Payment Receipt — ${this.escapeHtml(view.receiptNumber)}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter', system-ui, sans-serif; background:#f9fafb; color:#1a1b23; }
    .wrapper { display:flex; justify-content:center; padding:20px; }
    .card { background:#fff; max-width:850px; width:100%; padding:48px; position:relative; box-shadow:0 1px 2px rgba(0,0,0,0.05); }
    .branding-header { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:32px; }
    .branding-left p { font-size:10px; color:#4b5563; line-height:14px; }
    .branding-left .biz-name { font-size:12px; font-weight:700; color:#1a1b23; margin-bottom:4px; }
    .branding-right img { height:50px; width:auto; object-fit:contain; }
    .title { font-size:24px; font-weight:700; color:#1a1b23; margin-bottom:32px; text-align:center; }
    .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:32px; }
    .info-group { margin-bottom:16px; }
    .info-label { font-size:12px; color:#6b7280; margin-bottom:4px; font-weight:500; }
    .info-value { font-size:14px; color:#1a1b23; font-weight:600; }
    .separator { height:1px; background:linear-gradient(to right, transparent, #d1d5db, transparent); margin:32px 0; }
    .section-title { font-size:16px; font-weight:700; color:#1a1b23; margin-bottom:24px; text-align:center; }
    .row { display:flex; justify-content:space-between; padding:12px 0; border-bottom:1px solid #e5e7eb; }
    .row .l { font-size:14px; color:#1a1b23; }
    .row .r { font-size:14px; color:#1a1b23; font-weight:600; }
    .total-row { display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding:16px; background:#f9fafb; border-top:2px solid #111827; border-radius:8px; }
    .total-label { font-size:16px; font-weight:700; color:#1a1b23; }
    .total-amount { font-size:20px; font-weight:700; color:#1a1b23; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      ${
        b.businessName || b.logoUrl
          ? `<div class="branding-header">
              <div class="branding-left">
                ${b.businessName ? `<p class="biz-name">${this.escapeHtml(b.businessName)}</p>` : ''}
                ${b.businessAddress ? `<p>${this.escapeHtml(b.businessAddress)}</p>` : ''}
                ${b.contactPhone ? `<p>${this.escapeHtml(b.contactPhone)}</p>` : ''}
                ${b.contactEmail ? `<p>${this.escapeHtml(b.contactEmail)}</p>` : ''}
              </div>
              ${b.logoUrl ? `<div class="branding-right"><img src="${this.escapeHtml(b.logoUrl)}" alt="${this.escapeHtml(b.businessName)}" /></div>` : ''}
            </div>`
          : ''
      }

      <h1 class="title">Payment Receipt</h1>

      <div class="info-grid">
        <div>
          <div class="info-group">
            <p class="info-label">Receipt Number</p>
            <p class="info-value">${this.escapeHtml(view.receiptNumber)}</p>
          </div>
          <div class="info-group">
            <p class="info-label">Payment Date</p>
            <p class="info-value">${paymentDate}</p>
          </div>
          ${
            view.paymentReference
              ? `<div class="info-group">
                  <p class="info-label">Reference</p>
                  <p class="info-value">${this.escapeHtml(view.paymentReference)}</p>
                </div>`
              : ''
          }
          <div class="info-group">
            <p class="info-label">Method</p>
            <p class="info-value">${this.escapeHtml(view.paymentMethod)}</p>
          </div>
        </div>
        <div>
          <div class="info-group">
            <p class="info-label">Property</p>
            <p class="info-value">${this.escapeHtml(view.property.name)}</p>
          </div>
          <div class="info-group">
            <p class="info-label">Property Address</p>
            <p class="info-value">${this.escapeHtml(view.property.address)}</p>
          </div>
          <div class="info-group">
            <p class="info-label">Received From</p>
            <p class="info-value">${this.escapeHtml(view.tenant.name)}</p>
          </div>
        </div>
      </div>

      <div class="separator"></div>

      <h2 class="section-title">Payment Summary</h2>
      <div class="row">
        <span class="l">Payment received</span>
        <span class="r">${totalAmount}</span>
      </div>
      <div class="total-row">
        <span class="total-label">Total Amount Paid</span>
        <span class="total-amount">${totalAmount}</span>
      </div>
    </div>
  </div>
</body>
</html>`;
  }
}

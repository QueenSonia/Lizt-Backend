import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as puppeteer from 'puppeteer';

import {
  AdHocInvoice,
  AdHocInvoiceStatus,
} from './entities/ad-hoc-invoice.entity';

@Injectable()
export class AdHocInvoicePdfService {
  private readonly logger = new Logger(AdHocInvoicePdfService.name);

  constructor(
    @InjectRepository(AdHocInvoice)
    private readonly invoiceRepository: Repository<AdHocInvoice>,
  ) {}

  async generateInvoicePDF(publicToken: string): Promise<Buffer> {
    const invoice = await this.invoiceRepository.findOne({
      where: { public_token: publicToken },
      relations: [
        'line_items',
        'property',
        'property.owner',
        'property.owner.user',
        'tenant',
        'tenant.user',
      ],
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return this.htmlToPDF(this.generateInvoiceHTML(invoice));
  }

  async generateReceiptPDF(receiptToken: string): Promise<Buffer> {
    const invoice = await this.invoiceRepository.findOne({
      where: { receipt_token: receiptToken },
      relations: [
        'line_items',
        'property',
        'property.owner',
        'property.owner.user',
        'tenant',
        'tenant.user',
      ],
    });
    if (!invoice) {
      throw new NotFoundException('Receipt not found');
    }
    if (invoice.status !== AdHocInvoiceStatus.PAID) {
      throw new NotFoundException('Receipt not available — payment required');
    }

    return this.htmlToPDF(this.generateReceiptHTML(invoice));
  }

  generateFilename(propertyName: string, date: Date = new Date()): string {
    const slug = (propertyName || 'property')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const dateStr = date.toISOString().split('T')[0];
    return `invoice-${slug}-${dateStr}.pdf`;
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
    return `invoice-receipt-${slug}-${dateStr}.pdf`;
  }

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
        `Failed to generate ad-hoc invoice PDF: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    } finally {
      if (browser) await browser.close();
    }
  }

  private formatCurrency(amount: number | null | undefined): string {
    if (amount === null || amount === undefined || isNaN(Number(amount))) {
      return '₦0';
    }
    const parts = Number(amount).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `₦${parts.join('.')}`;
  }

  private formatDate(date: Date | string | null | undefined): string {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
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

  private landlordInfo(invoice: AdHocInvoice): {
    logoUrl: string | null;
    name: string;
    branding: any | null;
  } {
    const landlordUser = (invoice.property as any)?.owner?.user;
    const branding = landlordUser?.branding || null;
    const logoUrl =
      landlordUser?.logo_urls?.[0] || branding?.letterhead || null;
    const name =
      branding?.businessName ||
      (landlordUser
        ? `${landlordUser.first_name ?? ''} ${landlordUser.last_name ?? ''}`.trim()
        : 'Landlord');
    return { logoUrl, name, branding };
  }

  private tenantName(invoice: AdHocInvoice): string {
    const u = invoice.tenant?.user;
    if (!u) return 'Tenant';
    return `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || 'Tenant';
  }

  private generateInvoiceHTML(invoice: AdHocInvoice): string {
    const property = invoice.property;
    const propertyName = property?.name || 'Property';
    const propertyAddress = property?.location || '';
    const tenantName = this.tenantName(invoice);
    const { logoUrl, name: landlordName, branding } =
      this.landlordInfo(invoice);

    const isPaid = invoice.status === AdHocInvoiceStatus.PAID;
    const paidDate =
      isPaid && invoice.paid_at ? this.formatDate(invoice.paid_at) : null;

    const totalAmount = Number(invoice.total_amount);
    const lineItems = (invoice.line_items ?? [])
      .slice()
      .sort((a, b) => a.sequence - b.sequence);

    const lineItemRowsHtml = lineItems
      .map(
        (item) => `<tr>
          <td>${item.sequence}</td>
          <td>${this.escapeHtml(item.description)}</td>
          <td>${this.formatCurrency(Number(item.amount))}</td>
        </tr>`,
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Invoice ${this.escapeHtml(invoice.invoice_number)} — ${this.escapeHtml(propertyName)}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Inter', -apple-system, system-ui, sans-serif; background:#f9fafb; color:#1a1b23; }
    .wrapper { display:flex; justify-content:center; padding:0 16px 48px; }
    .card { background:#fff; max-width:850px; width:100%; padding:48px; position:relative; box-shadow:0 1px 2px rgba(0,0,0,0.05); }
    .branding-header { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:32px; }
    .branding-left p { font-size:10px; line-height:14px; color:#4b5563; }
    .branding-left .biz-name { font-size:12px; font-weight:700; color:#1a1b23; margin-bottom:4px; }
    .branding-right img { height:50px; width:auto; object-fit:contain; }
    .title { font-size:16px; font-weight:700; color:#1a1b23; margin-bottom:4px; text-transform:uppercase; text-align:center; }
    .subtitle { font-size:12px; color:#6b7280; margin-bottom:32px; text-align:center; }
    .info-section { margin-bottom:32px; }
    .info-group { margin-bottom:16px; }
    .info-label { font-size:11px; color:#6b7280; margin-bottom:4px; }
    .info-value { font-size:11px; color:#1a1b23; }
    .info-value-bold { font-size:11px; font-weight:700; color:#1a1b23; }
    .separator { height:1px; background:linear-gradient(to right, transparent, #d1d5db, transparent); margin:32px 0; }
    .section-title { font-size:12px; font-weight:700; color:#1a1b23; margin-bottom:16px; text-transform:uppercase; }
    table.line-items { width:100%; border-collapse:collapse; font-size:11px; margin-bottom:24px; }
    table.line-items th { text-align:left; padding:10px; background:#f3f4f6; color:#6b7280; font-weight:600; border-bottom:1px solid #e5e7eb; }
    table.line-items td { padding:10px; border-bottom:1px solid #f3f4f6; }
    .total-row { display:flex; justify-content:space-between; align-items:center; padding-top:16px; margin-top:8px; border-top:2px solid #111827; }
    .total-label { font-size:14px; font-weight:700; color:#1a1b23; text-transform:uppercase; }
    .total-amount { font-size:18px; font-weight:700; color:#1a1b23; }
    .notes { padding:16px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; margin-top:16px; font-size:11px; color:#4b5563; }
    /* Paid stamp */
    .stamp-overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none; z-index:10; }
    .stamp-container { transform: rotate(-15deg) translateX(-100px) translateY(-50px); }
    .stamp { padding:16px 32px; border:4px solid rgba(34,139,34,0.6); border-radius:6px; opacity:0.85; position:relative; text-align:center; }
    .stamp-inner { position:absolute; inset:4px; border:2px solid rgba(34,139,34,0.4); border-radius:3px; pointer-events:none; }
    .stamp-text { font-size:36px; font-weight:800; letter-spacing:0.15em; text-transform:uppercase; color:rgba(34,139,34,0.6); font-family: Impact, "Arial Black", sans-serif; text-shadow:2px 2px 0 rgba(34,139,34,0.25); -webkit-text-stroke:1px rgba(34,139,34,0.3); }
    .stamp-date { font-size:14px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:rgba(34,139,34,0.6); font-family: Impact, "Arial Black", sans-serif; margin-top:4px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      ${
        isPaid
          ? `<div class="stamp-overlay"><div class="stamp-container"><div class="stamp"><div class="stamp-inner"></div><div class="stamp-text">PAID</div>${paidDate ? `<div class="stamp-date">${paidDate}</div>` : ''}</div></div></div>`
          : ''
      }

      ${
        branding || logoUrl
          ? `<div class="branding-header">
              <div class="branding-left">
                ${branding?.businessName ? `<p class="biz-name">${this.escapeHtml(branding.businessName)}</p>` : ''}
                ${branding?.businessAddress ? `<p>${this.escapeHtml(branding.businessAddress)}</p>` : ''}
                ${branding?.contactPhone ? `<p>${this.escapeHtml(branding.contactPhone)}</p>` : ''}
                ${branding?.contactEmail ? `<p>${this.escapeHtml(branding.contactEmail)}</p>` : ''}
              </div>
              ${logoUrl ? `<div class="branding-right"><img src="${this.escapeHtml(logoUrl)}" alt="${this.escapeHtml(landlordName)}" /></div>` : ''}
            </div>`
          : ''
      }

      <h1 class="title">Invoice</h1>
      <p class="subtitle">${this.escapeHtml(invoice.invoice_number)} · Due ${this.formatDate(invoice.due_date)}</p>

      <div class="info-section">
        <div class="info-group">
          <p class="info-label">Property</p>
          <p class="info-value-bold">${this.escapeHtml(propertyName)}</p>
          <p class="info-value">${this.escapeHtml(propertyAddress)}</p>
        </div>
        <div class="info-group">
          <p class="info-label">Billed To</p>
          <p class="info-value-bold">${this.escapeHtml(tenantName)}</p>
        </div>
      </div>

      <div class="separator"></div>

      <h2 class="section-title">Line Items</h2>
      <table class="line-items">
        <thead>
          <tr>
            <th style="width:40px;">#</th>
            <th>Description</th>
            <th style="width:140px; text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>${lineItemRowsHtml}</tbody>
      </table>

      <div class="total-row">
        <span class="total-label">${isPaid ? 'Amount Paid' : 'Amount Due'}</span>
        <span class="total-amount">${this.formatCurrency(totalAmount)}</span>
      </div>

      ${
        invoice.notes
          ? `<div class="notes"><strong>Notes:</strong> ${this.escapeHtml(invoice.notes)}</div>`
          : ''
      }
    </div>
  </div>
</body>
</html>`;
  }

  private generateReceiptHTML(invoice: AdHocInvoice): string {
    const property = invoice.property;
    const propertyName = property?.name || 'Property';
    const propertyAddress = property?.location || '';
    const tenantName = this.tenantName(invoice);
    const { logoUrl, name: landlordName, branding } =
      this.landlordInfo(invoice);

    const paymentDate = this.formatDate(invoice.paid_at);
    const paymentReference = invoice.payment_reference || 'N/A';
    const receiptNumber = invoice.receipt_number || 'N/A';
    const totalAmount = this.formatCurrency(Number(invoice.total_amount));
    const lineItems = (invoice.line_items ?? [])
      .slice()
      .sort((a, b) => a.sequence - b.sequence);

    const lineItemRowsHtml = lineItems
      .map(
        (item) => `<div class="row">
          <span class="l">${this.escapeHtml(item.description)}</span>
          <span class="r">${this.formatCurrency(Number(item.amount))}</span>
        </div>`,
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Payment Receipt — ${this.escapeHtml(invoice.invoice_number)}</title>
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
        branding || logoUrl
          ? `<div class="branding-header">
              <div class="branding-left">
                ${branding?.businessName ? `<p class="biz-name">${this.escapeHtml(branding.businessName)}</p>` : ''}
                ${branding?.businessAddress ? `<p>${this.escapeHtml(branding.businessAddress)}</p>` : ''}
                ${branding?.contactPhone ? `<p>${this.escapeHtml(branding.contactPhone)}</p>` : ''}
                ${branding?.contactEmail ? `<p>${this.escapeHtml(branding.contactEmail)}</p>` : ''}
              </div>
              ${logoUrl ? `<div class="branding-right"><img src="${this.escapeHtml(logoUrl)}" alt="${this.escapeHtml(landlordName)}" /></div>` : ''}
            </div>`
          : ''
      }

      <h1 class="title">Payment Receipt</h1>

      <div class="info-grid">
        <div>
          <div class="info-group">
            <p class="info-label">Receipt Number</p>
            <p class="info-value">${this.escapeHtml(receiptNumber)}</p>
          </div>
          <div class="info-group">
            <p class="info-label">Invoice Number</p>
            <p class="info-value">${this.escapeHtml(invoice.invoice_number)}</p>
          </div>
          <div class="info-group">
            <p class="info-label">Transaction Reference</p>
            <p class="info-value">${this.escapeHtml(paymentReference)}</p>
          </div>
          <div class="info-group">
            <p class="info-label">Payment Date</p>
            <p class="info-value">${paymentDate}</p>
          </div>
        </div>
        <div>
          <div class="info-group">
            <p class="info-label">Property</p>
            <p class="info-value">${this.escapeHtml(propertyName)}</p>
          </div>
          <div class="info-group">
            <p class="info-label">Property Address</p>
            <p class="info-value">${this.escapeHtml(propertyAddress)}</p>
          </div>
          <div class="info-group">
            <p class="info-label">Tenant</p>
            <p class="info-value">${this.escapeHtml(tenantName)}</p>
          </div>
          <div class="info-group">
            <p class="info-label">Method</p>
            <p class="info-value">Paystack</p>
          </div>
        </div>
      </div>

      <div class="separator"></div>

      <h2 class="section-title">Payment Breakdown</h2>

      ${lineItemRowsHtml}

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

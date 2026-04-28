import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Browser } from 'puppeteer';

import { launchBrowser } from '../common/puppeteer-launch';
import { Invoice } from './entities/invoice.entity';

@Injectable()
export class InvoicePDFService {
  private readonly logger = new Logger(InvoicePDFService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
  ) {}

  /**
   * Generate PDF for an invoice by ID, scoped to landlord
   */
  async generateInvoicePDF(
    invoiceId: string,
    landlordId: string,
  ): Promise<Buffer> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId, landlord_id: landlordId },
      relations: ['property', 'kyc_application', 'tenant', 'line_items'],
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const html = this.generateInvoiceHTML(invoice);
    return this.htmlToPDF(html);
  }

  private async htmlToPDF(html: string): Promise<Buffer> {
    let browser: Browser | null = null;

    try {
      browser = await launchBrowser();

      const page = await browser.newPage();
      await page.setContent(html, {
        waitUntil: 'domcontentloaded',
        timeout: 10000,
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
      });

      return Buffer.from(pdfBuffer);
    } catch (error) {
      this.logger.error(
        `Failed to generate invoice PDF: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  private formatCurrency(amount: number | null | undefined): string {
    if (!amount && amount !== 0) return '₦0';
    return `₦${Number(amount).toLocaleString()}`;
  }

  private getStatusStyle(status: string): {
    bg: string;
    color: string;
    border: string;
  } {
    switch (status) {
      case 'paid':
        return { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' };
      case 'partially_paid':
        return { bg: '#fef9c3', color: '#a16207', border: '#fde68a' };
      case 'pending':
      case 'overdue':
        return { bg: '#fee2e2', color: '#b91c1c', border: '#fecaca' };
      case 'cancelled':
        return { bg: '#f3f4f6', color: '#374151', border: '#e5e7eb' };
      default:
        return { bg: '#f3f4f6', color: '#374151', border: '#e5e7eb' };
    }
  }

  private formatStatusLabel(status: string): string {
    return status
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  private generateInvoiceHTML(invoice: Invoice): string {
    const tenantName = invoice.kyc_application
      ? `${invoice.kyc_application.first_name} ${invoice.kyc_application.last_name}`
      : invoice.tenant
        ? `${invoice.tenant.first_name} ${invoice.tenant.last_name}`
        : 'Unknown';
    const tenantEmail =
      invoice.kyc_application?.email || invoice.tenant?.email || '';
    const tenantPhone =
      invoice.kyc_application?.phone_number ||
      invoice.tenant?.phone_number ||
      '';

    const totalAmount = Number(invoice.total_amount);
    const amountPaid = Number(invoice.amount_paid);
    const amountDue = Number(invoice.outstanding_balance);
    const statusStyle = this.getStatusStyle(invoice.status);
    const statusLabel = this.formatStatusLabel(invoice.status);

    const invoiceDate = new Date(invoice.invoice_date).toLocaleDateString(
      'en-GB',
      { day: '2-digit', month: '2-digit', year: 'numeric' },
    );

    const lineItemsHtml = (invoice.line_items || [])
      .map(
        (item) => `
        <tr>
          <td style="padding:10px 16px;font-size:14px;color:#111827;border-bottom:1px solid #e5e7eb;">
            ${this.escapeHtml(item.description)}
          </td>
          <td style="padding:10px 16px;font-size:14px;color:#111827;font-weight:500;text-align:right;border-bottom:1px solid #e5e7eb;">
            ${this.formatCurrency(Number(item.amount))}
          </td>
        </tr>`,
      )
      .join('');

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:#111827; }
  .container { max-width:700px; margin:0 auto; padding:40px 32px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:1px solid #e5e7eb; padding-bottom:24px; margin-bottom:24px; }
  .badge { display:inline-block; padding:4px 12px; border-radius:9999px; font-size:12px; font-weight:600; border:1px solid; }
  .section { background:#f9fafb; border-radius:8px; padding:16px; margin-bottom:16px; }
  .section-title { font-size:11px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:12px; }
  table { width:100%; border-collapse:collapse; }
  .table-wrap { border:1px solid #e5e7eb; border-radius:8px; overflow:hidden; margin-bottom:16px; }
  thead th { background:#f9fafb; padding:10px 16px; font-size:11px; font-weight:600; color:#374151; text-transform:uppercase; }
  .totals-row { display:flex; justify-content:space-between; align-items:center; padding:4px 0; }
  .totals-row span { font-size:14px; }
  .divider { border-top:1px solid #e5e7eb; margin:12px 0; padding-top:12px; }
</style></head>
<body>
<div class="container">
  <!-- Header -->
  <div class="header">
    <div>
      <h1 style="font-size:28px;font-weight:700;color:#111827;margin-bottom:4px;">INVOICE</h1>
      <p style="font-size:14px;color:#6b7280;">${this.escapeHtml(invoice.invoice_number)}</p>
    </div>
    <span class="badge" style="background:${statusStyle.bg};color:${statusStyle.color};border-color:${statusStyle.border};">
      ${statusLabel}
    </span>
  </div>

  <!-- Date -->
  <div style="margin-bottom:16px;">
    <p style="font-size:11px;font-weight:500;color:#6b7280;margin-bottom:4px;">Invoice Date</p>
    <p style="font-size:14px;color:#111827;">${invoiceDate}</p>
  </div>

  <!-- Bill To -->
  <div class="section">
    <p class="section-title">Bill To</p>
    <p style="font-weight:500;color:#111827;">${this.escapeHtml(tenantName)}</p>
    ${tenantEmail ? `<p style="font-size:14px;color:#6b7280;">${this.escapeHtml(tenantEmail)}</p>` : ''}
    ${tenantPhone ? `<p style="font-size:14px;color:#6b7280;">${this.escapeHtml(tenantPhone)}</p>` : ''}
  </div>

  <!-- Property -->
  <div class="section">
    <p class="section-title">Property</p>
    <p style="font-weight:500;color:#111827;">${this.escapeHtml(invoice.property?.name || '')}</p>
    ${invoice.property?.location ? `<p style="font-size:14px;color:#6b7280;">${this.escapeHtml(invoice.property.location)}</p>` : ''}
  </div>

  <!-- Line Items -->
  <div style="margin-bottom:16px;">
    <p class="section-title" style="margin-bottom:12px;">Items</p>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th style="text-align:left;">Description</th>
          <th style="text-align:right;">Amount</th>
        </tr></thead>
        <tbody>${lineItemsHtml}</tbody>
      </table>
    </div>
  </div>

  <!-- Totals -->
  <div class="section">
    <div class="totals-row">
      <span style="color:#6b7280;">Subtotal</span>
      <span style="font-weight:500;">${this.formatCurrency(totalAmount)}</span>
    </div>
    <div class="totals-row">
      <span style="color:#6b7280;">Total</span>
      <span style="font-weight:600;">${this.formatCurrency(totalAmount)}</span>
    </div>
    <div class="totals-row">
      <span style="color:#6b7280;">Amount Paid</span>
      <span style="font-weight:500;color:#16a34a;">${this.formatCurrency(amountPaid)}</span>
    </div>
    <div class="divider">
      <div class="totals-row">
        <span style="font-size:16px;font-weight:600;">Amount Due</span>
        <span style="font-size:18px;font-weight:700;color:#dc2626;">${this.formatCurrency(amountDue)}</span>
      </div>
    </div>
  </div>

  ${
    invoice.notes
      ? `<div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:16px;">
           <p style="font-size:14px;font-weight:500;color:#374151;margin-bottom:4px;">Notes:</p>
           <p style="font-size:14px;color:#6b7280;">${this.escapeHtml(invoice.notes)}</p>
         </div>`
      : ''
  }
</div>
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

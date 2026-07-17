import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Browser } from 'puppeteer';

import { launchBrowser } from '../common/puppeteer-launch';
import { renderUnifiedReceiptHTML } from '../common/html/unified-receipt-template';
import { resolveBrandingUser } from '../common/branding/branding.util';

import {
  PaymentPlanInstallment,
  InstallmentStatus,
  InstallmentPaymentMethod,
} from './entities/payment-plan-installment.entity';

@Injectable()
export class InstallmentPDFService {
  private readonly logger = new Logger(InstallmentPDFService.name);

  constructor(
    @InjectRepository(PaymentPlanInstallment)
    private readonly installmentRepository: Repository<PaymentPlanInstallment>,
  ) {}

  // ───────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────

  async generateInstallmentInvoicePDF(installmentId: string): Promise<Buffer> {
    const installment = await this.installmentRepository.findOne({
      where: { id: installmentId },
      relations: [
        'plan',
        'plan.property',
        'plan.property.owner',
        'plan.property.owner.user',
        'plan.property.owner.creator',
        'plan.property.owner.creator.user',
        'plan.tenant',
        'plan.tenant.user',
      ],
    });
    if (!installment) {
      throw new NotFoundException('Installment not found');
    }

    const siblings = await this.installmentRepository.find({
      where: { plan_id: installment.plan_id },
      order: { sequence: 'ASC' },
    });

    const html = this.generateInvoiceHTML(installment, siblings);
    return this.htmlToPDF(html);
  }

  async generateInstallmentReceiptPDF(receiptToken: string): Promise<Buffer> {
    const installment = await this.installmentRepository.findOne({
      where: { receipt_token: receiptToken },
      relations: [
        'plan',
        'plan.property',
        'plan.property.owner',
        'plan.property.owner.user',
        'plan.property.owner.creator',
        'plan.property.owner.creator.user',
        'plan.tenant',
        'plan.tenant.user',
      ],
    });
    if (!installment) {
      throw new NotFoundException('Receipt not found');
    }
    if (installment.status !== InstallmentStatus.PAID) {
      throw new NotFoundException('Receipt not available — payment required');
    }

    const html = this.generateReceiptHTML(installment);
    return this.htmlToPDF(html);
  }

  generateFilename(propertyName: string, date: Date = new Date()): string {
    const slug = (propertyName || 'property')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const dateStr = date.toISOString().split('T')[0];
    return `installment-invoice-${slug}-${dateStr}.pdf`;
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
    return `installment-receipt-${slug}-${dateStr}.pdf`;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Puppeteer helper
  // ───────────────────────────────────────────────────────────────────────

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
        `Failed to generate installment PDF: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    } finally {
      if (browser) await browser.close();
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Formatting helpers
  // ───────────────────────────────────────────────────────────────────────

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

  private methodLabel(method: InstallmentPaymentMethod | null): string {
    if (!method) return '—';
    switch (method) {
      // Legacy value — kept for historical channel-null rows that stored the
      // enum ('paystack') instead of a channel string.
      case InstallmentPaymentMethod.PAYSTACK:
        return 'Paystack';
      case InstallmentPaymentMethod.ONLINE:
        return 'Online';
      case InstallmentPaymentMethod.CASH:
        return 'Cash';
      case InstallmentPaymentMethod.TRANSFER:
        return 'Bank transfer';
      case InstallmentPaymentMethod.OTHER:
        return 'Other';
      default:
        return method;
    }
  }

  private scopeLabel(scope: string): string {
    return scope === 'tenancy' ? 'Tenancy' : 'Specific Charge';
  }

  private planLabel(plan: { scope: string; charge_name: string }): string {
    return plan.scope === 'tenancy'
      ? 'Tenancy'
      : `${plan.charge_name} — Specific Charge`;
  }

  // ───────────────────────────────────────────────────────────────────────
  // HTML templates
  // ───────────────────────────────────────────────────────────────────────

  private landlordInfo(installment: PaymentPlanInstallment): {
    logoUrl: string | null;
    name: string;
    branding: any | null;
  } {
    const landlordUser = resolveBrandingUser(
      (installment.plan.property as any)?.owner,
    );
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

  private tenantName(installment: PaymentPlanInstallment): string {
    const u = installment.plan.tenant?.user;
    if (!u) return 'Tenant';
    return `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || 'Tenant';
  }

  private tenantPhone(installment: PaymentPlanInstallment): string | null {
    const u = installment.plan.tenant?.user as
      | { phone_number?: string | null }
      | undefined;
    return u?.phone_number ?? null;
  }

  private generateInvoiceHTML(
    installment: PaymentPlanInstallment,
    siblings: PaymentPlanInstallment[],
  ): string {
    const plan = installment.plan;
    const property = plan.property;
    const propertyName = property?.name || 'Property';
    const propertyAddress = property?.location || '';
    const tenantName = this.tenantName(installment);
    const { logoUrl, name: landlordName, branding } =
      this.landlordInfo(installment);

    const isPaid = installment.status === InstallmentStatus.PAID;
    const paidDate = isPaid && installment.paid_at
      ? this.formatDate(installment.paid_at)
      : null;

    const paidInstallments = siblings.filter(
      (s) => s.status === InstallmentStatus.PAID,
    );
    const amountPaidToDate = paidInstallments.reduce(
      (sum, s) => sum + Number(s.amount_paid ?? s.amount),
      0,
    );
    const planTotal = Number(plan.total_amount);
    const amountRemaining = Math.max(0, planTotal - amountPaidToDate);

    const scheduleRowsHtml = siblings
      .map((s) => {
        const isThis = s.id === installment.id;
        const statusPill =
          s.status === InstallmentStatus.PAID
            ? '<span class="pill pill-paid">Paid</span>'
            : '<span class="pill pill-pending">Pending</span>';
        return `<tr class="${isThis ? 'row-this' : ''}">
            <td>${s.sequence}${isThis ? ' <span class="this-marker">(this)</span>' : ''}</td>
            <td>${this.formatDate(s.due_date)}</td>
            <td>${this.formatCurrency(Number(s.amount))}</td>
            <td>${statusPill}</td>
          </tr>`;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Installment Invoice — ${this.escapeHtml(propertyName)}</title>
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
    .summary-grid { display:grid; grid-template-columns: repeat(4, 1fr); gap:12px; margin-bottom:24px; }
    .summary-cell { padding:12px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; }
    .summary-cell .label { font-size:10px; color:#6b7280; margin-bottom:4px; }
    .summary-cell .value { font-size:13px; font-weight:700; color:#1a1b23; }
    table.schedule { width:100%; border-collapse:collapse; font-size:11px; margin-bottom:24px; }
    table.schedule th { text-align:left; padding:8px; background:#f3f4f6; color:#6b7280; font-weight:600; border-bottom:1px solid #e5e7eb; }
    table.schedule td { padding:8px; border-bottom:1px solid #f3f4f6; }
    table.schedule tr.row-this td { background:#fff7ed; font-weight:600; }
    .this-marker { color:#c2410c; font-size:9px; font-weight:700; }
    .pill { display:inline-block; padding:2px 8px; border-radius:12px; font-size:10px; font-weight:600; }
    .pill-paid { background:#d1fae5; color:#065f46; }
    .pill-pending { background:#fef3c7; color:#92400e; }
    .detail-block { padding:16px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; margin-bottom:24px; }
    .detail-row { display:flex; justify-content:space-between; padding:6px 0; font-size:11px; }
    .detail-row .label { color:#6b7280; }
    .detail-row .value { color:#1a1b23; font-weight:600; }
    .total-row { display:flex; justify-content:space-between; align-items:center; padding-top:16px; margin-top:8px; border-top:2px solid #111827; }
    .total-label { font-size:14px; font-weight:700; color:#1a1b23; text-transform:uppercase; }
    .total-amount { font-size:18px; font-weight:700; color:#1a1b23; }
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

      <h1 class="title">Payment Plan Installment</h1>
      <p class="subtitle">Installment ${installment.sequence} of ${siblings.length}</p>

      <div class="info-section">
        <div class="info-group">
          <p class="info-label">Property</p>
          <p class="info-value-bold">${this.escapeHtml(propertyName)}</p>
          <p class="info-value">${this.escapeHtml(propertyAddress)}</p>
        </div>
        <div class="info-group">
          <p class="info-label">Tenant</p>
          <p class="info-value-bold">${this.escapeHtml(tenantName)}</p>
        </div>
        <div class="info-group">
          <p class="info-label">Plan</p>
          <p class="info-value-bold">${this.escapeHtml(this.planLabel(plan))}</p>
        </div>
      </div>

      <div class="separator"></div>

      <h2 class="section-title">Plan Summary</h2>
      <div class="summary-grid">
        <div class="summary-cell">
          <div class="label">Plan Total</div>
          <div class="value">${this.formatCurrency(planTotal)}</div>
        </div>
        <div class="summary-cell">
          <div class="label">Paid to Date</div>
          <div class="value">${this.formatCurrency(amountPaidToDate)}</div>
        </div>
        <div class="summary-cell">
          <div class="label">Remaining</div>
          <div class="value">${this.formatCurrency(amountRemaining)}</div>
        </div>
        <div class="summary-cell">
          <div class="label">Installments</div>
          <div class="value">${paidInstallments.length} / ${siblings.length}</div>
        </div>
      </div>

      <h2 class="section-title">Installment Schedule</h2>
      <table class="schedule">
        <thead>
          <tr>
            <th>#</th>
            <th>Due Date</th>
            <th>Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${scheduleRowsHtml}</tbody>
      </table>

      <div class="separator"></div>

      <h2 class="section-title">This Installment</h2>
      <div class="detail-block">
        <div class="detail-row"><span class="label">Sequence</span><span class="value">${installment.sequence} of ${siblings.length}</span></div>
        <div class="detail-row"><span class="label">Due Date</span><span class="value">${this.formatDate(installment.due_date)}</span></div>
        <div class="detail-row"><span class="label">Status</span><span class="value">${isPaid ? 'Paid' : 'Pending'}</span></div>
        ${
          isPaid
            ? `
          <div class="detail-row"><span class="label">Paid On</span><span class="value">${paidDate ?? '—'}</span></div>
          <div class="detail-row"><span class="label">Method</span><span class="value">${this.methodLabel(installment.payment_method)}</span></div>
          ${installment.gateway_reference ? `<div class="detail-row"><span class="label">Payment Reference</span><span class="value">${this.escapeHtml(installment.gateway_reference)}</span></div>` : ''}
          ${installment.receipt_number ? `<div class="detail-row"><span class="label">Receipt Number</span><span class="value">${this.escapeHtml(installment.receipt_number)}</span></div>` : ''}
          ${installment.manual_payment_note ? `<div class="detail-row"><span class="label">Note</span><span class="value">${this.escapeHtml(installment.manual_payment_note)}</span></div>` : ''}
          `
            : ''
        }
      </div>

      <div class="total-row">
        <span class="total-label">${isPaid ? 'Amount Paid' : 'Amount Due'}</span>
        <span class="total-amount">${this.formatCurrency(Number(installment.amount_paid ?? installment.amount))}</span>
      </div>
    </div>
  </div>
</body>
</html>`;
  }


  private generateReceiptHTML(installment: PaymentPlanInstallment): string {
    const plan = installment.plan;
    const property = plan.property;
    const propertyName = property?.name || 'Property';
    const tenantName = this.tenantName(installment);
    const tenantPhone = this.tenantPhone(installment);
    const { logoUrl, branding } = this.landlordInfo(installment);

    const planLabel = this.planLabel(plan);
    const installmentLabel = `Installment ${installment.sequence} of ${plan.installments?.length ?? '?'} — ${planLabel}`;
    const amountPaid = Number(installment.amount_paid ?? installment.amount) || 0;

    const extras: Array<{ label: string; value: string }> = [
      { label: 'Plan', value: planLabel },
      {
        label: 'Progress',
        value: `${plan.installments?.filter((i) => i.status === InstallmentStatus.PAID).length ?? 0} of ${plan.installments?.length ?? '?'} paid`,
      },
      {
        label: 'Installment Due Date',
        value: this.formatDate(installment.due_date),
      },
    ];
    if (installment.manual_payment_note) {
      extras.push({ label: 'Note', value: installment.manual_payment_note });
    }

    return renderUnifiedReceiptHTML({
      receiptNumber: installment.receipt_number || 'N/A',
      tenantName,
      tenantPhone,
      propertyName,
      paymentDate: installment.paid_at ?? null,
      paymentMethod: installment.payment_method ?? null,
      landlord: {
        logoUrl,
        businessName: branding?.businessName ?? null,
        phone: branding?.contactPhone ?? null,
        email: branding?.contactEmail ?? null,
        address: branding?.businessAddress ?? null,
      },
      descriptionRows: [{ label: installmentLabel, amount: amountPaid }],
      amountPaid,
      extras,
    });
  }
}

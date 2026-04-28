import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Browser } from 'puppeteer';

import { launchBrowser } from '../common/puppeteer-launch';
import {
  RenewalInvoice,
  RenewalLetterStatus,
} from '../tenancies/entities/renewal-invoice.entity';
import { Property } from '../properties/entities/property.entity';
import { PropertyTenant } from '../properties/entities/property-tenants.entity';
import { Account } from '../users/entities/account.entity';
import { FileUploadService } from '../utils/cloudinary';

/**
 * Renewal-letter PDF generator.
 *
 * Mirrors the offer-letter pdf-generator.service flow: Puppeteer renders
 * an HTML document, the buffer is uploaded to Cloudinary, and the URL is
 * persisted on the renewal_invoice row for cache reuse.
 *
 * The HTML always renders the saved letter_body_html when present (so
 * landlord free-text edits are preserved verbatim) and falls back to a
 * minimal structural render when null (cron auto-created rows). An
 * accepted/declined stamp + audit block (OTP, phone, IP, date) is
 * appended below the letter prose so the generated PDF doubles as a
 * notarised audit artefact — same pattern offer letters use.
 */
@Injectable()
export class RenewalLetterPdfService {
  private readonly logger = new Logger(RenewalLetterPdfService.name);

  constructor(
    @InjectRepository(RenewalInvoice)
    private readonly renewalInvoiceRepository: Repository<RenewalInvoice>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
    private readonly fileUploadService: FileUploadService,
  ) {}

  /**
   * Generate a fresh PDF buffer for the given invoice id. Does not upload
   * or persist — caller decides whether to cache.
   */
  async generatePdfBuffer(invoiceId: string): Promise<Buffer> {
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { id: invoiceId },
    });
    if (!invoice) {
      throw new NotFoundException('Renewal invoice not found');
    }

    const propertyTenant = await this.propertyTenantRepository.findOne({
      where: { id: invoice.property_tenant_id },
      relations: [
        'property',
        'property.owner',
        'property.owner.user',
        'tenant',
        'tenant.user',
      ],
    });
    if (!propertyTenant) {
      throw new NotFoundException('Tenancy not found for letter');
    }

    const property =
      propertyTenant.property ??
      (await this.propertyRepository.findOne({
        where: { id: invoice.property_id },
      }));

    const html = this.buildHtml(invoice, propertyTenant, property);
    return this.htmlToPdf(html);
  }

  /**
   * Generate (or refresh) the cached PDF for an invoice and persist the
   * Cloudinary URL on the row. Returns the URL.
   *
   * Re-renders unconditionally — call sites are post-accept / post-decline,
   * where stamp + audit metadata change and the prior cache (if any)
   * doesn't reflect the new state.
   */
  async generateAndUpload(invoiceId: string): Promise<string> {
    const buffer = await this.generatePdfBuffer(invoiceId);
    const filename = `renewal-letter-${invoiceId.substring(0, 8)}-${Date.now()}`;
    const upload = await this.fileUploadService.uploadBuffer(buffer, filename);

    await this.renewalInvoiceRepository.update(invoiceId, {
      pdf_url: upload.secure_url,
      pdf_generated_at: new Date(),
    });

    return upload.secure_url;
  }

  /**
   * Cache-aware fetcher used by the download endpoints. Returns the
   * Cloudinary URL, regenerating only when the cached URL is missing,
   * older than 24h, or stale relative to the latest letter_status change
   * (e.g. landlord re-sent after the cache was created).
   */
  async getOrGenerateUrl(invoiceId: string): Promise<string> {
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { id: invoiceId },
      select: [
        'id',
        'pdf_url',
        'pdf_generated_at',
        'letter_sent_at',
        'accepted_at',
        'declined_at',
      ],
    });
    if (!invoice) {
      throw new NotFoundException('Renewal invoice not found');
    }

    if (invoice.pdf_url && invoice.pdf_generated_at) {
      const generatedAt = new Date(invoice.pdf_generated_at).getTime();
      const ageHours = (Date.now() - generatedAt) / 3_600_000;
      const latestEvent = Math.max(
        invoice.letter_sent_at
          ? new Date(invoice.letter_sent_at).getTime()
          : 0,
        invoice.accepted_at ? new Date(invoice.accepted_at).getTime() : 0,
        invoice.declined_at ? new Date(invoice.declined_at).getTime() : 0,
      );
      const cacheCoversLatestEvent = generatedAt >= latestEvent;
      if (ageHours < 24 && cacheCoversLatestEvent) {
        return invoice.pdf_url;
      }
    }

    return this.generateAndUpload(invoiceId);
  }

  // ── HTML rendering ────────────────────────────────────────────────────

  private buildHtml(
    invoice: RenewalInvoice,
    propertyTenant: PropertyTenant,
    property: Property | null,
  ): string {
    const tenantUser = propertyTenant.tenant?.user;
    const tenantName = tenantUser
      ? `${tenantUser.first_name ?? ''} ${tenantUser.last_name ?? ''}`.trim()
      : 'Tenant';
    const landlordAccount: Account | undefined =
      propertyTenant.property?.owner;
    const landlordUser = landlordAccount?.user;
    const branding = (landlordUser as any)?.branding ?? {};

    const letterBodyHtml = invoice.letter_body_html;
    const proseSection = letterBodyHtml
      ? `<div class="letter-body">${letterBodyHtml}</div>`
      : this.buildFallbackProse(
          invoice,
          propertyTenant,
          property,
          tenantName,
          branding,
        );

    const stampSection = this.buildStampSection(invoice, tenantName);
    const auditSection = this.buildAuditSection(invoice);

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Renewal Letter — ${this.escapeHtml(property?.name ?? 'Property')}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Times New Roman', Georgia, serif;
      color: #1a1b23;
      background: #fff;
      font-size: 14px;
      line-height: 1.7;
    }
    .page { padding: 24px 32px; }
    .letter-body { word-wrap: break-word; }
    .letter-body ul, .letter-body ol { padding-left: 28px; margin: 0 0 24px 0; }
    .letter-body li { margin-bottom: 10px; }
    .letter-body p { margin-bottom: 18px; }
    .letter-body span[data-field] { background: transparent; }
    .stamp-wrap {
      position: relative;
      margin: 48px 0 32px;
      min-height: 140px;
    }
    .stamp {
      transform: rotate(-18deg);
      display: inline-block;
      padding: 10px 24px;
      border: 6px solid var(--stamp-border);
      position: relative;
    }
    .stamp .inner {
      position: absolute;
      top: 4px; left: 4px; right: 4px; bottom: 4px;
      border: 1.5px solid var(--stamp-inner);
      pointer-events: none;
    }
    .stamp .text {
      font-family: Impact, 'Arial Black', 'Franklin Gothic Bold', sans-serif;
      font-size: 36px;
      font-weight: 900;
      letter-spacing: 0.25em;
      color: var(--stamp-text);
      -webkit-text-stroke: 0.8px var(--stamp-stroke);
    }
    .audit {
      border-top: 1px solid #e5e7eb;
      padding-top: 16px;
      margin-top: 24px;
      font-family: 'Inter', -apple-system, sans-serif;
      font-size: 12px;
      color: #374151;
    }
    .audit h3 {
      font-size: 13px;
      font-weight: 700;
      color: #1a1b23;
      margin-bottom: 12px;
    }
    .audit dl {
      display: grid;
      grid-template-columns: 180px 1fr;
      row-gap: 6px;
      column-gap: 16px;
    }
    .audit dt { color: #6b7280; }
    .audit dd { color: #1a1b23; font-weight: 600; }
    /* Strip the editable affordance from data-field spans when printing */
    [contenteditable] { -webkit-user-modify: read-only; }
  </style>
</head>
<body>
  <div class="page">
    ${proseSection}
    ${stampSection}
    ${auditSection}
  </div>
</body>
</html>`;
  }

  private buildFallbackProse(
    invoice: RenewalInvoice,
    propertyTenant: PropertyTenant,
    property: Property | null,
    tenantName: string,
    branding: Record<string, unknown>,
  ): string {
    // Minimal prose for cron auto-created rows that never had an authored
    // letter. The accept/decline flow can still happen on these (cron
    // bumps to letter_status='sent') so the PDF must still render.
    const propertyName = property?.name ?? 'the Property';
    const propertyAddress = property?.location ?? '';
    const start = this.formatLongDate(invoice.start_date);
    const end = this.formatLongDate(invoice.end_date);
    const businessName =
      ((branding as Record<string, string>).businessName as string) || '';

    return `
    <div class="letter-body">
      <p style="margin-bottom: 24px;">${this.escapeHtml(this.formatLongDate(new Date()))}</p>
      <p style="font-weight: 700; margin-bottom: 16px;">${this.escapeHtml(tenantName)}</p>
      <p style="margin-bottom: 24px;">Dear ${this.escapeHtml(this.firstName(tenantName))},</p>
      <p style="font-weight: 700; text-decoration: underline; text-transform: uppercase; margin-bottom: 24px;">
        Rent Renewal Offer for ${this.escapeHtml(propertyName.toUpperCase())}
      </p>
      <p style="margin-bottom: 24px;">
        We hereby offer to renew your tenancy at
        ${this.escapeHtml(propertyAddress || propertyName)}
        for the period <strong>${start}</strong> to <strong>${end}</strong>.
      </p>
      <p style="margin-bottom: 24px;">
        Total amount payable: <strong>${this.formatCurrency(Number(invoice.total_amount))}</strong>.
      </p>
      ${businessName ? `<p style="font-weight: 700; margin-top: 48px;">${this.escapeHtml(businessName)}</p>` : ''}
    </div>`;
  }

  private buildStampSection(
    invoice: RenewalInvoice,
    tenantName: string,
  ): string {
    if (
      invoice.letter_status !== RenewalLetterStatus.ACCEPTED &&
      invoice.letter_status !== RenewalLetterStatus.DECLINED
    ) {
      return '';
    }
    const isAccepted =
      invoice.letter_status === RenewalLetterStatus.ACCEPTED;
    const stampText = isAccepted ? 'ACCEPTED' : 'DECLINED';

    // Auto-renewed (cron-promoted at expiry) is also "accepted" but
    // visually distinct — no OTP, no human signed it.
    const isAutoRenewed =
      isAccepted && invoice.auto_renewed_at && !invoice.acceptance_otp;
    const visibleStampText = isAutoRenewed ? 'AUTO-RENEWED' : stampText;

    const palette = isAccepted
      ? {
          border: 'rgba(30, 30, 30, 0.4)',
          inner: 'rgba(30, 30, 30, 0.3)',
          text: 'rgba(30, 30, 30, 0.55)',
          stroke: 'rgba(30, 30, 30, 0.25)',
        }
      : {
          border: 'rgba(211, 47, 47, 0.4)',
          inner: 'rgba(211, 47, 47, 0.3)',
          text: 'rgba(211, 47, 47, 0.55)',
          stroke: 'rgba(211, 47, 47, 0.25)',
        };

    return `
    <div class="stamp-wrap" style="--stamp-border: ${palette.border}; --stamp-inner: ${palette.inner}; --stamp-text: ${palette.text}; --stamp-stroke: ${palette.stroke};">
      <div class="stamp">
        <div class="inner"></div>
        <div class="text">${this.escapeHtml(visibleStampText)}</div>
      </div>
    </div>`;
  }

  private buildAuditSection(invoice: RenewalInvoice): string {
    const isAccepted =
      invoice.letter_status === RenewalLetterStatus.ACCEPTED;
    const isDeclined =
      invoice.letter_status === RenewalLetterStatus.DECLINED;
    if (!isAccepted && !isDeclined) {
      return '';
    }

    const decisionAt = isAccepted ? invoice.accepted_at : invoice.declined_at;
    const phone = isAccepted
      ? invoice.accepted_by_phone
      : invoice.declined_by_phone;
    const otp = isAccepted ? invoice.acceptance_otp : invoice.decline_otp;
    const isAutoRenewed = isAccepted && invoice.auto_renewed_at && !otp;

    const rows: Array<[string, string]> = [];
    rows.push([
      'Outcome',
      isAutoRenewed
        ? 'Auto-renewed at expiry'
        : isAccepted
          ? 'Accepted by tenant'
          : 'Declined by tenant',
    ]);
    if (decisionAt) {
      rows.push(['Decision date', this.formatDateTime(decisionAt)]);
    }
    if (phone) rows.push(['Phone', phone]);
    if (otp && !isAutoRenewed) rows.push(['Verification OTP', otp]);
    if (invoice.decision_made_ip) {
      rows.push(['Decision IP', invoice.decision_made_ip]);
    }
    if (isDeclined && invoice.decline_reason) {
      rows.push(['Reason', invoice.decline_reason]);
    }

    const dlInner = rows
      .map(
        ([k, v]) =>
          `<dt>${this.escapeHtml(k)}</dt><dd>${this.escapeHtml(v)}</dd>`,
      )
      .join('');

    return `
    <div class="audit">
      <h3>Decision Audit</h3>
      <dl>${dlInner}</dl>
    </div>`;
  }

  private async htmlToPdf(html: string): Promise<Buffer> {
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
      const e = err as { message?: string; stack?: string };
      this.logger.error(
        `Renewal-letter PDF render failed: ${e.message}`,
        e.stack,
      );
      throw err;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private formatLongDate(input: Date | string): string {
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }

  private formatDateTime(input: Date | string): string {
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return '—';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  private formatCurrency(amount: number): string {
    if (!isFinite(amount)) return '₦0';
    return `₦${Math.round(amount).toLocaleString('en-US')}`;
  }

  private firstName(fullName: string): string {
    const HONORIFIC =
      /^(mr|mrs|miss|ms|mx|dr|prof|sir|madam|chief|engr|hon|rev)\.?$/i;
    return (
      fullName
        .split(/\s+/)
        .filter(Boolean)
        .find((t) => !HONORIFIC.test(t)) || 'Sir/Ma'
    );
  }

  private escapeHtml(text: string): string {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Filename used by Cloudinary for download UX. WhatsApp surfaces this
   * as the document title in chat — keep it human-readable and stable
   * across regenerations.
   */
  buildFilename(propertyName: string, date: Date = new Date()): string {
    const safeProperty = (propertyName || 'property')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const dateStr = date.toISOString().split('T')[0];
    return `renewal-letter-${safeProperty}-${dateStr}.pdf`;
  }
}

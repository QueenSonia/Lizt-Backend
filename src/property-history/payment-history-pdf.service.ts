import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Browser } from 'puppeteer';

import { launchBrowser } from '../common/puppeteer-launch';
import { renderUnifiedReceiptHTML } from '../common/html/unified-receipt-template';
import { resolveBrandingUser } from '../common/branding/branding.util';
import { PropertyHistory } from './entities/property-history.entity';
import { KYCApplication } from '../kyc-links/entities/kyc-application.entity';
import { TemplateSenderService } from '../whatsapp-bot/template-sender';

export interface PaymentReceiptView {
  receiptNumber: string;
  receiptDate: string | null;
  paymentAmount: number;
  paymentDescription: string | null;
  paymentMethod: string;
  paymentReference: string | null;
  property: {
    id: string;
    name: string;
    address: string;
  };
  tenant: {
    name: string;
    phone: string | null;
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
    private readonly templateSenderService: TemplateSenderService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Step 1 of the two-message WhatsApp flow: send the text-only payment
   * confirmation (template `payment_receipt_tenant`) with a Download receipt
   * Quick Reply button. When the tenant taps the button, the tenant-flow
   * webhook handler emits `whatsapp.button.payment_receipt_download` which
   * `onPaymentReceiptDownloadButtonTap` (below) responds to by sending the
   * PDF (Msg 2). Manual trigger from landlord — no idempotency guard.
   */
  async sendReceiptViaWhatsApp(receiptToken: string): Promise<void> {
    const row = await this.loadRow(receiptToken);
    const view = await this.buildView(row);

    if (!view.tenant.phone) {
      throw new BadRequestException(
        'No phone number on record for this tenant — cannot send receipt.',
      );
    }

    const firstName = view.tenant.name.split(/\s+/)[0] || 'there';

    await this.templateSenderService.sendPaymentReceiptTenant({
      phone_number: view.tenant.phone,
      tenant_first_name: firstName,
      amount: view.paymentAmount,
      description: view.paymentDescription || 'Payment received',
      receipt_token: receiptToken,
    });
  }

  /**
   * Step 2 of the two-message WhatsApp flow: generate the PDF live and send
   * it via the `payment_receipt_attachment_tenant` template. The `phone`
   * arg comes from the webhook (the tenant who actually tapped the button)
   * — we don't trust the row's tenant_phone for routing because the row's
   * receipt_token is the only thing that identifies the receipt.
   */
  async sendReceiptAttachmentViaWhatsApp(
    receiptToken: string,
    phone: string,
  ): Promise<void> {
    const row = await this.loadRow(receiptToken);
    const view = await this.buildView(row);

    const pdfBuffer = await this.generatePaymentReceiptPDF(receiptToken);
    const pdfFilename = this.generateReceiptFilename(
      view.property?.name,
      view.receiptDate ? new Date(view.receiptDate) : new Date(),
    );
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ||
      'http://localhost:3000';

    await this.templateSenderService.sendPaymentReceiptAttachmentTenant({
      phone_number: phone,
      pdf_buffer: pdfBuffer,
      pdf_filename: pdfFilename,
      receipt_token: receiptToken,
      frontend_url: frontendUrl,
    });
  }

  /**
   * Webhook bridge: the tenant tapped the Download receipt Quick Reply on
   * Msg 1. The tenant-flow service emits this event with the receipt token
   * (parsed from the button payload) and the tenant's phone (the webhook
   * `from`). Errors are caught here because we don't want a PDF generation
   * failure to bubble back into the WhatsApp bot's webhook reply pipeline.
   */
  @OnEvent('whatsapp.button.payment_receipt_download')
  async onPaymentReceiptDownloadButtonTap(event: {
    token: string;
    phone: string;
  }): Promise<void> {
    try {
      await this.sendReceiptAttachmentViaWhatsApp(event.token, event.phone);
    } catch (err) {
      this.logger.error(
        `Failed to deliver payment receipt PDF for token ${event.token}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

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
        'property.owner.creator',
        'property.owner.creator.user',
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
    const kycApp = await this.loadKycFallback(row);
    // Staged-applicant rows have no formal tenant on a property yet, so the
    // receipt's "Property" field is misleading — show `-` instead of the
    // property the applicant was being staged against.
    const isStagedApplicant = !row.tenant_id && !!kycApp;
    const propertyName = isStagedApplicant
      ? '-'
      : property?.name || 'Property';
    const propertyAddress = isStagedApplicant ? '' : property?.location || '';

    const tenantName = this.resolveTenantName(row, parsed, kycApp);
    const tenantPhone = this.resolveTenantPhone(row, parsed, kycApp);
    const branding = this.resolveLandlordBranding(row);

    return {
      receiptNumber: row.receipt_number || 'N/A',
      receiptDate: paymentDate
        ? new Date(paymentDate).toISOString()
        : null,
      paymentAmount,
      paymentDescription: parsed.paymentDescription || null,
      paymentMethod: 'Manual',
      paymentReference: parsed.paymentReference || null,
      property: {
        id: row.property_id,
        name: propertyName,
        address: propertyAddress,
      },
      tenant: { name: tenantName, phone: tenantPhone },
      landlordBranding: branding,
    };
  }

  private resolveTenantPhone(
    row: PropertyHistory,
    parsed: any,
    kycApp: KYCApplication | null,
  ): string | null {
    const tenantUser = (row.tenant as any)?.user;
    if (tenantUser?.phone_number) return String(tenantUser.phone_number);
    if (parsed.tenantPhone) return String(parsed.tenantPhone);
    if (kycApp?.phone_number) return String(kycApp.phone_number);
    return null;
  }

  private parseDescription(desc: string | null | undefined): any {
    if (!desc) return {};
    try {
      return JSON.parse(desc);
    } catch {
      return {};
    }
  }

  /**
   * Load the linked KYCApplication for staged-applicant rows (tenant_id=NULL).
   * Returns null when not applicable, so callers don't need to repeat the
   * related_entity_type guard.
   */
  private async loadKycFallback(
    row: PropertyHistory,
  ): Promise<KYCApplication | null> {
    if ((row.tenant as any)?.user) return null;
    if (
      row.related_entity_type !== 'kyc_application' ||
      !row.related_entity_id
    ) {
      return null;
    }
    return this.kycApplicationRepository.findOne({
      where: { id: row.related_entity_id },
    });
  }

  private resolveTenantName(
    row: PropertyHistory,
    parsed: any,
    kycApp: KYCApplication | null,
  ): string {
    const tenantUser = (row.tenant as any)?.user;
    if (tenantUser) {
      return (
        `${tenantUser.first_name ?? ''} ${tenantUser.last_name ?? ''}`.trim() ||
        parsed.tenantName ||
        'Tenant'
      );
    }
    if (parsed.tenantName) return String(parsed.tenantName);
    if (kycApp) {
      return (
        `${kycApp.first_name ?? ''} ${kycApp.last_name ?? ''}`.trim() ||
        'Applicant'
      );
    }
    return 'Tenant';
  }

  private resolveLandlordBranding(
    row: PropertyHistory,
  ): PaymentReceiptView['landlordBranding'] {
    const property = row.property as any;
    const account = property?.owner;
    const landlordUser = resolveBrandingUser(account);
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
      // On Linux (production) use `networkidle0` to ensure every external
      // asset (logos on Cloudinary, etc.) has fully settled before printing.
      // On Windows/Mac dev laptops, slow external fetches can hang past the
      // 15s timeout, so fall back to `load` — the page is fully painted, just
      // not guaranteed to have zero in-flight connections.
      await page.setContent(html, {
        waitUntil: process.platform === 'linux' ? 'networkidle0' : 'load',
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

  private generateReceiptHTML(view: PaymentReceiptView): string {
    const b = view.landlordBranding;
    return renderUnifiedReceiptHTML({
      receiptNumber: view.receiptNumber,
      tenantName: view.tenant.name,
      tenantPhone: view.tenant.phone,
      propertyName: view.property.name,
      paymentDate: view.receiptDate,
      paymentMethod: view.paymentMethod,
      landlord: {
        logoUrl: b.logoUrl,
        businessName: b.businessName,
        phone: b.contactPhone,
        email: b.contactEmail,
        address: b.businessAddress,
      },
      descriptionRows: [
        {
          label: view.paymentDescription || 'Payment received',
          amount: view.paymentAmount,
        },
      ],
      amountPaid: view.paymentAmount,
    });
  }

}

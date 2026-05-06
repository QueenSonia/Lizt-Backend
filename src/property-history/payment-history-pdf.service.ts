import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Browser } from 'puppeteer';

import { launchBrowser } from '../common/puppeteer-launch';
import { renderUnifiedReceiptHTML } from '../common/html/unified-receipt-template';
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
    const tenantPhone = this.resolveTenantPhone(row, parsed);
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
      tenant: { name: tenantName, phone: tenantPhone },
      landlordBranding: branding,
    };
  }

  private resolveTenantPhone(
    row: PropertyHistory,
    parsed: any,
  ): string | null {
    const tenantUser = (row.tenant as any)?.user;
    if (tenantUser?.phone_number) return String(tenantUser.phone_number);
    if (parsed.tenantPhone) return String(parsed.tenantPhone);
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
        { label: 'Payment received', amount: view.paymentAmount },
      ],
      amountPaid: view.paymentAmount,
    });
  }

}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import type { Browser } from 'puppeteer';

import { launchBrowser } from '../common/puppeteer-launch';
import { Receipt } from './entities/receipt.entity';
import { OfferLetter } from '../offer-letters/entities/offer-letter.entity';
import { KYCApplication } from '../kyc-links/entities/kyc-application.entity';
import { Property } from '../properties/entities/property.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceLineItem } from '../invoices/entities/invoice-line-item.entity';
import { FileUploadService } from '../utils/cloudinary';
import { PropertyHistoryService } from '../property-history/property-history.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/enums/notification-type';

export interface GenerateReceiptParams {
  paymentId: string;
  offerLetterId: string;
  amount: number;
  paymentMethod: string;
  paymentReference: string;
  paidAt: Date;
}

@Injectable()
export class ReceiptGeneratorService {
  private readonly logger = new Logger(ReceiptGeneratorService.name);

  constructor(
    @InjectRepository(Receipt)
    private readonly receiptRepository: Repository<Receipt>,
    @InjectRepository(OfferLetter)
    private readonly offerLetterRepository: Repository<OfferLetter>,
    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepository: Repository<KYCApplication>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(InvoiceLineItem)
    private readonly invoiceLineItemRepository: Repository<InvoiceLineItem>,
    private readonly fileUploadService: FileUploadService,
    private readonly propertyHistoryService: PropertyHistoryService,
    private readonly notificationService: NotificationService,
  ) {}

  async generateReceipt(params: GenerateReceiptParams): Promise<Receipt> {
    const {
      paymentId,
      offerLetterId,
      amount,
      paymentMethod,
      paymentReference,
      paidAt,
    } = params;

    // Load related entities
    const offerLetter = await this.offerLetterRepository.findOne({
      where: { id: offerLetterId },
    });
    if (!offerLetter) {
      throw new Error(`Offer letter ${offerLetterId} not found`);
    }

    const kycApplication = await this.kycApplicationRepository.findOne({
      where: { id: offerLetter.kyc_application_id },
    });
    if (!kycApplication) {
      throw new Error(
        `KYC application ${offerLetter.kyc_application_id} not found`,
      );
    }

    const property = await this.propertyRepository.findOne({
      where: { id: offerLetter.property_id },
    });
    if (!property) {
      throw new Error(`Property ${offerLetter.property_id} not found`);
    }

    // Find associated invoice for invoice number
    const invoice = await this.invoiceRepository.findOne({
      where: { offer_letter_id: offerLetterId },
    });

    // Billing v2 — snapshot the invoice's line items at receipt-issue time
    // so the receipt PDF remains accurate even if the invoice is later edited.
    const invoiceLineItems = invoice
      ? await this.invoiceLineItemRepository.find({
          where: { invoice_id: invoice.id },
        })
      : [];
    const snapshotLineItems = invoiceLineItems.map((li) => ({
      label: li.description,
      amount: Number(li.amount) || 0,
      feeKind: li.fee_kind ?? null,
      isRecurring: !!li.is_recurring,
    }));

    // Generate unique identifiers
    const receiptNumber = await this.generateReceiptNumber();
    const token = crypto.randomBytes(32).toString('hex');

    // Create receipt entity
    const receipt = this.receiptRepository.create({
      receipt_number: receiptNumber,
      payment_id: paymentId,
      offer_letter_id: offerLetterId,
      property_id: offerLetter.property_id,
      kyc_application_id: offerLetter.kyc_application_id,
      token,
      receipt_date: paidAt,
      amount_paid: amount,
      payment_method: paymentMethod,
      payment_reference: paymentReference,
      tenant_name: `${kycApplication.first_name} ${kycApplication.last_name}`,
      tenant_email: kycApplication.email || null,
      tenant_phone: kycApplication.phone_number || null,
      property_name: property.name,
      property_address: property.location || null,
      invoice_number: invoice?.invoice_number || null,
      branding: offerLetter.branding || null,
      line_items: snapshotLineItems,
    });

    const savedReceipt = await this.receiptRepository.save(receipt);

    // Create property history record and notification for receipt issuance
    try {
      const tenantName = `${kycApplication.first_name} ${kycApplication.last_name}`;
      const propertyName = property.name || 'Property';
      const landlordId = offerLetter.landlord_id;

      await this.propertyHistoryService.createPropertyHistory({
        property_id: savedReceipt.property_id,
        tenant_id: kycApplication.tenant_id || null,
        event_type: 'receipt_issued',
        event_description: `Receipt issued for ${tenantName} — ₦${amount.toLocaleString()}`,
        related_entity_id: savedReceipt.id,
        related_entity_type: 'receipt',
      });

      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.RECEIPT_ISSUED,
        description: `Receipt of ₦${amount.toLocaleString()} issued for ${tenantName} — ${propertyName}`,
        status: 'Completed',
        property_id: savedReceipt.property_id,
        user_id: landlordId,
      });
    } catch (error) {
      this.logger.error(
        'Failed to create receipt_issued history/notification:',
        error,
      );
    }

    // Fire-and-forget PDF generation
    this.generateReceiptPDF(savedReceipt.id).catch((err) => {
      this.logger.error(
        `Receipt PDF generation failed for receipt ${savedReceipt.id}`,
        err.stack,
      );
    });

    return savedReceipt;
  }

  async generateReceiptPDF(receiptId: string): Promise<Buffer> {
    const receipt = await this.receiptRepository.findOne({
      where: { id: receiptId },
    });
    if (!receipt) {
      throw new Error(`Receipt ${receiptId} not found`);
    }

    const html = this.generateReceiptHTML(receipt);
    const pdfBuffer = await this.htmlToPDF(html);

    // Upload to Cloudinary
    try {
      const filename = `receipt-${receipt.receipt_number}-${Date.now()}`;
      const uploadResult = await this.fileUploadService.uploadBuffer(
        pdfBuffer,
        filename,
      );
      await this.receiptRepository.update(receipt.id, {
        pdf_url: uploadResult.secure_url,
      });
      this.logger.log(`Receipt PDF uploaded for ${receipt.receipt_number}`);
    } catch (err) {
      this.logger.error(
        `Failed to upload receipt PDF for ${receipt.receipt_number}`,
        err.stack,
      );
    }

    return pdfBuffer;
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

  generateReceiptHTML(receipt: Receipt): string {
    const formatCurrency = (amount: number) =>
      `₦${Number(amount).toLocaleString('en-NG')}`;
    const formatDate = (date: Date | string) => {
      const d = new Date(date);
      return d.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
    };

    const branding = receipt.branding as any;
    const companyName =
      branding?.companyName || branding?.businessName || 'Property Kraft';
    const companyAddress = branding?.address || branding?.businessAddress;
    const companyEmail = branding?.email || branding?.contactEmail;
    const companyLogo = branding?.logo || branding?.letterhead;

    // Default address lines
    const defaultAddress = `17 Ayinde Akinmade Street,<br>Lekki Phase 1,<br>Lagos, Nigeria.`;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Inter, system-ui, -apple-system, sans-serif; background: #fff; color: #111827; }
    .container { max-width: 800px; margin: 0 auto; padding: 64px 48px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 48px; padding-bottom: 32px; border-bottom: 1px solid #e5e7eb; }
    .company-info { flex: 1; }
    .logo { height: 48px; margin-bottom: 24px; object-fit: contain; }
    .company-name { font-size: 14px; font-weight: 600; color: #111827; margin-bottom: 4px; }
    .company-detail { font-size: 12px; color: #4b5563; line-height: 1.5; max-width: 320px; }
    .company-email { font-size: 12px; color: #4b5563; margin-top: 4px; }
    .receipt-title { text-align: right; }
    .receipt-title h1 { font-size: 24px; font-weight: 700; color: #111827; letter-spacing: -0.025em; margin-bottom: 12px; }
    .receipt-meta { font-size: 12px; color: #4b5563; line-height: 1.25; }
    .receipt-meta span { font-weight: 500; color: #1f2937; }
    .summary-block { margin-bottom: 40px; border: 1px solid #e5e7eb; padding: 32px; background: #f9fafb; text-align: center; }
    .summary-amount { font-size: 36px; font-weight: 700; color: #111827; margin-bottom: 8px; }
    .summary-label { font-size: 18px; font-weight: 500; color: #374151; margin-bottom: 12px; }
    .summary-details { font-size: 14px; color: #6b7280; display: flex; align-items: center; justify-content: center; gap: 24px; }
    .summary-details .paid { font-weight: 500; color: #15803d; }
    .summary-details .ref { font-weight: 500; color: #111827; }
    .summary-details .separator { color: #d1d5db; }
    .section-title { font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb; }
    .detail-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; font-size: 14px; }
    .detail-label { color: #4b5563; }
    .detail-value { font-weight: 500; color: #111827; }
    .detail-value-bold { font-weight: 600; color: #111827; }
    .divider { height: 1px; background: #e5e7eb; margin: 32px 0; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 40px; }
    .info-label { font-size: 11px; color: #6b7280; margin-bottom: 2px; }
    .info-value { font-size: 14px; font-weight: 500; color: #111827; }
    .info-item { margin-bottom: 8px; }
    .footer { text-align: center; font-size: 14px; color: #374151; }
    .payment-details-section { margin-bottom: 40px; }
    .space-y-3 > * + * { margin-top: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="company-info">
        ${companyLogo ? `<img src="${this.escapeHtml(companyLogo)}" alt="Company Logo" class="logo">` : ''}
        <p class="company-name">${this.escapeHtml(companyName)}</p>
        <p class="company-detail">${companyAddress ? this.escapeHtml(companyAddress) : defaultAddress}</p>
        ${companyEmail ? `<p class="company-email">${this.escapeHtml(companyEmail)}</p>` : ''}
      </div>
      <div class="receipt-title">
        <h1>RECEIPT</h1>
        <div class="receipt-meta">
          <p><span>Receipt No:</span> ${this.escapeHtml(receipt.receipt_number)}</p>
          <p><span>Issue Date:</span> ${formatDate(receipt.receipt_date)}</p>
        </div>
      </div>
    </div>

    <div class="summary-block">
      <p class="summary-amount">${formatCurrency(receipt.amount_paid)}</p>
      <p class="summary-label">Payment Received</p>
      <div class="summary-details">
        <span>Status: <span class="paid">PAID</span></span>
        ${receipt.payment_method ? `<span class="separator">|</span><span>Method: <span class="ref">${this.escapeHtml(receipt.payment_method)}</span></span>` : ''}
        <span class="separator">|</span>
        <span>Ref: <span class="ref">${this.escapeHtml(receipt.payment_reference)}</span></span>
      </div>
    </div>

    <div class="payment-details-section">
      <h3 class="section-title">Payment Details</h3>
      <div class="space-y-3">
        <div class="detail-row">
          <span class="detail-label">Invoice Reference</span>
          <span class="detail-value">${this.escapeHtml(receipt.invoice_number || 'N/A')}</span>
        </div>
        ${this.renderReceiptLineItems(receipt, formatCurrency)}
        <div class="detail-row" style="border-top:1px solid #e5e7eb;padding-top:12px;margin-top:8px;">
          <span class="detail-label">Amount Paid</span>
          <span class="detail-value-bold">${formatCurrency(receipt.amount_paid)}</span>
        </div>
        ${receipt.notes ? `<div class="detail-row"><span class="detail-label">Notes</span><span class="detail-value" style="text-align:right;max-width:448px">${this.escapeHtml(receipt.notes)}</span></div>` : ''}
      </div>
    </div>

    <div class="divider"></div>

    <div class="info-grid">
      <div>
        <h3 class="section-title">Tenant Information</h3>
        <div class="info-item">
          <p class="info-label">Name</p>
          <p class="info-value">${this.escapeHtml(receipt.tenant_name)}</p>
        </div>
        ${receipt.tenant_phone ? `<div class="info-item"><p class="info-label">Phone</p><p class="info-value">${this.escapeHtml(receipt.tenant_phone)}</p></div>` : ''}
        ${receipt.tenant_email ? `<div class="info-item"><p class="info-label">Email</p><p class="info-value">${this.escapeHtml(receipt.tenant_email)}</p></div>` : ''}
      </div>
      <div>
        <h3 class="section-title">Property Information</h3>
        <div class="info-item">
          <p class="info-label">Property Name</p>
          <p class="info-value">${this.escapeHtml(receipt.property_name)}</p>
        </div>
        ${receipt.property_address ? `<div class="info-item"><p class="info-label">Address</p><p class="info-value">${this.escapeHtml(receipt.property_address)}</p></div>` : ''}
      </div>
    </div>

    <div class="divider"></div>

    <div class="footer">
      <p>This receipt confirms payment received for the above tenancy invoice.</p>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Render the itemized line-items block on the receipt. Falls back to a
   * single lump-sum row if the snapshot is empty (pre-billing-v2 receipts).
   */
  private renderReceiptLineItems(
    receipt: Receipt,
    formatCurrency: (n: number) => string,
  ): string {
    const items = receipt.line_items || [];
    if (items.length === 0) return '';
    return items
      .map(
        (item) =>
          `<div class="detail-row"><span class="detail-label">${this.escapeHtml(item.label)}${item.isRecurring ? ' <span style="font-size:10px;color:#6b7280;">(recurring)</span>' : ''}</span><span class="detail-value">${formatCurrency(Number(item.amount) || 0)}</span></div>`,
      )
      .join('');
  }

  private async generateReceiptNumber(): Promise<string> {
    const lastReceipt = await this.receiptRepository
      .createQueryBuilder('receipt')
      .where('receipt.receipt_number LIKE :prefix', { prefix: 'RCT-%' })
      .orderBy('receipt.receipt_number', 'DESC')
      .getOne();

    let nextNumber = 1;
    if (lastReceipt) {
      const lastNum = parseInt(
        lastReceipt.receipt_number.replace('RCT-', ''),
        10,
      );
      if (!isNaN(lastNum)) {
        nextNumber = lastNum + 1;
      }
    }

    return `RCT-${String(nextNumber).padStart(6, '0')}`;
  }

  private escapeHtml(text: string): string {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

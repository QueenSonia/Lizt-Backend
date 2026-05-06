import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import type { Browser } from 'puppeteer';

import { launchBrowser } from '../common/puppeteer-launch';
import { renderUnifiedReceiptHTML } from '../common/html/unified-receipt-template';
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
    const branding: any = receipt.branding ?? {};
    const lineItems = (receipt.line_items ?? []).map((li) => ({
      label: li.label,
      amount: Number(li.amount) || 0,
    }));
    const rows =
      lineItems.length > 0
        ? lineItems
        : [
            {
              label: 'Payment received',
              amount: Number(receipt.amount_paid) || 0,
            },
          ];
    return renderUnifiedReceiptHTML({
      receiptNumber: receipt.receipt_number,
      tenantName: receipt.tenant_name,
      tenantPhone: receipt.tenant_phone,
      propertyName: receipt.property_name,
      paymentDate: receipt.receipt_date,
      paymentMethod: receipt.payment_method,
      landlord: {
        logoUrl: branding?.letterhead ?? branding?.logo ?? null,
        businessName:
          branding?.businessName ?? branding?.companyName ?? null,
        phone: branding?.contactPhone ?? null,
        email: branding?.contactEmail ?? branding?.email ?? null,
        address: branding?.businessAddress ?? branding?.address ?? null,
      },
      descriptionRows: rows,
      amountPaid: Number(receipt.amount_paid) || 0,
    });
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

}

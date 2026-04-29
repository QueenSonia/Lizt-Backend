import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Browser } from 'puppeteer';

import { launchBrowser } from '../common/puppeteer-launch';
import { RenewalInvoice } from '../tenancies/entities/renewal-invoice.entity';
import { FileUploadService } from '../utils/cloudinary';

/**
 * Renewal-letter PDF generator.
 *
 * Loads the live tenant-facing page at /renewal-letters/[token]?print=1 in
 * Puppeteer and prints it to PDF. The ?print=1 flag tells the page to hide
 * banners, action buttons, modals, and the gray page chrome (shadow,
 * border) so the PDF is the document itself, not a screenshot of the page.
 *
 * Loading the real page guarantees pixel parity with what the tenant sees:
 * any future change to the page automatically flows to the PDF, no
 * duplicated CSS / layout in the backend.
 */
@Injectable()
export class RenewalLetterPdfService {
  private readonly logger = new Logger(RenewalLetterPdfService.name);

  constructor(
    @InjectRepository(RenewalInvoice)
    private readonly renewalInvoiceRepository: Repository<RenewalInvoice>,
    private readonly fileUploadService: FileUploadService,
  ) {}

  async generatePdfBuffer(invoiceId: string): Promise<Buffer> {
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { id: invoiceId },
      select: ['id', 'token'],
    });
    if (!invoice) {
      throw new NotFoundException('Renewal invoice not found');
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const url = `${frontendUrl.replace(/\/$/, '')}/renewal-letters/${invoice.token}?print=1`;
    return this.urlToPdf(url);
  }

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

  // ── PDF rendering ────────────────────────────────────────────────────

  /**
   * Drive Puppeteer through the tenant page and print it. Two waits guard
   * against snapshotting too early:
   *   - networkidle0 catches the initial bundle load + the page's own
   *     fetch to /api/proxy/renewal-letters/:token + image loads.
   *   - data-pdf-ready="1" flips on the outer wrapper after the page's
   *     post-render data-field sync useEffect has mutated the DOM.
   * The viewport width is set to the A4 print width at 96 dpi so the
   * page's responsive `sm:` breakpoints match what the tenant sees on
   * desktop, not the cramped mobile layout.
   */
  private async urlToPdf(url: string): Promise<Buffer> {
    let browser: Browser | null = null;
    try {
      browser = await launchBrowser();
      const page = await browser.newPage();
      await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
      await page.waitForSelector('[data-pdf-ready="1"]', { timeout: 15000 });
      // Some web fonts resolve after networkidle — wait for the font set
      // to settle so the printed text uses the right glyphs.
      await page.evaluate(() => document.fonts?.ready);

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      });

      return Buffer.from(pdf);
    } catch (err) {
      const e = err as { message?: string; stack?: string };
      this.logger.error(
        `Renewal-letter PDF render failed (url=${url}): ${e.message}`,
        e.stack,
      );
      throw err;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  buildFilename(propertyName: string, date: Date = new Date()): string {
    const safeProperty = (propertyName || 'property')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const dateStr = date.toISOString().split('T')[0];
    return `renewal-letter-${safeProperty}-${dateStr}.pdf`;
  }
}

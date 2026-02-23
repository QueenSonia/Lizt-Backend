import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Receipt } from './entities/receipt.entity';
import { OfferLetter } from '../offer-letters/entities/offer-letter.entity';
import { ReceiptGeneratorService } from './receipt-generator.service';
import { PropertyHistoryService } from '../property-history/property-history.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/enums/notification-type';

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    @InjectRepository(Receipt)
    private readonly receiptRepository: Repository<Receipt>,
    @InjectRepository(OfferLetter)
    private readonly offerLetterRepository: Repository<OfferLetter>,
    private readonly receiptGeneratorService: ReceiptGeneratorService,
    private readonly propertyHistoryService: PropertyHistoryService,
    private readonly notificationService: NotificationService,
  ) {}

  async findByOfferLetterId(
    offerLetterId: string,
    landlordId: string,
  ): Promise<Receipt[]> {
    // Verify landlord ownership via offer letter
    const offerLetter = await this.offerLetterRepository.findOne({
      where: { id: offerLetterId, landlord_id: landlordId },
    });
    if (!offerLetter) {
      throw new NotFoundException('Offer letter not found');
    }

    return this.receiptRepository.find({
      where: { offer_letter_id: offerLetterId },
      order: { created_at: 'DESC' },
    });
  }

  async findByPropertyId(
    propertyId: string,
    landlordId: string,
  ): Promise<Receipt[]> {
    // Verify landlord ownership via offer letter linked to this property
    const offerLetter = await this.offerLetterRepository.findOne({
      where: { property_id: propertyId, landlord_id: landlordId },
    });
    if (!offerLetter) {
      throw new NotFoundException(
        'Property not found or not owned by landlord',
      );
    }

    return this.receiptRepository.find({
      where: { property_id: propertyId },
      order: { created_at: 'DESC' },
    });
  }

  async findById(id: string, landlordId: string): Promise<Receipt> {
    const receipt = await this.receiptRepository.findOne({
      where: { id },
      relations: ['offer_letter'],
    });
    if (!receipt) {
      throw new NotFoundException('Receipt not found');
    }

    // Verify landlord ownership
    if (receipt.offer_letter?.landlord_id !== landlordId) {
      throw new NotFoundException('Receipt not found');
    }

    return receipt;
  }

  async findByToken(token: string): Promise<Receipt> {
    const receipt = await this.receiptRepository.findOne({
      where: { token },
    });
    if (!receipt) {
      throw new NotFoundException('Receipt not found');
    }
    return receipt;
  }

  /**
   * Find the most recent receipt by offer letter ID (internal use, no auth check)
   */
  async findMostRecentByOfferLetterId(
    offerLetterId: string,
  ): Promise<Receipt | null> {
    return this.receiptRepository.findOne({
      where: { offer_letter_id: offerLetterId },
      order: { created_at: 'DESC' },
    });
  }

  async downloadPDF(id: string, landlordId: string): Promise<Buffer> {
    const receipt = await this.findById(id, landlordId);

    // If PDF already exists, fetch it
    if (receipt.pdf_url) {
      try {
        const response = await fetch(receipt.pdf_url);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          return Buffer.from(arrayBuffer);
        }
      } catch (err) {
        this.logger.warn(
          `Failed to fetch existing PDF for receipt ${id}, regenerating`,
          err.message,
        );
      }
    }

    // Generate on-the-fly
    return this.receiptGeneratorService.generateReceiptPDF(id);
  }

  /**
   * Track when a tenant views a receipt (public endpoint)
   * Requirements: 6.1, 6.2, 6.3, 6.4, 12.6
   */
  async trackReceiptView(
    token: string,
    ipAddress?: string,
  ): Promise<{ success: boolean; message: string }> {
    const receipt = await this.receiptRepository.findOne({
      where: { token },
      relations: ['offer_letter'],
    });

    if (!receipt) {
      throw new NotFoundException('Receipt not found');
    }

    try {
      const formattedDate = new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      const formattedTime = new Date().toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      // Look up tenant_id from the KYC application linked to the offer letter
      let tenantId: string | null = null;
      if (receipt.offer_letter?.id) {
        const offerLetter = await this.offerLetterRepository.findOne({
          where: { id: receipt.offer_letter.id },
          relations: ['kyc_application'],
        });
        tenantId = offerLetter?.kyc_application?.tenant_id || null;
      }

      await this.propertyHistoryService.createPropertyHistory({
        property_id: receipt.property_id,
        tenant_id: tenantId,
        event_type: 'receipt_viewed',
        event_description: `Receipt viewed — ${ipAddress || 'Unknown IP'} — ${formattedDate} at ${formattedTime}`,
        related_entity_id: receipt.id,
        related_entity_type: 'receipt',
      });

      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.RECEIPT_VIEWED,
        description: `Receipt viewed — ${ipAddress || 'Unknown IP'} — ${receipt.property_name || 'Property'}`,
        status: 'Completed',
        property_id: receipt.property_id,
        user_id: receipt.offer_letter?.landlord_id,
      });

      this.logger.log(
        `Receipt ${receipt.id} viewed from IP ${ipAddress || 'Unknown'}`,
      );
    } catch (error) {
      this.logger.error('Failed to create receipt_viewed history:', error);
    }

    return {
      success: true,
      message: 'Receipt view tracked successfully',
    };
  }
}

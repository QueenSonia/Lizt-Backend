import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Receipt } from './entities/receipt.entity';
import { OfferLetter } from '../offer-letters/entities/offer-letter.entity';
import { Property } from '../properties/entities/property.entity';
import { ReceiptGeneratorService } from './receipt-generator.service';
import { PropertyHistoryService } from '../property-history/property-history.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/enums/notification-type';
import { ManagementScopeService } from '../common/scope/management-scope.service';

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    @InjectRepository(Receipt)
    private readonly receiptRepository: Repository<Receipt>,
    @InjectRepository(OfferLetter)
    private readonly offerLetterRepository: Repository<OfferLetter>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    private readonly receiptGeneratorService: ReceiptGeneratorService,
    private readonly propertyHistoryService: PropertyHistoryService,
    private readonly notificationService: NotificationService,
    private readonly scopeService: ManagementScopeService,
  ) {}

  /**
   * True when `requesterId` may read receipts owned by `ownerId`: either they
   * ARE that landlord, or they are an admin (property manager) who manages
   * them. The authed receipt endpoints are admin-guarded, so without the
   * manages-check every one of them 404'd for the very role allowed to call.
   */
  private async canManageOwner(
    ownerId: string | null | undefined,
    requesterId: string,
  ): Promise<boolean> {
    if (!ownerId) return false;
    if (ownerId === requesterId) return true;
    return this.scopeService.managesLandlord(requesterId, ownerId);
  }

  async findByOfferLetterId(
    offerLetterId: string,
    requesterId: string,
  ): Promise<Receipt[]> {
    // Verify the requester is the offer's landlord or a managing admin
    const offerLetter = await this.offerLetterRepository.findOne({
      where: { id: offerLetterId },
    });
    if (
      !offerLetter ||
      !(await this.canManageOwner(offerLetter.landlord_id, requesterId))
    ) {
      throw new NotFoundException('Offer letter not found');
    }

    return this.receiptRepository.find({
      where: { offer_letter_id: offerLetterId },
      order: { created_at: 'DESC' },
    });
  }

  async findByPropertyId(
    propertyId: string,
    requesterId: string,
  ): Promise<Receipt[]> {
    // Verify the requester is the property's landlord or a managing admin
    const property = await this.propertyRepository.findOne({
      where: { id: propertyId },
    });
    if (
      !property ||
      !(await this.canManageOwner(property.owner_id, requesterId))
    ) {
      throw new NotFoundException(
        'Property not found or not owned by landlord',
      );
    }

    return this.receiptRepository.find({
      where: { property_id: propertyId },
      order: { created_at: 'DESC' },
    });
  }

  async findById(id: string, requesterId: string): Promise<Receipt> {
    const receipt = await this.receiptRepository.findOne({
      where: { id },
      relations: ['offer_letter'],
    });
    if (!receipt) {
      throw new NotFoundException('Receipt not found');
    }

    // Verify the requester is the receipt's landlord or a managing admin
    if (
      !(await this.canManageOwner(
        receipt.offer_letter?.landlord_id,
        requesterId,
      ))
    ) {
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
    await this.findById(id, landlordId);
    return this.downloadPDFById(id);
  }

  /**
   * Variant for the public-token endpoint — caller has already verified the
   * token, so no landlord ownership check needed.
   */
  async downloadPDFByToken(token: string): Promise<{
    receipt: Receipt;
    pdf: Buffer;
  }> {
    const receipt = await this.findByToken(token);
    const pdf = await this.downloadPDFById(receipt.id);
    return { receipt, pdf };
  }

  private async downloadPDFById(id: string): Promise<Buffer> {
    const receipt = await this.receiptRepository.findOne({ where: { id } });
    if (!receipt) {
      throw new NotFoundException('Receipt not found');
    }

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
          (err as Error).message,
        );
      }
    }

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

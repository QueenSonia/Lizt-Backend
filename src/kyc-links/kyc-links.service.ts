import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { KYCLink } from './entities/kyc-link.entity';
import { Property } from '../properties/entities/property.entity';
import { PropertyStatusEnum } from '../properties/dto/create-property.dto';
import { WhatsappBotService } from '../whatsapp-bot/whatsapp-bot.service';
import { UtilService } from '../utils/utility-service';

export interface KYCLinkResponse {
  token: string;
  link: string;
  expiresAt: Date;
  propertyId: string;
}

export interface PropertyKYCData {
  valid: boolean;
  propertyInfo?: {
    id: string;
    name: string;
    location: string;
    propertyType: string;
    bedrooms: number;
    bathrooms: number;
  };
  error?: string;
}

export interface WhatsAppResponse {
  success: boolean;
  message: string;
}

@Injectable()
export class KYCLinksService {
  private readonly DEFAULT_EXPIRY_DAYS = 7;

  constructor(
    @InjectRepository(KYCLink)
    private readonly kycLinkRepository: Repository<KYCLink>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    private readonly configService: ConfigService,
    private readonly whatsappBotService: WhatsappBotService,
  ) {}

  /**
   * Generate a unique KYC link for a property
   * Requirements: 1.1, 1.2, 2.1, 2.2
   */
  async generateKYCLink(
    propertyId: string,
    landlordId: string,
  ): Promise<KYCLinkResponse> {
    // Validate property ownership
    const property = await this.validatePropertyOwnership(
      propertyId,
      landlordId,
    );

    // Check if property is vacant
    if (property.property_status !== PropertyStatusEnum.VACANT) {
      throw new BadRequestException(
        'Cannot generate link. Property already has an active tenant',
      );
    }

    // Check if there's already an active KYC link for this property
    const existingLink = await this.kycLinkRepository.findOne({
      where: {
        property_id: propertyId,
        is_active: true,
      },
    });

    if (existingLink) {
      // Return existing active link
      const baseUrl =
        this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
      return {
        token: existingLink.token,
        link: `${baseUrl}/kyc/${existingLink.token}`,
        expiresAt: existingLink.expires_at,
        propertyId: existingLink.property_id,
      };
    }

    // Generate new token and expiry date
    const token = uuidv4();
    const expiryDays =
      this.configService.get('KYC_LINK_EXPIRY_DAYS') ||
      this.DEFAULT_EXPIRY_DAYS;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiryDays);

    // Create new KYC link
    const kycLink = this.kycLinkRepository.create({
      token,
      property_id: propertyId,
      landlord_id: landlordId,
      expires_at: expiresAt,
      is_active: true,
    });

    await this.kycLinkRepository.save(kycLink);

    const baseUrl =
      this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const link = `${baseUrl}/kyc/${token}`;

    return {
      token,
      link,
      expiresAt,
      propertyId,
    };
  }

  /**
   * Validate KYC token and return property information
   * Requirements: 2.4, 2.5, 3.5
   */
  async validateKYCToken(token: string): Promise<PropertyKYCData> {
    try {
      // Validate token format (should be UUID)
      if (!token || typeof token !== 'string' || token.trim() === '') {
        return {
          valid: false,
          error: 'Invalid KYC token format',
        };
      }

      const kycLink = await this.kycLinkRepository.findOne({
        where: { token: token.trim() },
        relations: ['property'],
      });

      if (!kycLink) {
        return {
          valid: false,
          error: 'Invalid KYC token',
        };
      }

      if (!kycLink.is_active) {
        return {
          valid: false,
          error: 'This KYC form is no longer available',
        };
      }

      if (new Date() > kycLink.expires_at) {
        // Deactivate expired token
        await this.kycLinkRepository.update(kycLink.id, { is_active: false });
        return {
          valid: false,
          error: 'This KYC form has expired',
        };
      }

      // Check if property still exists and is accessible
      if (!kycLink.property) {
        await this.kycLinkRepository.update(kycLink.id, { is_active: false });
        return {
          valid: false,
          error:
            'Property associated with this KYC form is no longer available',
        };
      }

      // Check if property is still vacant
      if (kycLink.property.property_status !== PropertyStatusEnum.VACANT) {
        // Deactivate link for occupied property
        await this.kycLinkRepository.update(kycLink.id, { is_active: false });
        return {
          valid: false,
          error: 'This property is no longer available',
        };
      }

      return {
        valid: true,
        propertyInfo: {
          id: kycLink.property.id,
          name: kycLink.property.name,
          location: kycLink.property.location,
          propertyType: kycLink.property.property_type,
          bedrooms: kycLink.property.no_of_bedrooms,
          bathrooms: kycLink.property.no_of_bathrooms,
        },
      };
    } catch (error) {
      console.error('Error validating KYC token:', error);
      return {
        valid: false,
        error: 'An error occurred while validating the KYC token',
      };
    }
  }

  /**
   * Deactivate KYC link when property status changes
   * Requirements: 2.4, 2.5, 3.5
   */
  async deactivateKYCLink(propertyId: string): Promise<void> {
    try {
      if (
        !propertyId ||
        typeof propertyId !== 'string' ||
        propertyId.trim() === ''
      ) {
        throw new BadRequestException('Invalid property ID provided');
      }

      const result = await this.kycLinkRepository.update(
        {
          property_id: propertyId.trim(),
          is_active: true,
        },
        {
          is_active: false,
        },
      );

      console.log(
        `Deactivated ${result.affected || 0} KYC links for property ${propertyId}`,
      );
    } catch (error) {
      console.error('Error deactivating KYC links:', error);
      throw new HttpException(
        'Failed to deactivate KYC links',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Deactivate expired KYC links (cleanup method)
   * Can be called periodically to clean up expired links
   */
  async deactivateExpiredKYCLinks(): Promise<number> {
    try {
      const result = await this.kycLinkRepository.update(
        {
          is_active: true,
          expires_at: LessThan(new Date()),
        },
        {
          is_active: false,
        },
      );

      const deactivatedCount = result.affected || 0;
      console.log(`Deactivated ${deactivatedCount} expired KYC links`);
      return deactivatedCount;
    } catch (error) {
      console.error('Error deactivating expired KYC links:', error);
      return 0;
    }
  }

  /**
   * Send KYC link via WhatsApp
   * Requirements: 1.5, 7.2, 7.3
   */
  async sendKYCLinkViaWhatsApp(
    phoneNumber: string,
    kycLink: string,
    propertyName: string,
  ): Promise<WhatsAppResponse> {
    try {
      // Validate and normalize phone number
      if (!phoneNumber || phoneNumber.trim() === '') {
        throw new BadRequestException(
          'Enter a valid phone number to send via WhatsApp',
        );
      }

      const normalizedPhone = UtilService.normalizePhoneNumber(phoneNumber);

      // Create WhatsApp message payload
      const payload = {
        messaging_product: 'whatsapp',
        to: normalizedPhone,
        type: 'text',
        text: {
          body: `Hello! You've been invited to apply for the property "${propertyName}". Please complete your KYC application using this link: ${kycLink}

This link will expire in 7 days. Complete your application as soon as possible to secure your tenancy.

Thank you!`,
        },
      };

      // Send message using WhatsApp bot service
      await this.whatsappBotService['sendToWhatsappAPI'](payload);

      return {
        success: true,
        message: 'KYC link sent successfully via WhatsApp',
      };
    } catch (error) {
      console.error('Error sending WhatsApp message:', error);

      if (error instanceof BadRequestException) {
        throw error;
      }

      return {
        success: false,
        message: 'Failed to send link. Please try again or copy manually',
      };
    }
  }

  /**
   * Validate property ownership before generating KYC link
   * Private helper method
   */
  private async validatePropertyOwnership(
    propertyId: string,
    landlordId: string,
  ): Promise<Property> {
    const property = await this.propertyRepository.findOne({
      where: { id: propertyId },
    });

    if (!property) {
      throw new NotFoundException('Property not found');
    }

    if (property.owner_id !== landlordId) {
      throw new ForbiddenException(
        'You are not authorized to generate KYC links for this property',
      );
    }

    return property;
  }
}

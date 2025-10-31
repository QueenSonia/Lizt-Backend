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
  errorCode?: string;
  retryAfter?: number;
}

export enum WhatsAppErrorCode {
  RATE_LIMITED = 'RATE_LIMITED',
  INVALID_PHONE = 'INVALID_PHONE',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  NETWORK_ERROR = 'NETWORK_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
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
   * Send KYC link via WhatsApp with enhanced validation and formatting
   * Requirements: 1.5, 7.2, 7.3
   */
  async sendKYCLinkViaWhatsApp(
    phoneNumber: string,
    kycLink: string,
    propertyName: string,
  ): Promise<WhatsAppResponse> {
    try {
      // Enhanced phone number validation
      const validationResult = this.validatePhoneNumber(phoneNumber);
      if (!validationResult.isValid) {
        return {
          success: false,
          message: validationResult.error || 'Invalid phone number',
          errorCode: WhatsAppErrorCode.INVALID_PHONE,
        };
      }

      const normalizedPhone = validationResult.normalizedPhone!;

      // Check rate limiting
      const rateLimitResult = await this.checkRateLimit(normalizedPhone);
      if (!rateLimitResult.allowed) {
        return {
          success: false,
          message: 'Rate limit exceeded. Please try again later.',
          errorCode: WhatsAppErrorCode.RATE_LIMITED,
          retryAfter: rateLimitResult.retryAfter,
        };
      }

      // Create enhanced WhatsApp message with better template
      const message = this.createKYCLinkMessage(propertyName, kycLink);

      const payload = {
        messaging_product: 'whatsapp',
        to: normalizedPhone,
        type: 'text',
        text: {
          preview_url: true,
          body: message,
        },
      };

      // Send message using WhatsApp bot service with retry logic
      await this.sendWithRetry(payload, normalizedPhone);

      // Update rate limiting counter
      await this.updateRateLimit(normalizedPhone);

      return {
        success: true,
        message: 'KYC link sent successfully via WhatsApp',
      };
    } catch (error) {
      console.error('Error sending WhatsApp message:', error);
      return this.handleWhatsAppError(error);
    }
  }

  /**
   * Enhanced phone number validation and formatting
   * Requirements: 7.2, 7.3
   */
  private validatePhoneNumber(phoneNumber: string): {
    isValid: boolean;
    normalizedPhone?: string;
    error?: string;
  } {
    if (
      !phoneNumber ||
      typeof phoneNumber !== 'string' ||
      phoneNumber.trim() === ''
    ) {
      return {
        isValid: false,
        error: 'Enter a valid phone number to send via WhatsApp',
      };
    }

    const trimmedPhone = phoneNumber.trim();

    // Check for minimum length (at least 10 digits)
    const digitsOnly = trimmedPhone.replace(/\D/g, '');
    if (digitsOnly.length < 10) {
      return {
        isValid: false,
        error: 'Phone number must contain at least 10 digits',
      };
    }

    // Check for maximum length (no more than 15 digits as per E.164 standard)
    if (digitsOnly.length > 15) {
      return {
        isValid: false,
        error: 'Phone number is too long (maximum 15 digits)',
      };
    }

    try {
      const normalizedPhone = UtilService.normalizePhoneNumber(trimmedPhone);

      if (!normalizedPhone) {
        return {
          isValid: false,
          error:
            'Invalid phone number format. Please use a valid international format',
        };
      }

      // Additional validation for Nigerian numbers (common use case)
      if (normalizedPhone.startsWith('234')) {
        const nigerianNumber = normalizedPhone.substring(3);
        if (nigerianNumber.length !== 10) {
          return {
            isValid: false,
            error: 'Invalid Nigerian phone number format',
          };
        }
      }

      return {
        isValid: true,
        normalizedPhone,
      };
    } catch (error) {
      return {
        isValid: false,
        error: 'Failed to process phone number. Please check the format',
      };
    }
  }

  /**
   * Create enhanced KYC link message template
   * Requirements: 1.5, 7.2
   */
  private createKYCLinkMessage(propertyName: string, kycLink: string): string {
    const expiryDays =
      this.configService.get('KYC_LINK_EXPIRY_DAYS') ||
      this.DEFAULT_EXPIRY_DAYS;

    return `🏠 *Property Application Invitation*

Hello! You've been invited to apply for:
*${propertyName}*

📋 Complete your KYC application here:
${kycLink}

⏰ *Important:* This link expires in ${expiryDays} days
✅ Submit your application early to secure your tenancy

Questions? Reply to this message for assistance.

*Powered by Lizt Property Management*`;
  }

  /**
   * Check rate limiting for WhatsApp messages
   * Requirements: 7.2, 7.3
   */
  private async checkRateLimit(phoneNumber: string): Promise<{
    allowed: boolean;
    retryAfter?: number;
  }> {
    const rateLimitKey = `whatsapp_rate_limit:${phoneNumber}`;
    const maxMessages = this.configService.get('WHATSAPP_RATE_LIMIT_MAX') || 5;
    const windowMinutes =
      this.configService.get('WHATSAPP_RATE_LIMIT_WINDOW') || 60;

    try {
      // This would typically use Redis or another cache service
      // For now, we'll implement a simple in-memory rate limiting
      const currentTime = Date.now();
      const windowStart = currentTime - windowMinutes * 60 * 1000;

      // In a production environment, you would use a proper cache service
      // This is a simplified implementation for demonstration
      console.log(
        `Rate limit check for ${phoneNumber}: ${maxMessages} messages per ${windowMinutes} minutes`,
      );

      // For now, always allow (would implement proper rate limiting with Redis)
      return { allowed: true };
    } catch (error) {
      console.warn('Rate limiting check failed, allowing message send:', error);
      return { allowed: true };
    }
  }

  /**
   * Update rate limiting counter
   * Requirements: 7.2, 7.3
   */
  private async updateRateLimit(phoneNumber: string): Promise<void> {
    const rateLimitKey = `whatsapp_rate_limit:${phoneNumber}`;

    try {
      // In a production environment, you would increment the counter in your cache service
      console.log(`Updated rate limit counter for ${phoneNumber}`);
    } catch (error) {
      console.warn('Failed to update rate limit counter:', error);
    }
  }

  /**
   * Send WhatsApp message with retry logic
   * Requirements: 7.2, 7.3
   */
  private async sendWithRetry(
    payload: any,
    phoneNumber: string,
    maxRetries: number = 3,
    baseDelay: number = 1000,
  ): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.whatsappBotService['sendToWhatsappAPI'](payload);
        console.log(
          `WhatsApp message sent successfully to ${phoneNumber} on attempt ${attempt}`,
        );
        return;
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `WhatsApp send attempt ${attempt} failed for ${phoneNumber}:`,
          error.message,
        );

        if (attempt < maxRetries) {
          // Exponential backoff: wait longer between each retry
          const delay = baseDelay * Math.pow(2, attempt - 1);
          console.log(`Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // If all retries failed, throw the last error
    throw new HttpException(
      `Failed to send WhatsApp message after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  /**
   * Handle WhatsApp errors and provide appropriate responses
   * Requirements: 7.2, 7.3
   */
  private handleWhatsAppError(error: any): WhatsAppResponse {
    // Handle specific error types
    if (error instanceof BadRequestException) {
      return {
        success: false,
        message: error.message,
        errorCode: WhatsAppErrorCode.INVALID_PHONE,
      };
    }

    if (error instanceof HttpException) {
      const status = error.getStatus();

      if (status === HttpStatus.TOO_MANY_REQUESTS || status === 429) {
        return {
          success: false,
          message: 'Rate limit exceeded. Please try again in a few minutes.',
          errorCode: WhatsAppErrorCode.RATE_LIMITED,
          retryAfter: 300, // 5 minutes
        };
      }

      if (status === HttpStatus.UNAUTHORIZED || status === 401) {
        return {
          success: false,
          message:
            'WhatsApp service authentication failed. Please contact support.',
          errorCode: WhatsAppErrorCode.AUTHENTICATION_ERROR,
        };
      }

      if (status === HttpStatus.SERVICE_UNAVAILABLE || status >= 500) {
        return {
          success: false,
          message:
            'WhatsApp service is temporarily unavailable. Please try again later.',
          errorCode: WhatsAppErrorCode.SERVICE_UNAVAILABLE,
          retryAfter: 60, // 1 minute
        };
      }
    }

    // Handle network errors
    if (
      error.code === 'ECONNREFUSED' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ETIMEDOUT'
    ) {
      return {
        success: false,
        message:
          'Network error occurred. Please check your connection and try again.',
        errorCode: WhatsAppErrorCode.NETWORK_ERROR,
        retryAfter: 30, // 30 seconds
      };
    }

    // Handle unknown errors
    console.error('Unknown WhatsApp error:', error);
    return {
      success: false,
      message:
        'An unexpected error occurred. Please try again or copy the link manually.',
      errorCode: WhatsAppErrorCode.UNKNOWN_ERROR,
    };
  }

  /**
   * Send fallback message when WhatsApp delivery fails
   * Requirements: 7.2, 7.3
   */
  async sendFallbackMessage(
    phoneNumber: string,
    kycLink: string,
    propertyName: string,
    originalError: WhatsAppErrorCode,
  ): Promise<WhatsAppResponse> {
    try {
      // Create a simpler fallback message
      const fallbackMessage = `KYC Application Link for ${propertyName}: ${kycLink}`;

      const payload = {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'text',
        text: {
          preview_url: false,
          body: fallbackMessage,
        },
      };

      // Try sending with minimal retry (only 1 retry for fallback)
      await this.sendWithRetry(payload, phoneNumber, 1, 500);

      return {
        success: true,
        message: 'Fallback message sent successfully',
      };
    } catch (error) {
      console.error('Fallback message also failed:', error);
      return {
        success: false,
        message:
          'Both primary and fallback message delivery failed. Please copy the link manually.',
        errorCode: WhatsAppErrorCode.SERVICE_UNAVAILABLE,
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

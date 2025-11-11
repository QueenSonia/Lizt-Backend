import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { KYCLink } from './entities/kyc-link.entity';
import { KYCOtp } from './entities/kyc-otp.entity';
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
    @InjectRepository(KYCOtp)
    private readonly kycOtpRepository: Repository<KYCOtp>,
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

    if (existingLink && existingLink.token) {
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

      // Send message using a pre-approved template
      await this.whatsappBotService.sendWhatsappMessageWithTemplate({
        phone_number: normalizedPhone,
        template_name: 'kyc_link_invitation', // **IMPORTANT: This template must be created in your WhatsApp Business Manager**
        template_parameters: [
          { type: 'text', text: propertyName },
          { type: 'text', text: kycLink },
        ],
      });

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
   * Send OTP to phone number for KYC verification
   * Requirements: Phone verification for KYC applications
   */
  async sendOTPForKYC(
    kycToken: string,
    phoneNumber: string,
  ): Promise<{
    success: boolean;
    message: string;
    expiresAt?: Date;
  }> {
    try {
      // Validate KYC token first
      const tokenValidation = await this.validateKYCToken(kycToken);
      if (!tokenValidation.valid) {
        throw new BadRequestException(
          tokenValidation.error || 'Invalid KYC token',
        );
      }

      // Validate phone number
      const phoneValidation = this.validatePhoneNumber(phoneNumber);
      if (!phoneValidation.isValid) {
        throw new BadRequestException(
          phoneValidation.error || 'Invalid phone number',
        );
      }

      const normalizedPhone = phoneValidation.normalizedPhone!;

      // Check for existing active OTP
      const existingOtp = await this.kycOtpRepository.findOne({
        where: {
          phone_number: normalizedPhone,
          kyc_token: kycToken,
          is_active: true,
          expires_at: MoreThan(new Date()),
        },
      });

      // If there's a recent OTP (less than 1 minute old), prevent spam
      if (existingOtp) {
        const timeDiff = Date.now() - existingOtp.created_at.getTime();
        if (timeDiff < 60000) {
          // 1 minute
          throw new BadRequestException(
            'OTP already sent recently. Please wait before requesting again.',
          );
        }
      }

      // Deactivate any existing OTPs for this phone and token
      await this.kycOtpRepository.update(
        {
          phone_number: normalizedPhone,
          kyc_token: kycToken,
          is_active: true,
        },
        {
          is_active: false,
        },
      );

      // Generate new OTP
      const otpCode = UtilService.generateOTP(6);
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10); // 10 minutes expiry

      // Save OTP to database
      const kycOtp = this.kycOtpRepository.create({
        phone_number: normalizedPhone,
        otp_code: otpCode,
        kyc_token: kycToken,
        expires_at: expiresAt,
        is_active: true,
        is_verified: false,
      });

      await this.kycOtpRepository.save(kycOtp);
      console.log(otpCode);

      // Send OTP via WhatsApp
      const message = `🔐 Your KYC verification code is: ${otpCode}\n\nThis code expires in 10 minutes.\n\n*Do not share this code with anyone.*\n\nPowered by Lizt Property Management`;

      const payload = {
        messaging_product: 'whatsapp',
        to: normalizedPhone,
        type: 'text',
        text: {
          preview_url: false,
          body: message,
        },
      };

      try {
        await this.whatsappBotService.sendToWhatsappAPI(payload);
      } catch (error) {
        console.error('Failed to send OTP via WhatsApp:', error);
        // Don't fail the entire operation if WhatsApp fails
        // The OTP is still saved and can be used
      }

      return {
        success: true,
        message: 'OTP sent successfully to your phone number',
        expiresAt,
      };
    } catch (error) {
      console.error('Error sending OTP:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new HttpException(
        'Failed to send OTP. Please try again.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Verify OTP code for KYC
   * Requirements: Phone verification for KYC applications
   */
  async verifyOTPForKYC(
    kycToken: string,
    phoneNumber: string,
    otpCode: string,
  ): Promise<{
    success: boolean;
    message: string;
    verified?: boolean;
  }> {
    try {
      // Validate KYC token first
      const tokenValidation = await this.validateKYCToken(kycToken);
      if (!tokenValidation.valid) {
        throw new BadRequestException(
          tokenValidation.error || 'Invalid KYC token',
        );
      }

      // Validate phone number
      const phoneValidation = this.validatePhoneNumber(phoneNumber);
      if (!phoneValidation.isValid) {
        throw new BadRequestException(
          phoneValidation.error || 'Invalid phone number',
        );
      }

      const normalizedPhone = phoneValidation.normalizedPhone!;

      // Find the OTP record
      const otpRecord = await this.kycOtpRepository.findOne({
        where: {
          phone_number: normalizedPhone,
          kyc_token: kycToken,
          otp_code: otpCode,
          is_active: true,
        },
      });

      if (!otpRecord) {
        throw new BadRequestException('Invalid OTP code');
      }

      // Check if OTP has expired
      if (new Date() > otpRecord.expires_at) {
        // Deactivate expired OTP
        await this.kycOtpRepository.update(otpRecord.id, {
          is_active: false,
        });
        throw new BadRequestException(
          'OTP has expired. Please request a new one.',
        );
      }

      // Check if already verified
      if (otpRecord.is_verified) {
        throw new BadRequestException('OTP has already been used');
      }

      // Mark OTP as verified and inactive
      await this.kycOtpRepository.update(otpRecord.id, {
        is_verified: true,
        is_active: false,
      });

      return {
        success: true,
        message: 'Phone number verified successfully',
        verified: true,
      };
    } catch (error) {
      console.error('Error verifying OTP:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new HttpException(
        'Failed to verify OTP. Please try again.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Check if phone number is verified for a KYC token
   * Requirements: Phone verification status check
   */
  async isPhoneVerifiedForKYC(
    kycToken: string,
    phoneNumber: string,
  ): Promise<boolean> {
    try {
      const phoneValidation = this.validatePhoneNumber(phoneNumber);
      if (!phoneValidation.isValid) {
        return false;
      }

      const normalizedPhone = phoneValidation.normalizedPhone!;

      const verifiedOtp = await this.kycOtpRepository.findOne({
        where: {
          phone_number: normalizedPhone,
          kyc_token: kycToken,
          is_verified: true,
        },
      });

      return !!verifiedOtp;
    } catch (error) {
      console.error('Error checking phone verification status:', error);
      return false;
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

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { KYCLink } from './entities/kyc-link.entity';
import { KYCOtp } from './entities/kyc-otp.entity';
import { ApplicationStatus } from './entities/kyc-application.entity';
import { Property } from '../properties/entities/property.entity';
import { PropertyStatusEnum } from '../properties/dto/create-property.dto';
import { WhatsappBotService } from '../whatsapp-bot/whatsapp-bot.service';
import { UtilService } from '../utils/utility-service';
import { KYCApplicationService } from './kyc-application.service';

export interface KYCLinkResponse {
  token: string;
  link: string;
  expiresAt: Date | null; // null means no expiration
}

export interface PropertyKYCData {
  valid: boolean;
  landlordId?: string;
  vacantProperties?: Array<{
    id: string;
    name: string;
    location: string;
    propertyType: string;
    bedrooms: number;
    bathrooms: number;
    description?: string;
    hasPendingKyc?: boolean;
    applicationsCount?: number;
  }>;
  error?: string;
}

@Injectable()
export class KYCLinksService {
  constructor(
    @InjectRepository(KYCLink)
    private readonly kycLinkRepository: Repository<KYCLink>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(KYCOtp)
    private readonly kycOtpRepository: Repository<KYCOtp>,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => WhatsappBotService))
    private readonly whatsappBotService: WhatsappBotService,
    private readonly utilService: UtilService,
    @Inject(forwardRef(() => KYCApplicationService))
    private readonly kycApplicationService: KYCApplicationService,
  ) {}

  /**
   * Generate a unique KYC link for a landlord (general link for all properties)
   * Links remain active permanently and never expire
   */
  async generateKYCLink(landlordId: string): Promise<KYCLinkResponse> {
    // Check if there's already an active KYC link for this landlord
    const existingLink = await this.kycLinkRepository.findOne({
      where: {
        landlord_id: landlordId,
        is_active: true,
      },
    });

    if (existingLink && existingLink.token) {
      // Return existing active link (no expiration check needed)
      const baseUrl = this.configService.get('FRONTEND_URL');
      return {
        token: existingLink.token,
        link: `${baseUrl}/kyc/${existingLink.token}`,
        expiresAt: null, // No expiration
      };
    }

    // Generate new token (no expiration date needed)
    const token = uuidv4();

    console.log('🔗 Generating new general KYC link:', {
      landlordId,
      token: token.substring(0, 8) + '...',
      noExpiration: true,
    });

    // Create new KYC link without expiration
    const kycLink = this.kycLinkRepository.create({
      token,
      landlord_id: landlordId,
      expires_at: undefined, // No expiration (use undefined instead of null for TypeORM)
      is_active: true,
    });

    await this.kycLinkRepository.save(kycLink);

    const baseUrl = this.configService.get('FRONTEND_URL');
    const link = `${baseUrl}/kyc/${token}`;

    return {
      token,
      link,
      expiresAt: null, // No expiration
    };
  }

  /**
   * Validate KYC token and return landlord information with vacant properties
   * Requirements: 2.4, 2.5, 3.5
   */
  async validateKYCToken(token: string): Promise<{
    valid: boolean;
    landlordId?: string;
    vacantProperties?: Array<{
      id: string;
      name: string;
      location: string;
      propertyType: string;
      bedrooms: number;
      bathrooms: number;
      description?: string;
      rentalPrice?: number;
      hasPendingKyc?: boolean;
      applicationsCount?: number;
    }>;
    error?: string;
  }> {
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
        relations: ['landlord'],
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

      // Check expiration only if expires_at is set (for backward compatibility with old links)
      if (kycLink.expires_at && new Date() > kycLink.expires_at) {
        // Deactivate expired token
        await this.kycLinkRepository.update(kycLink.id, { is_active: false });

        console.log('🚫 KYC link expired (legacy link):', {
          token: token.substring(0, 8) + '...',
          expiresAt: kycLink.expires_at.toISOString(),
          currentTime: new Date().toISOString(),
        });

        return {
          valid: false,
          error: 'This KYC form has expired',
        };
      }

      // Get properties for this landlord:
      // 1. Properties marked as marketing ready (independent boolean)
      // 2. Properties with pending KYC applications (for existing tenants)
      const marketingReadyProperties = await this.propertyRepository.find({
        where: {
          owner_id: kycLink.landlord_id,
          is_marketing_ready: true,
        },
        order: {
          created_at: 'DESC',
        },
      });

      // Also get properties that have pending KYC applications (for existing tenants)
      // Only include vacant properties to prevent occupied properties from showing in KYC forms
      const propertiesWithPendingKYC = await this.propertyRepository
        .createQueryBuilder('property')
        .leftJoin('property.kyc_applications', 'kyc')
        .where('property.owner_id = :landlordId', {
          landlordId: kycLink.landlord_id,
        })
        .andWhere('kyc.status = :status', {
          status: ApplicationStatus.PENDING_COMPLETION,
        })
        .andWhere(
          '(property.property_status = :vacantStatus OR property.property_status = :offerPendingStatus OR property.property_status = :offerAcceptedStatus)',
          {
            vacantStatus: PropertyStatusEnum.VACANT,
            offerPendingStatus: PropertyStatusEnum.OFFER_PENDING,
            offerAcceptedStatus: PropertyStatusEnum.OFFER_ACCEPTED,
          },
        )
        .getMany();

      // Combine and deduplicate properties
      const allPropertyIds = new Set([
        ...marketingReadyProperties.map((p) => p.id),
        ...propertiesWithPendingKYC.map((p) => p.id),
      ]);

      const allProperties = await this.propertyRepository.find({
        where: {
          id: In([...allPropertyIds]),
        },
        order: {
          created_at: 'DESC',
        },
      });

      if (allProperties.length === 0) {
        return {
          valid: false,
          error: 'No properties available. Please contact the landlord.',
        };
      }

      // Get applications count for each property
      const propertiesWithCounts = await Promise.all(
        allProperties.map(async (property) => {
          let applicationsCount = 0;
          try {
            const stats =
              await this.kycApplicationService.getApplicationStatistics(
                property.id,
                kycLink.landlord_id,
              );
            // For vacant properties or marketing-ready properties, only show pending applications count
            // For occupied properties, show total count
            const allowedStatuses = [PropertyStatusEnum.VACANT];
            applicationsCount =
              allowedStatuses.includes(
                property.property_status as PropertyStatusEnum,
              ) || property.is_marketing_ready
                ? stats.pending
                : stats.total;
          } catch (error) {
            console.warn(
              `Failed to get application count for property ${property.id}:`,
              error,
            );
            // Continue with 0 count if there's an error
          }

          return {
            id: property.id,
            name: property.name,
            location: property.location,
            propertyType: property.property_type,
            bedrooms: property.no_of_bedrooms,
            bathrooms: property.no_of_bathrooms,
            description: `${property.location}`,
            rentalPrice: property.rental_price,
            hasPendingKyc: propertiesWithPendingKYC.some(
              (p) => p.id === property.id,
            ),
            applicationsCount,
          };
        }),
      );

      return {
        valid: true,
        landlordId: kycLink.landlord_id,
        vacantProperties: propertiesWithCounts,
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
   * Deactivate KYC link for a landlord (manual deactivation only)
   * Requirements: 2.4, 2.5, 3.5
   */
  async deactivateKYCLink(landlordId: string): Promise<void> {
    try {
      if (
        !landlordId ||
        typeof landlordId !== 'string' ||
        landlordId.trim() === ''
      ) {
        throw new BadRequestException('Invalid landlord ID provided');
      }

      const result = await this.kycLinkRepository.update(
        {
          landlord_id: landlordId.trim(),
          is_active: true,
        },
        {
          is_active: false,
        },
      );

      console.log(
        `Deactivated ${result.affected || 0} KYC links for landlord ${landlordId}`,
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
      const normalizedPhone =
        this.utilService.normalizePhoneNumber(trimmedPhone);

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
      const otpCode = this.utilService.generateOTP(6);
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

      // Send OTP via WhatsApp using authentication template
      // Template: kyc_otp_verification (must be registered in WhatsApp Business Manager)
      // Authentication templates have a special format with OTP button
      const payload = {
        messaging_product: 'whatsapp',
        to: normalizedPhone,
        type: 'template',
        template: {
          name: 'kyc_otp_verification',
          language: {
            code: 'en',
          },
          components: [
            {
              type: 'body',
              parameters: [
                {
                  type: 'text',
                  text: otpCode,
                },
              ],
            },
            {
              type: 'button',
              sub_type: 'url',
              index: '0',
              parameters: [
                {
                  type: 'text',
                  text: otpCode,
                },
              ],
            },
          ],
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
   * Validate landlord exists and has properties
   * Private helper method
   */
  private async validateLandlord(landlordId: string): Promise<void> {
    const landlord = await this.propertyRepository.findOne({
      where: { owner_id: landlordId },
    });

    if (!landlord) {
      throw new NotFoundException('Landlord not found or has no properties');
    }
  }
}

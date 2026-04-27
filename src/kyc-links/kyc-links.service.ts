import {
  Injectable,
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { JwtService } from '@nestjs/jwt';
import { KYCLink } from './entities/kyc-link.entity';
import { KYCOtp } from './entities/kyc-otp.entity';
import { ApplicationStatus } from './entities/kyc-application.entity';
import { Property } from '../properties/entities/property.entity';
import { PropertyStatusEnum } from '../properties/dto/create-property.dto';
import { WhatsappBotService } from '../whatsapp-bot/whatsapp-bot.service';
import { WhatsAppNotificationLogService } from '../whatsapp-bot/whatsapp-notification-log.service';
import {
  WhatsAppNotificationLog,
  WhatsAppNotificationStatus,
} from '../whatsapp-bot/entities/whatsapp-notification-log.entity';
import { ChatLog } from '../whatsapp-bot/entities/chat-log.entity';
import { MessageStatus } from '../whatsapp-bot/entities/message-status.enum';
import { UtilService } from '../utils/utility-service';

export interface KYCLinkResponse {
  token: string;
  link: string;
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
    @InjectRepository(WhatsAppNotificationLog)
    private readonly whatsappNotificationLogRepository: Repository<WhatsAppNotificationLog>,
    @InjectRepository(ChatLog)
    private readonly chatLogRepository: Repository<ChatLog>,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => WhatsappBotService))
    private readonly whatsappBotService: WhatsappBotService,
    @Inject(forwardRef(() => WhatsAppNotificationLogService))
    private readonly whatsappNotificationLogService: WhatsAppNotificationLogService,
    private readonly utilService: UtilService,
  ) {}

  /**
   * Generate a unique KYC link for a landlord (general link for all properties)
   * Links remain active permanently and never expire
   */
  async generateKYCLink(
    landlordId: string,
    formType?: 'property_addition',
  ): Promise<KYCLinkResponse> {
    const baseUrl = this.configService.get<string>('FRONTEND_URL');
    if (!baseUrl) {
      throw new HttpException(
        'FRONTEND_URL is not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Check if there's already an active KYC link for this landlord
    const existingLink = await this.kycLinkRepository.findOne({
      where: {
        landlord_id: landlordId,
        is_active: true,
      },
    });

    let token: string;
    if (existingLink?.token) {
      token = existingLink.token;
    } else {
      // Generate new token
      token = uuidv4();

      const kycLink = this.kycLinkRepository.create({
        token,
        landlord_id: landlordId,
        is_active: true,
      });

      await this.kycLinkRepository.save(kycLink);
    }

    // Add form type as query parameter
    const queryParam = formType ? `?type=${formType}` : '';
    const link = `${baseUrl}/kyc/${token}${queryParam}`;

    return {
      token,
      link,
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
          error: 'This KYC form is no longer active',
        };
      }

      // Check expiration only if expires_at is set (for backward compatibility with old links)
      if (kycLink.expires_at && new Date() > kycLink.expires_at) {
        // Deactivate expired token
        await this.kycLinkRepository.update(kycLink.id, { is_active: false });

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

      // Combine and deduplicate properties in memory (avoids a third DB query)
      const propertyMap = new Map<
        string,
        (typeof marketingReadyProperties)[0]
      >();
      for (const p of marketingReadyProperties) {
        propertyMap.set(p.id, p);
      }
      for (const p of propertiesWithPendingKYC) {
        if (!propertyMap.has(p.id)) {
          propertyMap.set(p.id, p);
        }
      }
      const allProperties = Array.from(propertyMap.values()).sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime(),
      );

      if (allProperties.length === 0) {
        return {
          valid: false,
          error: 'No properties available. Please contact the landlord.',
        };
      }

      const vacantProperties = allProperties.map((property) => ({
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
      }));

      return {
        valid: true,
        landlordId: kycLink.landlord_id,
        vacantProperties,
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
        error: 'Enter a valid phone number',
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
   * Send OTP to phone number for KYC verification.
   * Enqueues the WhatsApp send via WhatsAppNotificationLogService so that
   * Meta API errors and per-recipient delivery status (sent/delivered/read/failed)
   * can be surfaced to the frontend via /otp-status (correlated by kyc_otp.id).
   */
  async sendOTPForKYC(
    kycToken: string,
    phoneNumber: string,
  ): Promise<{
    success: boolean;
    message: string;
    expiresAt?: Date;
    kyc_otp_id?: string;
  }> {
    try {
      const tokenValidation = await this.validateKYCToken(kycToken);
      if (!tokenValidation.valid) {
        throw new BadRequestException(
          tokenValidation.error || 'Invalid KYC token',
        );
      }

      const phoneValidation = this.validatePhoneNumber(phoneNumber);
      if (!phoneValidation.isValid) {
        throw new BadRequestException(
          phoneValidation.error || 'Invalid phone number',
        );
      }

      const normalizedPhone = phoneValidation.normalizedPhone!;

      const recentOtp = await this.kycOtpRepository.findOne({
        where: {
          phone_number: normalizedPhone,
          kyc_token: kycToken,
        },
        order: {
          created_at: 'DESC',
        },
      });

      if (recentOtp) {
        const timeDiff = Date.now() - recentOtp.created_at.getTime();
        if (timeDiff < 60000) {
          throw new BadRequestException(
            'OTP already sent recently. Please wait before requesting again.',
          );
        }
      }

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

      const otpCode = this.utilService.generateOTP(6);
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      const kycOtp = this.kycOtpRepository.create({
        phone_number: normalizedPhone,
        otp_code: otpCode,
        kyc_token: kycToken,
        expires_at: expiresAt,
        is_active: true,
        is_verified: false,
      });

      await this.kycOtpRepository.save(kycOtp);

      // Enqueue the WhatsApp send. The queue handles retries (3x, every 5min)
      // and records the wamid + Meta API errors on the log row keyed by reference_id.
      await this.whatsappNotificationLogService.queue(
        'sendKYCOTPVerification',
        {
          phone_number: normalizedPhone,
          otp_code: otpCode,
        },
        kycOtp.id,
      );

      return {
        success: true,
        message: 'OTP queued for delivery',
        expiresAt,
        kyc_otp_id: kycOtp.id,
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
   * Read OTP delivery status by kyc_otp_id, joining queue and chat_logs.
   * Surfaces both Meta API rejection (queue's last_error) and per-recipient
   * lifecycle (chat_logs.status / error_code / error_reason from webhook).
   */
  async getOTPStatusForKYC(
    kycToken: string,
    kycOtpId: string,
  ): Promise<{
    success: boolean;
    queueStatus: 'pending' | 'sent' | 'failed' | 'cancelled';
    attempts: number;
    lastError: string | null;
    metaStatus: 'sent' | 'delivered' | 'read' | 'failed' | null;
    errorCode: string | null;
    errorReason: string | null;
  }> {
    const tokenValidation = await this.validateKYCToken(kycToken);
    if (!tokenValidation.valid) {
      throw new BadRequestException(
        tokenValidation.error || 'Invalid KYC token',
      );
    }

    const otp = await this.kycOtpRepository.findOne({
      where: { id: kycOtpId, kyc_token: kycToken },
    });
    if (!otp) {
      throw new BadRequestException('OTP not found for this KYC token');
    }

    const queueRow = await this.whatsappNotificationLogRepository.findOne({
      where: { reference_id: kycOtpId },
      order: { created_at: 'DESC' },
    });

    let metaStatus: 'sent' | 'delivered' | 'read' | 'failed' | null = null;
    let errorCode: string | null = null;
    let errorReason: string | null = null;

    if (queueRow?.whatsapp_message_id) {
      const chatLog = await this.chatLogRepository.findOne({
        where: { whatsapp_message_id: queueRow.whatsapp_message_id },
      });
      if (chatLog) {
        metaStatus = this.mapMessageStatusToWire(chatLog.status);
        errorCode = chatLog.error_code ?? null;
        errorReason = chatLog.error_reason ?? null;
      }
    }

    return {
      success: true,
      queueStatus: queueRow
        ? (queueRow.status as
            | 'pending'
            | 'sent'
            | 'failed'
            | 'cancelled')
        : 'pending',
      attempts: queueRow?.attempts ?? 0,
      lastError: queueRow?.last_error ?? null,
      metaStatus,
      errorCode,
      errorReason,
    };
  }

  private mapMessageStatusToWire(
    status: MessageStatus,
  ): 'sent' | 'delivered' | 'read' | 'failed' {
    switch (status) {
      case MessageStatus.DELIVERED:
        return 'delivered';
      case MessageStatus.READ:
        return 'read';
      case MessageStatus.FAILED:
        return 'failed';
      case MessageStatus.SENT:
      default:
        return 'sent';
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
    verificationToken?: string;
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

      // Generate short-lived KYC verification JWT
      const verificationToken = await this.jwtService.signAsync(
        {
          phone: normalizedPhone,
          kycToken: kycToken,
          type: 'kyc-verification',
        },
        {
          secret: this.configService.get<string>('JWT_SECRET'),
          expiresIn: '15m',
          issuer: 'PANDA-HOMES',
        },
      );

      return {
        success: true,
        message: 'Phone number verified successfully',
        verified: true,
        verificationToken,
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
}

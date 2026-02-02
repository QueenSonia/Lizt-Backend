import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  OfferLetter,
  OfferLetterStatus,
  PaymentStatus,
} from './entities/offer-letter.entity';
import { KYCApplication } from '../kyc-links/entities/kyc-application.entity';
import { Property } from '../properties/entities/property.entity';
import { Users } from '../users/entities/user.entity';
import { PropertyStatusEnum } from '../properties/dto/create-property.dto';
import { CreateOfferLetterDto } from './dto/create-offer-letter.dto';
import {
  OfferLetterResponse,
  AcceptanceInitiationResponse,
  toOfferLetterResponse,
} from './dto/offer-letter-response.dto';
import { TemplateSenderService } from '../whatsapp-bot/template-sender';
import { OTPService } from './otp.service';
import { EventsGateway } from '../events/events.gateway';
import { PDFGeneratorService } from './pdf-generator.service';

/**
 * OfferLetterService
 * Handles all offer letter business logic
 * Requirements: 10.1-10.9
 */
@Injectable()
export class OfferLettersService {
  private readonly logger = new Logger(OfferLettersService.name);

  constructor(
    @InjectRepository(OfferLetter)
    private readonly offerLetterRepository: Repository<OfferLetter>,
    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepository: Repository<KYCApplication>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @Inject(forwardRef(() => TemplateSenderService))
    private readonly templateSenderService: TemplateSenderService,
    @Inject(forwardRef(() => OTPService))
    private readonly otpService: OTPService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
    @Inject(forwardRef(() => PDFGeneratorService))
    private readonly pdfGeneratorService: PDFGeneratorService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Create a new offer letter
   * Requirements: 5.1, 5.3, 5.5, 6.1, 7.1, 7.2, 10.1, 10.8, 10.9
   */
  async create(
    dto: CreateOfferLetterDto,
    landlordId: string,
  ): Promise<OfferLetterResponse> {
    // Validate KYC application exists
    const kycApplication = await this.kycApplicationRepository.findOne({
      where: { id: dto.kycApplicationId },
      relations: ['kyc_link'],
    });

    if (!kycApplication) {
      throw new NotFoundException('KYC application not found');
    }

    // Validate KYC application belongs to landlord
    if (kycApplication.kyc_link?.landlord_id !== landlordId) {
      throw new ForbiddenException(
        'Not authorized to create offer for this KYC application',
      );
    }

    // Validate property exists and belongs to landlord
    const property = await this.propertyRepository.findOne({
      where: { id: dto.propertyId },
    });

    if (!property) {
      throw new NotFoundException('Property not found');
    }

    if (property.owner_id !== landlordId) {
      throw new ForbiddenException(
        'Not authorized to create offer for this property',
      );
    }

    // Validate property is available (not occupied)
    // Requirements: 2.1 - Allow multiple offers when property is NOT occupied
    if (property.property_status === PropertyStatusEnum.OCCUPIED) {
      throw new ConflictException('Property is already occupied');
    }

    // Calculate total amount from all fees
    // Requirements: 1.6
    const totalAmount =
      dto.rentAmount +
      (dto.serviceCharge || 0) +
      (dto.cautionDeposit || 0) +
      (dto.legalFee || 0) +
      (dto.agencyFee || 0);

    // Generate unique token using UUID
    // Requirements: 5.3
    const token = uuidv4();

    // Load landlord account and user to get branding data for snapshot
    const landlordAccount = await this.propertyRepository.manager
      .getRepository('Account')
      .findOne({ where: { id: landlordId }, relations: ['user'] });

    const landlord = landlordAccount?.user;

    // Snapshot branding data at time of offer letter creation
    const brandingSnapshot = landlord?.branding
      ? {
          businessName: landlord.branding.businessName || '',
          businessAddress: landlord.branding.businessAddress || '',
          contactInfo: landlord.branding.contactInfo || '',
          footerColor: landlord.branding.footerColor || '#6B6B6B',
          letterhead: landlord.branding.letterhead,
          signature: landlord.branding.signature,
          headingFont: landlord.branding.headingFont || 'Inter',
          bodyFont: landlord.branding.bodyFont || 'Inter',
        }
      : undefined;

    // Create offer letter entity with pending status and payment fields
    // Requirements: 5.1, 5.5, 2.1
    const offerLetter = this.offerLetterRepository.create({
      kyc_application_id: dto.kycApplicationId,
      property_id: dto.propertyId,
      landlord_id: landlordId,
      rent_amount: dto.rentAmount,
      rent_frequency: dto.rentFrequency,
      service_charge: dto.serviceCharge,
      tenancy_start_date: new Date(dto.tenancyStartDate),
      tenancy_end_date: new Date(dto.tenancyEndDate),
      caution_deposit: dto.cautionDeposit,
      legal_fee: dto.legalFee,
      agency_fee: dto.agencyFee,
      status: OfferLetterStatus.PENDING,
      token,
      terms_of_tenancy: dto.termsOfTenancy,
      branding: brandingSnapshot,
      content_snapshot: dto.contentSnapshot,
      // Payment fields - Requirements: 2.1
      total_amount: totalAmount,
      amount_paid: 0,
      outstanding_balance: totalAmount,
      payment_status: PaymentStatus.UNPAID,
    });

    // Save offer letter
    const savedOfferLetter = await this.offerLetterRepository.save(offerLetter);

    // Generate PDF in background (fire and forget)
    // This ensures PDF is ready when user tries to download
    this.pdfGeneratorService
      .generatePDFInBackground(savedOfferLetter.token)
      .catch((err) => {
        this.logger.error(
          `Background PDF generation failed for token ${savedOfferLetter.token.substring(0, 8)}: ${err.message}`,
        );
      });

    // DO NOT update property status to offer_pending
    // Requirements: 2.4 - Property status only changes to 'occupied' when first full payment completes

    // Send WhatsApp notification to tenant only if requested
    // Requirements: 7.1, 7.2
    if (dto.sendNotification) {
      await this.sendOfferLetterNotification(
        kycApplication,
        property,
        savedOfferLetter.token,
      );

      // Emit WebSocket event for real-time notification only when sent
      const applicantName = `${kycApplication.first_name} ${kycApplication.last_name}`;
      this.eventsGateway.emitOfferLetterSent(landlordId, {
        propertyId: property.id,
        propertyName: property.name,
        applicantName,
        token: savedOfferLetter.token,
      });
    }

    return toOfferLetterResponse(
      savedOfferLetter,
      kycApplication,
      property,
      landlord ?? undefined,
    );
  }

  /**
   * Send WhatsApp notification to tenant with offer letter link
   * Requirements: 7.1, 7.2
   */
  private async sendOfferLetterNotification(
    kycApplication: KYCApplication,
    property: Property,
    token: string,
  ): Promise<void> {
    try {
      const applicantName = `${kycApplication.first_name} ${kycApplication.last_name}`;
      const phoneNumber = kycApplication.phone_number;
      const frontendUrl =
        this.configService.get<string>('FRONTEND_URL') || 'https://app.lizt.io';

      // Send WhatsApp template message with offer letter link
      // Requirements: 7.1, 7.2
      await this.templateSenderService.sendOfferLetterNotification({
        phone_number: phoneNumber,
        tenant_name: applicantName,
        property_name: property.name,
        offer_letter_token: token,
        frontend_url: frontendUrl,
      });

      this.logger.log(
        `Offer letter notification sent to ${phoneNumber} for token ${token}`,
      );
    } catch (error) {
      // Log error but don't fail the offer letter creation
      // The offer letter is still created, landlord can follow up manually
      this.logger.error(
        `Failed to send WhatsApp notification: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Send offer letter notification via WhatsApp
   * Requirements: 7.1, 7.2
   */
  async sendOfferLetterById(
    offerId: string,
    landlordId: string,
  ): Promise<void> {
    // Find offer letter
    const offerLetter = await this.offerLetterRepository.findOne({
      where: { id: offerId },
    });

    if (!offerLetter) {
      throw new NotFoundException('Offer letter not found');
    }

    // Verify landlord owns this offer letter
    if (offerLetter.landlord_id !== landlordId) {
      throw new ForbiddenException('Not authorized to send this offer letter');
    }

    // Load related entities
    const kycApplication = await this.kycApplicationRepository.findOne({
      where: { id: offerLetter.kyc_application_id },
    });

    const property = await this.propertyRepository.findOne({
      where: { id: offerLetter.property_id },
    });

    if (!kycApplication || !property) {
      throw new NotFoundException('Related data not found');
    }

    // Send WhatsApp notification
    await this.sendOfferLetterNotification(
      kycApplication,
      property,
      offerLetter.token,
    );

    // Emit WebSocket event for real-time notification
    const applicantName = `${kycApplication.first_name} ${kycApplication.last_name}`;
    this.eventsGateway.emitOfferLetterSent(landlordId, {
      propertyId: property.id,
      propertyName: property.name,
      applicantName,
      token: offerLetter.token,
    });
  }

  /**
   * Find offer letter by token (public endpoint)
   * Requirements: 10.2
   */
  async findByToken(token: string): Promise<OfferLetterResponse> {
    const offerLetter = await this.offerLetterRepository.findOne({
      where: { token },
    });

    if (!offerLetter) {
      throw new NotFoundException('Offer letter not found');
    }

    // Load related entities
    const kycApplication = await this.kycApplicationRepository.findOne({
      where: { id: offerLetter.kyc_application_id },
    });

    const property = await this.propertyRepository.findOne({
      where: { id: offerLetter.property_id },
    });

    // Load landlord account and user to get branding data
    const landlordAccount = await this.propertyRepository.manager
      .getRepository('Account')
      .findOne({
        where: { id: offerLetter.landlord_id },
        relations: ['user'],
      });

    const landlord = landlordAccount?.user;

    if (!kycApplication || !property) {
      throw new NotFoundException('Offer letter data incomplete');
    }

    return toOfferLetterResponse(
      offerLetter,
      kycApplication,
      property,
      landlord ?? undefined,
    );
  }

  /**
   * Initiate acceptance process (sends OTP)
   * Requirements: 9.1, 10.5
   */
  async initiateAcceptance(
    token: string,
  ): Promise<AcceptanceInitiationResponse> {
    const offerLetter = await this.offerLetterRepository.findOne({
      where: { token },
    });

    if (!offerLetter) {
      throw new NotFoundException('Offer letter not found');
    }

    if (offerLetter.status !== OfferLetterStatus.PENDING) {
      throw new ConflictException('Offer letter has already been processed');
    }

    // Get applicant phone number and name
    const kycApplication = await this.kycApplicationRepository.findOne({
      where: { id: offerLetter.kyc_application_id },
    });

    if (!kycApplication) {
      throw new NotFoundException('KYC application not found');
    }

    const phoneNumber = kycApplication.phone_number;
    const phoneLastFour = phoneNumber.slice(-4);

    // Generate, store, and send OTP via WhatsApp
    // Requirements: 9.1
    await this.otpService.initiateOTPVerification(token, phoneNumber);

    return {
      message: 'OTP sent to your phone number',
      phoneLastFour,
    };
  }

  /**
   * Verify OTP and accept offer letter
   * Requirements: 9.3, 9.4, 10.6
   */
  async verifyOTPAndAccept(
    token: string,
    otp: string,
  ): Promise<OfferLetterResponse> {
    const offerLetter = await this.offerLetterRepository.findOne({
      where: { token },
    });

    if (!offerLetter) {
      throw new NotFoundException('Offer letter not found');
    }

    if (offerLetter.status !== OfferLetterStatus.PENDING) {
      throw new ConflictException('Offer letter has already been processed');
    }

    // Verify OTP using OTPService
    // Requirements: 9.3
    await this.otpService.verifyOTP(token, otp);

    // Update status to accepted
    await this.offerLetterRepository.update(offerLetter.id, {
      status: OfferLetterStatus.ACCEPTED,
    });

    // Update property status to offer_accepted
    await this.propertyRepository.update(offerLetter.property_id, {
      property_status: PropertyStatusEnum.OFFER_ACCEPTED,
    });

    // Reload offer letter with updated status
    const updatedOfferLetter = await this.offerLetterRepository.findOne({
      where: { id: offerLetter.id },
    });

    // Load related entities
    const kycApplication = await this.kycApplicationRepository.findOne({
      where: { id: offerLetter.kyc_application_id },
    });

    const property = await this.propertyRepository.findOne({
      where: { id: offerLetter.property_id },
    });

    // Load landlord account and user to get branding data
    const landlordAccount = await this.propertyRepository.manager
      .getRepository('Account')
      .findOne({
        where: { id: offerLetter.landlord_id },
        relations: ['user'],
      });

    const landlord = landlordAccount?.user;

    if (!updatedOfferLetter || !kycApplication || !property) {
      throw new NotFoundException('Offer letter data incomplete');
    }

    // Send notification to landlord
    // Requirements: 9.4
    await this.notifyLandlordOfStatusChange(
      offerLetter,
      kycApplication,
      property,
      'accepted',
    );

    // Emit WebSocket event for real-time notification
    const applicantName = `${kycApplication.first_name} ${kycApplication.last_name}`;
    this.eventsGateway.emitOfferLetterAccepted(offerLetter.landlord_id, {
      propertyId: property.id,
      propertyName: property.name,
      applicantName,
      token: offerLetter.token,
    });

    return toOfferLetterResponse(
      updatedOfferLetter,
      kycApplication,
      property,
      landlord ?? undefined,
    );
  }

  /**
   * Notify landlord when offer letter status changes (accepted or rejected)
   * Requirements: 9.4, 9.8
   */
  private async notifyLandlordOfStatusChange(
    offerLetter: OfferLetter,
    kycApplication: KYCApplication,
    property: Property,
    status: 'accepted' | 'rejected',
  ): Promise<void> {
    try {
      // Get landlord details
      const landlord = await this.propertyRepository.manager
        .getRepository('Account')
        .findOne({ where: { id: offerLetter.landlord_id } });

      if (!landlord || !landlord.phone_number) {
        this.logger.warn(
          `Could not notify landlord ${offerLetter.landlord_id} - no phone number`,
        );
        return;
      }

      const tenantName = `${kycApplication.first_name} ${kycApplication.last_name}`;
      const landlordName =
        `${landlord.first_name || ''} ${landlord.last_name || ''}`.trim() ||
        'Landlord';

      await this.templateSenderService.sendOfferLetterStatusNotification({
        phone_number: landlord.phone_number,
        landlord_name: landlordName,
        tenant_name: tenantName,
        property_name: property.name,
        property_id: property.id,
        status,
      });

      this.logger.log(
        `Landlord notified of offer ${status} for token ${offerLetter.token.substring(0, 8)}...`,
      );
    } catch (error) {
      // Log error but don't fail the operation
      this.logger.error(
        `Failed to notify landlord of ${status}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Reject offer letter
   * Requirements: 9.6, 9.7, 9.8, 10.7
   */
  async reject(token: string): Promise<OfferLetterResponse> {
    const offerLetter = await this.offerLetterRepository.findOne({
      where: { token },
    });

    if (!offerLetter) {
      throw new NotFoundException('Offer letter not found');
    }

    if (offerLetter.status !== OfferLetterStatus.PENDING) {
      throw new ConflictException('Offer letter has already been processed');
    }

    // Update offer letter status to rejected
    await this.offerLetterRepository.update(offerLetter.id, {
      status: OfferLetterStatus.REJECTED,
    });

    // Revert property status to vacant
    await this.propertyRepository.update(offerLetter.property_id, {
      property_status: PropertyStatusEnum.VACANT,
    });

    // Reload offer letter with updated status
    const updatedOfferLetter = await this.offerLetterRepository.findOne({
      where: { id: offerLetter.id },
    });

    // Load related entities
    const kycApplication = await this.kycApplicationRepository.findOne({
      where: { id: offerLetter.kyc_application_id },
    });

    const property = await this.propertyRepository.findOne({
      where: { id: offerLetter.property_id },
    });

    // Load landlord account and user to get branding data
    const landlordAccount = await this.propertyRepository.manager
      .getRepository('Account')
      .findOne({
        where: { id: offerLetter.landlord_id },
        relations: ['user'],
      });

    const landlord = landlordAccount?.user;

    if (!updatedOfferLetter || !kycApplication || !property) {
      throw new NotFoundException('Offer letter data incomplete');
    }

    // Send notification to landlord
    // Requirements: 9.8
    await this.notifyLandlordOfStatusChange(
      offerLetter,
      kycApplication,
      property,
      'rejected',
    );

    // Emit WebSocket event for real-time notification
    const applicantName = `${kycApplication.first_name} ${kycApplication.last_name}`;
    this.eventsGateway.emitOfferLetterRejected(offerLetter.landlord_id, {
      propertyId: property.id,
      propertyName: property.name,
      applicantName,
      token: offerLetter.token,
    });

    return toOfferLetterResponse(
      updatedOfferLetter,
      kycApplication,
      property,
      landlord ?? undefined,
    );
  }

  /**
   * Get offer letter entity by token (internal use)
   */
  async getOfferLetterByToken(token: string): Promise<OfferLetter | null> {
    return this.offerLetterRepository.findOne({
      where: { token },
    });
  }
}

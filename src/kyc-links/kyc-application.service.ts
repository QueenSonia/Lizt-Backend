import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  KYCApplication,
  ApplicationStatus,
} from './entities/kyc-application.entity';
import { KYCLink } from './entities/kyc-link.entity';
import { KYCOtp } from './entities/kyc-otp.entity';
import { Property } from '../properties/entities/property.entity';
import { PropertyTenant } from '../properties/entities/property-tenants.entity';
import { TenantStatusEnum } from '../properties/dto/create-property.dto';
import { BaseKYCApplicationFieldsDto } from './dto/base-kyc-application-fields.dto';
import { CreateKYCApplicationDto } from './dto/create-kyc-application.dto';
import { CompleteKYCDto } from './dto/complete-kyc.dto';
import { EventsGateway } from '../events/events.gateway';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/enums/notification-type';
import { WhatsappBotService } from '../whatsapp-bot/whatsapp-bot.service';
import { WhatsAppNotificationLogService } from '../whatsapp-bot/whatsapp-notification-log.service';
import { UtilService } from '../utils/utility-service';
import { ConfigService } from '@nestjs/config';
import { TenantKyc } from '../tenant-kyc/entities/tenant-kyc.entity';

@Injectable()
export class KYCApplicationService {
  constructor(
    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepository: Repository<KYCApplication>,
    @InjectRepository(KYCLink)
    private readonly kycLinkRepository: Repository<KYCLink>,
    @InjectRepository(KYCOtp)
    private readonly kycOtpRepository: Repository<KYCOtp>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
    @InjectRepository(TenantKyc)
    private readonly tenantKycRepository: Repository<TenantKyc>,
    private readonly utilService: UtilService,
    private readonly configService: ConfigService,
    @Optional()
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway?: EventsGateway,
    @Optional()
    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService?: NotificationService,
    @Optional()
    @Inject(forwardRef(() => WhatsappBotService))
    private readonly whatsappBotService?: WhatsappBotService,
    @Optional()
    @Inject(forwardRef(() => WhatsAppNotificationLogService))
    private readonly whatsappNotificationLog?: WhatsAppNotificationLogService,
  ) {}

  /**
   * Submit KYC application for a property using a valid token
   * Requirements: 3.1, 3.2, 3.4
   */
  async submitKYCApplication(
    token: string,
    kycData: CreateKYCApplicationDto,
  ): Promise<KYCApplication> {
    // Validate the KYC token and get the associated link
    const kycLink = await this.validateKYCToken(token);

    // SECURITY: Verify that the phone number was actually verified via OTP
    const verifiedOtp = await this.kycOtpRepository.findOne({
      where: {
        phone_number: kycData.phone_number,
        kyc_token: token,
        is_verified: true,
      },
      order: {
        created_at: 'DESC',
      },
    });

    if (!verifiedOtp) {
      throw new BadRequestException(
        'Phone number must be verified before submitting KYC application. Please request and verify an OTP code.',
      );
    }

    // Validate the selected property belongs to the landlord and is vacant
    const selectedProperty = await this.propertyRepository.findOne({
      where: {
        id: kycData.property_id,
        owner_id: kycLink.landlord_id,
      },
    });

    if (!selectedProperty) {
      throw new BadRequestException(
        'Selected property not found or does not belong to this landlord',
      );
    }

    const availableStatuses = ['vacant', 'offer_pending', 'offer_accepted'];
    if (!availableStatuses.includes(selectedProperty.property_status)) {
      throw new BadRequestException(
        'Selected property is no longer available for applications',
      );
    }

    // Check if property is ready for marketing
    if (!selectedProperty.is_marketing_ready) {
      throw new BadRequestException(
        'Selected property is not ready for marketing. Please contact the landlord.',
      );
    }

    // Check if user has already submitted an application for this specific property using phone number
    const existingApplication = await this.kycApplicationRepository.findOne({
      where: {
        property_id: kycData.property_id,
        phone_number: kycData.phone_number,
      },
    });

    // Track whether we need to delete the old application before saving the new one
    let applicationToDelete: string | null = null;

    if (existingApplication) {
      // If there's an existing application, check if the user currently has an active tenancy
      // If they don't have an active tenancy (tenancy was ended), allow them to reapply
      if (existingApplication.tenant_id) {
        // Check if the tenant is currently active for this property
        const activePropertyTenant =
          await this.propertyTenantRepository.findOne({
            where: {
              property_id: kycData.property_id,
              tenant_id: existingApplication.tenant_id,
              status: TenantStatusEnum.ACTIVE,
            },
          });

        // If tenant is still active, prevent reapplication
        if (activePropertyTenant) {
          throw new ConflictException(
            `User with phone number ${kycData.phone_number} already has an active tenancy for this property`,
          );
        }

        // If tenant is not active (tenancy ended), mark old application for deletion
        applicationToDelete = existingApplication.id;
      } else {
        // If existing application has no tenant_id, check its status
        if (existingApplication.status === ApplicationStatus.PENDING) {
          throw new ConflictException(
            `User with phone number ${kycData.phone_number} has a pending application for this property`,
          );
        }

        if (
          existingApplication.status === ApplicationStatus.PENDING_COMPLETION
        ) {
          throw new ConflictException(
            `User with phone number ${kycData.phone_number} has an incomplete application for this property. Please complete the existing application instead.`,
          );
        }

        if (existingApplication.status === ApplicationStatus.APPROVED) {
          throw new ConflictException(
            `User with phone number ${kycData.phone_number} already has an approved application for this property`,
          );
        }

        // If it's rejected, mark old application for deletion
        if (existingApplication.status === ApplicationStatus.REJECTED) {
          applicationToDelete = existingApplication.id;
        }
      }
    }

    // Create new KYC application with automatic pending status
    const applicationData: Partial<KYCApplication> = {
      ...this.mapCommonFieldsToEntity(kycData),
      kyc_link_id: kycLink.id,
      property_id: kycData.property_id,
      initial_property_id: kycData.property_id,
      status: ApplicationStatus.PENDING,
      first_name: kycData.first_name,
      last_name: kycData.last_name,
      // Tracking fields: form_opened_at captured client-side, decision timestamps set at submission
      decision_made_at: new Date(),
      decision_made_ip: kycData.decision_made_ip,
      user_agent: kycData.user_agent,
    };

    // Set form_opened_at from client-side capture (stored in sessionStorage)
    if (kycData.form_opened_at) {
      applicationData.form_opened_at = new Date(kycData.form_opened_at);
    }
    if (kycData.form_opened_ip) {
      applicationData.form_opened_ip = kycData.form_opened_ip;
    }

    const kycApplication =
      this.kycApplicationRepository.create(applicationData);

    // Use a transaction to atomically delete the old application (if any) and save the new one.
    // This prevents a limbo state where the old application is deleted but the new one fails to save.
    let savedApplication: KYCApplication;
    try {
      savedApplication =
        await this.kycApplicationRepository.manager.transaction(
          async (manager) => {
            if (applicationToDelete) {
              await manager.delete(KYCApplication, applicationToDelete);
            }
            return await manager.save(KYCApplication, kycApplication);
          },
        );
    } catch (error: any) {
      // Catch unique constraint violation (PostgreSQL error 23505) from the
      // partial unique index on (phone_number, property_id). This is the
      // database-level safety net for the race condition where two concurrent
      // requests both pass the findOne duplicate check above.
      if (error?.code === '23505') {
        throw new ConflictException(
          `A KYC application for this phone number and property is already being processed`,
        );
      }
      throw error;
    }

    // Return the application with relations loaded
    const applicationWithRelations =
      await this.kycApplicationRepository.findOne({
        where: { id: savedApplication.id },
        relations: ['property', 'kyc_link'],
      });

    if (!applicationWithRelations) {
      throw new Error('Failed to retrieve saved KYC application');
    }

    // Create property history events for tracking timeline
    try {
      const { PropertyHistory } = await import(
        '../property-history/entities/property-history.entity'
      );
      const propertyHistoryRepo =
        this.kycApplicationRepository.manager.getRepository(PropertyHistory);

      const historyEvents: Array<Partial<InstanceType<typeof PropertyHistory>>> = [];

      // If form_opened_at was captured, create a "form viewed" event
      if (applicationWithRelations.form_opened_at) {
        const openedDate = new Date(applicationWithRelations.form_opened_at);
        const ipInfo = applicationWithRelations.form_opened_ip
          ? ` from IP ${applicationWithRelations.form_opened_ip}`
          : '';
        const deviceInfo = applicationWithRelations.user_agent
          ? ` — ${applicationWithRelations.user_agent}`
          : '';
        historyEvents.push(
          propertyHistoryRepo.create({
            property_id: kycData.property_id,
            event_type: 'kyc_form_viewed',
            event_description: `KYC form opened by ${kycData.first_name} ${kycData.last_name} on ${openedDate.toLocaleDateString('en-GB')} at ${openedDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}${ipInfo}${deviceInfo}`,
            related_entity_id: savedApplication.id,
            related_entity_type: 'kyc_application',
            created_at: openedDate,
          }),
        );
      }

      // Create "application submitted" event
      historyEvents.push(
        propertyHistoryRepo.create({
          property_id: kycData.property_id,
          event_type: 'kyc_application_submitted',
          event_description: `${kycData.first_name} ${kycData.last_name} submitted a KYC application for ${applicationWithRelations.property?.name || 'property'}`,
          related_entity_id: savedApplication.id,
          related_entity_type: 'kyc_application',
        }),
      );

      await propertyHistoryRepo.save(historyEvents);
    } catch (error) {
      console.error('Failed to create property history events:', error);
    }

    // Create notification for KYC submission
    try {
      if (this.notificationService && applicationWithRelations.property) {
        await this.notificationService.create({
          date: new Date().toISOString(),
          type: NotificationType.KYC_SUBMITTED,
          description: `${kycData.first_name} ${kycData.last_name} submitted a KYC application for ${applicationWithRelations.property.name}`,
          status: 'Pending',
          property_id: kycData.property_id,
          user_id: applicationWithRelations.property.owner_id,
        });
      }
    } catch (error) {
      // Log error but don't fail the request if notification creation fails
      console.error('Failed to create KYC submission notification:', error);
    }

    // Emit WebSocket event to notify landlord of new KYC submission
    try {
      if (this.eventsGateway && applicationWithRelations.property) {
        this.eventsGateway.emitKYCSubmission(
          kycData.property_id,
          applicationWithRelations.property.owner_id,
          {
            id: savedApplication.id,
            firstName: kycData.first_name,
            lastName: kycData.last_name,
            email: kycData.email,
            phoneNumber: kycData.phone_number,
          },
        );
      }
    } catch (error) {
      // Log error but don't fail the request if WebSocket emission fails
      console.error('Failed to emit KYC submission event:', error);
    }

    // Queue WhatsApp notifications (logged to DB, sent async with retries)
    if (this.whatsappNotificationLog && applicationWithRelations.property) {
      const property = applicationWithRelations.property;

      // Notification to landlord — need to look up landlord phone first
      try {
        const landlord = await this.propertyRepository
          .createQueryBuilder('property')
          .leftJoinAndSelect('property.owner', 'owner')
          .leftJoinAndSelect('owner.user', 'user')
          .where('property.id = :propertyId', { propertyId: property.id })
          .getOne();

        if (landlord?.owner?.user?.phone_number) {
          const landlordPhone = this.utilService.normalizePhoneNumber(
            landlord.owner.user.phone_number,
          );
          const landlordName =
            landlord.owner.profile_name ||
            `${landlord.owner.user.first_name} ${landlord.owner.user.last_name}`;
          const frontendUrl =
            this.configService.get('FRONTEND_URL') || 'https://www.lizt.co';

          await this.whatsappNotificationLog.queue(
            'sendKYCApplicationNotification',
            {
              phone_number: landlordPhone,
              landlord_name: landlordName,
              tenant_name: `${kycData.first_name} ${kycData.last_name}`,
              property_name: property.name,
              application_id: savedApplication.id,
              frontend_url: frontendUrl,
            },
            savedApplication.id,
          );
        }
      } catch (error) {
        console.error('Failed to queue landlord KYC notification:', error);
      }

      // Confirmation to tenant
      if (kycData.phone_number) {
        await this.whatsappNotificationLog.queue(
          'sendKYCSubmissionConfirmation',
          {
            phone_number: this.utilService.normalizePhoneNumber(
              kycData.phone_number,
            ),
            tenant_name: `${kycData.first_name} ${kycData.last_name}`,
          },
          savedApplication.id,
        );
      }

      // Notification to referral agent (if provided)
      if (
        kycData.referral_agent_phone_number &&
        kycData.referral_agent_full_name
      ) {
        await this.whatsappNotificationLog.queue(
          'sendAgentKYCNotification',
          {
            phone_number: this.utilService.normalizePhoneNumber(
              kycData.referral_agent_phone_number,
            ),
            agent_name: kycData.referral_agent_full_name,
            tenant_name: `${kycData.first_name} ${kycData.last_name}`,
            property_name: property.name,
          },
          savedApplication.id,
        );
      }
    }

    return applicationWithRelations;
  }

  /**
   * Get all KYC applications for a specific property (landlord access only)
   * Requirements: 4.1, 4.2, 4.3
   * When property is vacant, only show pending applications
   */
  async getApplicationsByProperty(
    propertyId: string,
    landlordId: string,
  ): Promise<any[]> {
    // Validate property ownership and get property details
    const property = await this.validatePropertyOwnership(
      propertyId,
      landlordId,
    );

    // Determine which applications to show based on property status
    const whereCondition: any = { property_id: propertyId };

    // If property is vacant, only show pending applications
    if (property.property_status === 'vacant') {
      whereCondition.status = ApplicationStatus.PENDING;
    }

    // Get applications for the property with sorting
    const applications = await this.kycApplicationRepository.find({
      where: whereCondition,
      relations: ['property', 'kyc_link', 'tenant', 'offer_letters'],
      order: {
        created_at: 'DESC', // Most recent applications first
        status: 'ASC', // Pending applications first within same date
      },
    });

    return applications.map((app) => this.transformApplicationForFrontend(app));
  }

  /**
   * Get applications by property with filtering and sorting options
   * Requirements: 4.1, 4.2, 4.3
   * When property is vacant, only show pending applications
   */
  async getApplicationsByPropertyWithFilters(
    propertyId: string,
    landlordId: string,
    filters?: {
      status?: ApplicationStatus;
      sortBy?: 'created_at' | 'first_name' | 'status';
      sortOrder?: 'ASC' | 'DESC';
    },
  ): Promise<any[]> {
    // Validate property ownership and get property details
    const property = await this.validatePropertyOwnership(
      propertyId,
      landlordId,
    );

    const queryBuilder = this.kycApplicationRepository
      .createQueryBuilder('application')
      .leftJoinAndSelect('application.property', 'property')
      .leftJoinAndSelect('application.kyc_link', 'kyc_link')
      .leftJoinAndSelect('application.tenant', 'tenant')
      .leftJoinAndSelect('application.offer_letters', 'offer_letters')
      .where('application.property_id = :propertyId', { propertyId });

    // If property is vacant, only show pending applications (override any status filter)
    if (property.property_status === 'vacant') {
      queryBuilder.andWhere('application.status = :pendingStatus', {
        pendingStatus: ApplicationStatus.PENDING,
      });
    } else if (filters?.status) {
      // Apply status filter only if property is not vacant
      queryBuilder.andWhere('application.status = :status', {
        status: filters.status,
      });
    }

    // Apply sorting
    const sortBy = filters?.sortBy || 'created_at';
    const sortOrder = filters?.sortOrder || 'DESC';
    queryBuilder.orderBy(`application.${sortBy}`, sortOrder);

    // Add secondary sort by created_at if not already sorting by it
    if (sortBy !== 'created_at') {
      queryBuilder.addOrderBy('application.created_at', 'DESC');
    }

    const applications = await queryBuilder.getMany();
    return applications.map((app) => this.transformApplicationForFrontend(app));
  }

  /**
   * Transform KYC application entity to frontend-compatible format
   * Converts snake_case to camelCase and structures references properly
   */
  /**
   * Maps common tenant-submitted fields from a DTO to a partial KYCApplication entity.
   * Used by both submitKYCApplication and completePendingKYC to avoid duplication.
   */
  private mapCommonFieldsToEntity(
    dto: BaseKYCApplicationFieldsDto,
  ): Partial<KYCApplication> {
    const data: Partial<KYCApplication> = {
      // Required fields
      phone_number: dto.phone_number,
      email: dto.email,
      contact_address: dto.contact_address,
      date_of_birth: new Date(dto.date_of_birth),
      gender: dto.gender,
      nationality: dto.nationality,
      state_of_origin: dto.state_of_origin,
      marital_status: dto.marital_status,
      employment_status: dto.employment_status,
      religion: dto.religion,
      // Next of Kin
      next_of_kin_full_name: dto.next_of_kin_full_name,
      next_of_kin_address: dto.next_of_kin_address,
      next_of_kin_relationship: dto.next_of_kin_relationship,
      next_of_kin_phone_number: dto.next_of_kin_phone_number,
      next_of_kin_email: dto.next_of_kin_email,
      // Tenancy Info
      intended_use_of_property: dto.intended_use_of_property,
      number_of_occupants: dto.number_of_occupants,
      proposed_rent_amount: dto.proposed_rent_amount,
      rent_payment_frequency: dto.rent_payment_frequency,
      // Documents
      passport_photo_url: dto.passport_photo_url,
      id_document_url: dto.id_document_url,
    };

    // Employment-conditional fields
    if (dto.occupation !== undefined) data.occupation = dto.occupation;
    if (dto.job_title !== undefined) data.job_title = dto.job_title;
    if (dto.employer_name !== undefined) data.employer_name = dto.employer_name;
    if (dto.work_address !== undefined) data.work_address = dto.work_address;
    if (dto.monthly_net_income !== undefined)
      data.monthly_net_income = dto.monthly_net_income;
    if (dto.work_phone_number !== undefined)
      data.work_phone_number = dto.work_phone_number;
    if (dto.length_of_employment !== undefined)
      data.length_of_employment = dto.length_of_employment;

    // Self-employed fields
    if (dto.nature_of_business !== undefined)
      data.nature_of_business = dto.nature_of_business;
    if (dto.business_name !== undefined) data.business_name = dto.business_name;
    if (dto.business_address !== undefined)
      data.business_address = dto.business_address;
    if (dto.business_duration !== undefined)
      data.business_duration = dto.business_duration;

    // Optional fields
    if (dto.referral_agent_full_name !== undefined)
      data.referral_agent_full_name = dto.referral_agent_full_name;
    if (dto.referral_agent_phone_number !== undefined)
      data.referral_agent_phone_number = dto.referral_agent_phone_number;
    if (dto.parking_needs !== undefined) data.parking_needs = dto.parking_needs;
    if (dto.additional_notes !== undefined)
      data.additional_notes = dto.additional_notes;
    if (dto.employment_proof_url !== undefined)
      data.employment_proof_url = dto.employment_proof_url;
    if (dto.business_proof_url !== undefined)
      data.business_proof_url = dto.business_proof_url;

    return data;
  }

  /**
   * Transform KYC application entity to frontend-compatible format
   * No complex mapping needed anymore, just formatting
   */
  private transformApplicationForFrontend(application: KYCApplication): any {
    return {
      id: application.id,
      tenantId: application.tenant_id,
      propertyId: application.property_id,
      status: application.status,
      firstName: application.first_name,
      lastName: application.last_name,
      email: application.email,
      contactAddress: application.contact_address,
      phoneNumber: application.phone_number,
      dateOfBirth: application.date_of_birth
        ? application.date_of_birth instanceof Date
          ? application.date_of_birth.toISOString().split('T')[0]
          : new Date(application.date_of_birth).toISOString().split('T')[0]
        : null, // Format as YYYY-MM-DD
      gender: application.gender,
      nationality: application.nationality,
      stateOfOrigin: application.state_of_origin,
      maritalStatus: application.marital_status,
      religion: application.religion,

      // Employment Info
      employmentStatus: application.employment_status,
      occupation: application.occupation,
      jobTitle: application.job_title,
      employerName: application.employer_name,
      workAddress: application.work_address,
      workPhoneNumber: application.work_phone_number,
      lengthOfEmployment: application.length_of_employment,
      monthlyNetIncome: application.monthly_net_income,

      // Self-employed specific fields
      natureOfBusiness: application.nature_of_business,
      businessName: application.business_name,
      businessAddress: application.business_address,
      businessDuration: application.business_duration,

      // Next of Kin
      nextOfKinFullName: application.next_of_kin_full_name,
      nextOfKinAddress: application.next_of_kin_address,
      nextOfKinRelationship: application.next_of_kin_relationship,
      nextOfKinPhoneNumber: application.next_of_kin_phone_number,
      nextOfKinEmail: application.next_of_kin_email,

      // Referral Agent
      referralAgentFullName: application.referral_agent_full_name,
      referralAgentPhoneNumber: application.referral_agent_phone_number,

      // Tenancy Info
      intendedUseOfProperty: application.intended_use_of_property,
      numberOfOccupants: application.number_of_occupants,
      parkingNeeds: application.parking_needs,
      proposedRentAmount: application.proposed_rent_amount,
      rentPaymentFrequency: application.rent_payment_frequency,
      additionalNotes: application.additional_notes,

      // Documents
      passportPhotoUrl: application.passport_photo_url,
      idDocumentUrl: application.id_document_url,
      employmentProofUrl: application.employment_proof_url,
      businessProofUrl: application.business_proof_url,

      // Include property information if the relation is loaded
      property: application.property
        ? {
            name: application.property.name,
            address: application.property.location,
            status: application.property.property_status,
          }
        : undefined,
      submissionDate:
        application.created_at instanceof Date
          ? application.created_at.toISOString()
          : application.created_at,
      createdAt:
        application.created_at instanceof Date
          ? application.created_at.toISOString()
          : application.created_at,
      updatedAt:
        application.updated_at instanceof Date
          ? application.updated_at.toISOString()
          : application.updated_at,

      // Offer Letter Information
      offerLetterStatus:
        application.offer_letters && application.offer_letters.length > 0
          ? application.offer_letters.sort((a, b) => {
              // Sort by created_at desc (handling potential string/Date types)
              const dateA = new Date(a.created_at || 0).getTime();
              const dateB = new Date(b.created_at || 0).getTime();
              return dateB - dateA;
            })[0].status
          : undefined,

      offerLetter:
        application.offer_letters && application.offer_letters.length > 0
          ? (() => {
              const latestOffer = application.offer_letters.sort((a, b) => {
                const dateA = new Date(a.created_at || 0).getTime();
                const dateB = new Date(b.created_at || 0).getTime();
                return dateB - dateA;
              })[0];
              return {
                id: latestOffer.id,
                token: latestOffer.token,
                status: latestOffer.status,
                rentAmount: latestOffer.rent_amount,
                rentFrequency: latestOffer.rent_frequency,
                serviceCharge: latestOffer.service_charge,
                tenancyStartDate: latestOffer.tenancy_start_date,
                tenancyEndDate: latestOffer.tenancy_end_date,
                cautionDeposit: latestOffer.caution_deposit,
                legalFee: latestOffer.legal_fee,
                agencyFee: latestOffer.agency_fee,
                sentAt: latestOffer.sent_at
                  ? latestOffer.sent_at instanceof Date
                    ? latestOffer.sent_at.toISOString()
                    : latestOffer.sent_at
                  : undefined,
              };
            })()
          : undefined,
    };
  }

  /**
   * Get a specific KYC application by ID (with landlord authorization)
   * Requirements: 4.1, 4.2, 4.3
   */
  async getApplicationById(
    applicationId: string,
    landlordId: string,
  ): Promise<any> {
    console.log('🔍 Fetching KYC application:', {
      applicationId,
      landlordId,
    });

    const application = await this.kycApplicationRepository.findOne({
      where: { id: applicationId },
      relations: ['property', 'kyc_link', 'tenant', 'offer_letters'],
    });

    if (!application) {
      console.log('❌ KYC application not found:', applicationId);
      throw new NotFoundException('KYC application not found');
    }

    console.log('✅ Found application:', {
      id: application.id,
      propertyId: application.property_id,
      status: application.status,
    });

    // Validate that the landlord owns the property
    try {
      await this.validatePropertyOwnership(application.property_id, landlordId);
      console.log('✅ Landlord ownership validated');
    } catch (error) {
      console.log('❌ Landlord ownership validation failed:', error.message);
      throw error;
    }

    return this.transformApplicationForFrontend(application);
  }

  /**
   * Reject all other applications for a property when one is approved
   * Requirements: 3.2, 3.4
   */
  async rejectOtherApplications(
    propertyId: string,
    excludeApplicationId: string,
  ): Promise<void> {
    await this.kycApplicationRepository
      .createQueryBuilder()
      .update(KYCApplication)
      .set({ status: ApplicationStatus.REJECTED })
      .where('property_id = :propertyId', { propertyId })
      .andWhere('status = :status', { status: ApplicationStatus.PENDING })
      .andWhere('id != :excludeApplicationId', { excludeApplicationId })
      .execute();
  }

  /**
   * Get application statistics for a property
   * Requirements: 4.1, 4.2
   * When property is vacant, only count pending applications
   */
  async getApplicationStatistics(
    propertyId: string,
    landlordId: string,
  ): Promise<{
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  }> {
    // Validate property ownership and get property details
    const property = await this.validatePropertyOwnership(
      propertyId,
      landlordId,
    );

    if (property.property_status === 'vacant') {
      // For vacant properties, only show pending applications count
      const pending = await this.kycApplicationRepository.count({
        where: { property_id: propertyId, status: ApplicationStatus.PENDING },
      });

      return {
        total: pending,
        pending,
        approved: 0,
        rejected: 0,
      };
    } else {
      // For occupied properties, show all statistics
      const [total, pending, approved, rejected] = await Promise.all([
        this.kycApplicationRepository.count({
          where: { property_id: propertyId },
        }),
        this.kycApplicationRepository.count({
          where: { property_id: propertyId, status: ApplicationStatus.PENDING },
        }),
        this.kycApplicationRepository.count({
          where: {
            property_id: propertyId,
            status: ApplicationStatus.APPROVED,
          },
        }),
        this.kycApplicationRepository.count({
          where: {
            property_id: propertyId,
            status: ApplicationStatus.REJECTED,
          },
        }),
      ]);

      return { total, pending, approved, rejected };
    }
  }

  /**
   * Get all KYC applications for a landlord (across all properties)
   * Optimized: Only select columns needed for frontend transformation
   */
  async getAllApplications(landlordId: string): Promise<any[]> {
    const applications = await this.kycApplicationRepository
      .createQueryBuilder('application')
      // Only select needed property columns
      .leftJoin('application.property', 'property')
      .addSelect([
        'property.id',
        'property.name',
        'property.location',
        'property.property_status',
      ])
      // kyc_link not used in transform, skip it
      // tenant_id is already on application, skip tenant relation
      // Only select needed offer_letter columns
      .leftJoin('application.offer_letters', 'offer_letters')
      .addSelect([
        'offer_letters.id',
        'offer_letters.token',
        'offer_letters.status',
        'offer_letters.rent_amount',
        'offer_letters.rent_frequency',
        'offer_letters.service_charge',
        'offer_letters.tenancy_start_date',
        'offer_letters.tenancy_end_date',
        'offer_letters.caution_deposit',
        'offer_letters.legal_fee',
        'offer_letters.agency_fee',
        'offer_letters.created_at',
        'offer_letters.sent_at',
      ])
      .where('property.owner_id = :landlordId', { landlordId })
      .andWhere('application.deleted_at IS NULL')
      .orderBy('application.created_at', 'DESC')
      .getMany();

    return applications.map((app) => this.transformApplicationForFrontend(app));
  }

  /**
   * Get KYC applications by tenant ID (landlord access only)
   * Requirements: 4.5, 6.4
   */
  async getApplicationsByTenant(
    tenantId: string,
    landlordId: string,
  ): Promise<any[]> {
    // Get all applications for the tenant
    const applications = await this.kycApplicationRepository.find({
      where: { tenant_id: tenantId },
      relations: ['property', 'kyc_link', 'tenant', 'offer_letters'],
      order: {
        created_at: 'DESC', // Most recent applications first
      },
    });

    // Validate that the landlord owns all properties associated with these applications
    for (const application of applications) {
      await this.validatePropertyOwnership(application.property_id, landlordId);
    }

    return applications.map((app) => this.transformApplicationForFrontend(app));
  }

  /**
   * Validate KYC token and return the associated KYC link
   * Private helper method
   */
  private async validateKYCToken(token: string): Promise<KYCLink> {
    if (!token || typeof token !== 'string' || token.trim() === '') {
      throw new BadRequestException('Invalid KYC token format');
    }

    const kycLink = await this.kycLinkRepository.findOne({
      where: { token: token.trim() },
      relations: ['landlord'],
    });

    if (!kycLink) {
      throw new NotFoundException('Invalid KYC token');
    }

    if (!kycLink.is_active) {
      throw new BadRequestException('This KYC form is no longer available');
    }

    // Check expiration only if expires_at is set (for backward compatibility with old links)
    if (kycLink.expires_at && new Date() > kycLink.expires_at) {
      // Deactivate expired token
      await this.kycLinkRepository.update(kycLink.id, { is_active: false });
      throw new BadRequestException('This KYC form has expired');
    }

    return kycLink;
  }
  /**
   * Track when a KYC form is opened by a visitor.
   * Records timestamp, IP address, and device info.
   * Creates a PropertyHistory record on every open (with 30s spam cooldown).
   * Tracks all visitors — if an application exists, ties history to the property.
   */
  async trackFormOpen(
    token: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      const kycLink = await this.validateKYCToken(token);

      // Find any application for this token (not just PENDING_COMPLETION)
      const application = await this.kycApplicationRepository.findOne({
        where: { kyc_link_id: kycLink.id },
        order: { created_at: 'DESC' },
      });

      // Update form_opened_at on the application if one exists (always overwrite)
      if (application) {
        const updateData: Record<string, unknown> = {
          form_opened_at: new Date(),
        };
        if (ipAddress) {
          updateData.form_opened_ip = ipAddress;
        }
        await this.kycApplicationRepository.update(application.id, updateData);
      }

      // Parse device info from User-Agent
      let deviceInfo = 'Unknown Device';
      if (userAgent) {
        const os = /iPhone/i.test(userAgent)
          ? 'iPhone'
          : /iPad/i.test(userAgent)
            ? 'iPad'
            : /Android/i.test(userAgent)
              ? 'Android'
              : /Windows/i.test(userAgent)
                ? 'Windows'
                : /Macintosh/i.test(userAgent)
                  ? 'Mac'
                  : /Linux/i.test(userAgent)
                    ? 'Linux'
                    : 'Unknown OS';

        const browser = /Edg/i.test(userAgent)
          ? 'Edge'
          : /Chrome/i.test(userAgent)
            ? 'Chrome'
            : /Firefox/i.test(userAgent)
              ? 'Firefox'
              : /Safari/i.test(userAgent)
                ? 'Safari'
                : 'Unknown Browser';

        deviceInfo = `${browser} on ${os}`;
      }

      // Create PropertyHistory record only if we have an application (need property_id)
      if (application?.property_id) {
        try {
          const { PropertyHistory } = await import(
            '../property-history/entities/property-history.entity'
          );
          const propertyHistoryRepo =
            this.kycApplicationRepository.manager.getRepository(
              PropertyHistory,
            );

          // Spam prevention: skip if a record was created within the last 30 seconds
          const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
          const recentRecord = await propertyHistoryRepo.findOne({
            where: {
              related_entity_id: application.id,
              related_entity_type: 'kyc_application',
              event_type: 'kyc_form_viewed',
            },
            order: { created_at: 'DESC' },
          });

          if (
            recentRecord &&
            recentRecord.created_at && new Date(recentRecord.created_at) > thirtySecondsAgo
          ) {
            return {
              success: true,
              message: 'Form open tracked (cooldown active)',
            };
          }

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

          await propertyHistoryRepo.save({
            property_id: application.property_id,
            tenant_id: application.tenant_id || null,
            event_type: 'kyc_form_viewed',
            event_description: `KYC form viewed — ${ipAddress || 'Unknown IP'} — ${deviceInfo} — ${formattedDate} at ${formattedTime}`,
            related_entity_id: application.id,
            related_entity_type: 'kyc_application',
          });
        } catch (historyError) {
          console.error(
            'Failed to create KYC form view history:',
            historyError,
          );
        }
      }

      return { success: true, message: 'Form open tracked successfully' };
    } catch (error) {
      console.error('Error tracking form open:', error);
      return { success: true, message: 'Form open tracking skipped' };
    }
  }

  /**
   * Get property history events for a KYC application (landlord only)
   */
  async getKYCApplicationHistory(
    applicationId: string,
    landlordId: string,
  ): Promise<
    Array<{
      id: string;
      eventType: string;
      eventDescription: string;
      createdAt: string;
    }>
  > {
    const application = await this.kycApplicationRepository.findOne({
      where: { id: applicationId },
      relations: ['kyc_link'],
    });

    if (!application) {
      throw new NotFoundException('KYC application not found');
    }

    if (application.kyc_link?.landlord_id !== landlordId) {
      throw new ForbiddenException(
        'Not authorized to view this application history',
      );
    }

    const { PropertyHistory } = await import(
      '../property-history/entities/property-history.entity'
    );
    const propertyHistoryRepo =
      this.kycApplicationRepository.manager.getRepository(PropertyHistory);

    const historyEvents = await propertyHistoryRepo.find({
      where: {
        related_entity_id: applicationId,
        related_entity_type: 'kyc_application',
      },
      order: { created_at: 'DESC' },
    });

    return historyEvents.map((event) => ({
      id: event.id,
      eventType: event.event_type,
      eventDescription: event.event_description || '',
      createdAt: event.created_at
        ? new Date(event.created_at).toISOString()
        : new Date().toISOString(),
    }));
  }

  /**
   * Strip a KYC record to only the fields needed for frontend autofill.
   * Prevents leaking internal fields (kyc_link_id, tenant_id, status, tracking IPs, etc.)
   */
  private stripToAutofillFields(
    application: Partial<KYCApplication>,
  ): Partial<KYCApplication> {
    const {
      id,
      first_name,
      last_name,
      email,
      contact_address,
      phone_number,
      date_of_birth,
      gender,
      nationality,
      state_of_origin,
      marital_status,
      religion,
      employment_status,
      occupation,
      job_title,
      employer_name,
      work_address,
      work_phone_number,
      monthly_net_income,
      length_of_employment,
      nature_of_business,
      business_name,
      business_address,
      business_duration,
      next_of_kin_full_name,
      next_of_kin_address,
      next_of_kin_relationship,
      next_of_kin_phone_number,
      next_of_kin_email,
      referral_agent_full_name,
      referral_agent_phone_number,
      passport_photo_url,
      id_document_url,
      employment_proof_url,
      business_proof_url,
      updated_at,
    } = application as any;

    return {
      id,
      first_name,
      last_name,
      email,
      contact_address,
      phone_number,
      date_of_birth,
      gender,
      nationality,
      state_of_origin,
      marital_status,
      religion,
      employment_status,
      occupation,
      job_title,
      employer_name,
      work_address,
      work_phone_number,
      monthly_net_income,
      length_of_employment,
      nature_of_business,
      business_name,
      business_address,
      business_duration,
      next_of_kin_full_name,
      next_of_kin_address,
      next_of_kin_relationship,
      next_of_kin_phone_number,
      next_of_kin_email,
      referral_agent_full_name,
      referral_agent_phone_number,
      passport_photo_url,
      id_document_url,
      employment_proof_url,
      business_proof_url,
      updated_at,
    };
  }

  /**
   * Check for any existing KYC record system-wide by phone number
   * Returns the most recent KYC data for autofill purposes
   */
  async checkExistingKYC(
    phoneNumber: string,
    email?: string,
  ): Promise<{
    hasExisting: boolean;
    kycData?: Partial<KYCApplication>;
    source: 'kyc_application' | 'tenant_kyc' | null;
  }> {
    try {
      // Validate input
      if (!phoneNumber) {
        throw new BadRequestException('Phone number is required');
      }

      // Normalize phone number for consistent matching
      const normalizedPhone =
        this.utilService.normalizePhoneNumber(phoneNumber);

      // Also prepare phone number without + prefix for database compatibility
      const phoneWithoutPlus = normalizedPhone.startsWith('+')
        ? normalizedPhone.substring(1)
        : normalizedPhone;

      // First check KYC applications table (most recent data)
      // Search for both formats since database might store without + prefix
      let kycApplication = await this.kycApplicationRepository
        .createQueryBuilder('kyc')
        .where('(kyc.phone_number = :phone1 OR kyc.phone_number = :phone2)', {
          phone1: normalizedPhone,
          phone2: phoneWithoutPlus,
        })
        .orderBy('kyc.created_at', 'DESC')
        .getOne();

      // Also check by email if provided
      if (!kycApplication && email) {
        kycApplication = await this.kycApplicationRepository
          .createQueryBuilder('kyc')
          .where('kyc.email = :email', { email })
          .orderBy('kyc.created_at', 'DESC')
          .getOne();
      }

      if (kycApplication) {
        return {
          hasExisting: true,
          kycData: this.stripToAutofillFields(kycApplication),
          source: 'kyc_application',
        };
      }

      // If no KYC application found, check tenant_kyc table
      const tenantKycQuery = this.tenantKycRepository
        .createQueryBuilder('kyc')
        .leftJoinAndSelect('kyc.user', 'user')
        .where('(kyc.phone_number = :phone1 OR kyc.phone_number = :phone2)', {
          phone1: normalizedPhone,
          phone2: phoneWithoutPlus,
        });

      if (email) {
        tenantKycQuery.orWhere('kyc.email = :email', { email });
      }

      const tenantKyc = await tenantKycQuery
        .orderBy('kyc.created_at', 'DESC')
        .getOne();

      if (tenantKyc) {
        // Convert tenant KYC to KYC application format for consistency
        const convertedKyc: Partial<KYCApplication> = {
          id: tenantKyc.id,
          first_name: tenantKyc.first_name,
          last_name: tenantKyc.last_name,
          email: tenantKyc.email,
          phone_number: tenantKyc.phone_number,
          date_of_birth: tenantKyc.date_of_birth,
          gender: tenantKyc.gender as any, // Cast to handle enum compatibility
          nationality: tenantKyc.nationality,
          state_of_origin: tenantKyc.state_of_origin,
          marital_status: tenantKyc.marital_status as any, // Cast to handle enum compatibility
          religion: tenantKyc.religion,
          employment_status: tenantKyc.employment_status as any, // Cast to handle enum compatibility
          occupation: tenantKyc.occupation,
          job_title: tenantKyc.job_title,
          employer_name: tenantKyc.employer_name,
          work_address: tenantKyc.work_address,
          work_phone_number: tenantKyc.work_phone_number,
          nature_of_business: tenantKyc.nature_of_business,
          business_name: tenantKyc.business_name,
          business_address: tenantKyc.business_address,
          business_duration: tenantKyc.business_duration,
          monthly_net_income: tenantKyc.monthly_net_income,
          next_of_kin_full_name: tenantKyc.next_of_kin_full_name,
          next_of_kin_address: tenantKyc.next_of_kin_address,
          next_of_kin_relationship: tenantKyc.next_of_kin_relationship,
          next_of_kin_phone_number: tenantKyc.next_of_kin_phone_number,
          next_of_kin_email: tenantKyc.next_of_kin_email,
          referral_agent_full_name: tenantKyc.referral_agent_full_name,
          referral_agent_phone_number: tenantKyc.referral_agent_phone_number,
          // Note: Don't include tenancy information - that should be fresh for each application
          // Note: tenant_kyc doesn't have document URLs - only kyc_application does
        };

        return {
          hasExisting: true,
          kycData: this.stripToAutofillFields(convertedKyc),
          source: 'tenant_kyc',
        };
      }

      console.log(
        '✅ No existing KYC found system-wide for phone:',
        normalizedPhone,
      );
      return { hasExisting: false, source: null };
    } catch (error) {
      console.error('❌ Error checking existing KYC system-wide:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        phoneNumber,
        email,
        timestamp: new Date().toISOString(),
      });

      // Re-throw known exceptions
      if (error instanceof BadRequestException) {
        throw error;
      }

      // For other errors, return no existing KYC to allow normal flow
      return { hasExisting: false, source: null };
    }
  }

  /**
   * Check for pending completion KYC applications by phone number
   * Requirements: 4.4, 7.2, 7.3, 7.4
   */
  async checkPendingCompletion(
    landlordId: string,
    phoneNumber: string,
    email?: string,
  ): Promise<{
    hasPending: boolean;
    kycData?: Partial<KYCApplication>;
    propertyIds?: string[];
  }> {
    try {
      // Validate input
      if (!landlordId || !phoneNumber) {
        throw new BadRequestException(
          'Landlord ID and phone number are required',
        );
      }

      // Normalize phone number for consistent matching
      const normalizedPhone =
        this.utilService.normalizePhoneNumber(phoneNumber);

      // Also prepare phone number without + prefix for database compatibility
      const phoneWithoutPlus = normalizedPhone.startsWith('+')
        ? normalizedPhone.substring(1)
        : normalizedPhone;

      // Build identifier condition (phone OR email) as a grouped clause
      // so that landlord isolation via andWhere is never bypassed
      let identifierCondition =
        '(kyc.phone_number = :phone1 OR kyc.phone_number = :phone2';
      const identifierParams: Record<string, string> = {
        phone1: normalizedPhone,
        phone2: phoneWithoutPlus,
      };

      if (email) {
        identifierCondition += ' OR kyc.email = :email';
        identifierParams.email = email;
      }
      identifierCondition += ')';

      // Build query to find pending completion KYCs
      const queryBuilder = this.kycApplicationRepository
        .createQueryBuilder('kyc')
        .leftJoinAndSelect('kyc.property', 'property')
        .leftJoinAndSelect('kyc.tenant', 'tenant')
        .where('kyc.status = :status', {
          status: ApplicationStatus.PENDING_COMPLETION,
        })
        .andWhere('property.owner_id = :landlordId', { landlordId })
        .andWhere(identifierCondition, identifierParams);

      const pendingKycs = await queryBuilder.getMany();

      if (pendingKycs.length === 0) {
        return { hasPending: false };
      }

      // Return the oldest pending KYC (based on created_at timestamp)
      const oldestKyc = pendingKycs.sort((a, b) => {
        const aTime =
          a.created_at instanceof Date
            ? a.created_at.getTime()
            : a.created_at
              ? new Date(a.created_at).getTime()
              : 0;
        const bTime =
          b.created_at instanceof Date
            ? b.created_at.getTime()
            : b.created_at
              ? new Date(b.created_at).getTime()
              : 0;
        return aTime - bTime;
      })[0];

      console.log('✅ Found pending KYC:', {
        kycId: oldestKyc.id,
        propertyCount: pendingKycs.length,
        timestamp: new Date().toISOString(),
      });

      return {
        hasPending: true,
        kycData: this.stripToAutofillFields(oldestKyc),
        propertyIds: pendingKycs.map((kyc) => kyc.property_id),
      };
    } catch (error) {
      console.error('❌ Error checking pending KYC completion:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        landlordId,
        phoneNumber,
        email,
        timestamp: new Date().toISOString(),
      });

      // Re-throw known exceptions
      if (error instanceof BadRequestException) {
        throw error;
      }

      // Wrap unknown errors
      throw new HttpException(
        `Failed to check pending KYC: ${error.message || 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Complete a pending KYC application
   * Requirements: 5.1, 5.2, 5.3
   * SECURITY: Validates KYC token (from body) and verifies OTP before allowing completion
   */
  async completePendingKYC(
    token: string,
    completionData: CompleteKYCDto,
  ): Promise<KYCApplication> {
    try {
      // Validate input
      if (!token) {
        throw new BadRequestException('KYC token is required');
      }

      console.log('📝 Completing pending KYC:', {
        token: '***', // Don't log full token
        timestamp: new Date().toISOString(),
      });

      // SECURITY: Validate the KYC token first
      const kycLink = await this.kycLinkRepository.findOne({
        where: { token, is_active: true },
      });

      if (!kycLink) {
        throw new NotFoundException('Invalid or expired KYC token');
      }

      // SECURITY: Verify OTP before allowing completion
      const verifiedOtp = await this.kycOtpRepository.findOne({
        where: {
          phone_number: completionData.phone_number,
          kyc_token: token,
          is_verified: true,
        },
        order: {
          created_at: 'DESC',
        },
      });

      if (!verifiedOtp) {
        throw new BadRequestException(
          'Phone number must be verified before completing KYC application. Please request and verify an OTP code.',
        );
      }

      // Fetch existing KYC with status pending_completion
      // SECURITY: Match by kyc_link_id and phone_number to ensure ownership
      const kyc = await this.kycApplicationRepository.findOne({
        where: {
          kyc_link_id: kycLink.id,
          phone_number: completionData.phone_number,
          status: ApplicationStatus.PENDING_COMPLETION,
        },
        relations: ['property', 'tenant'],
      });

      if (!kyc) {
        throw new NotFoundException(
          'Pending KYC application not found or already completed',
        );
      }

      // Update KYC with completion data
      const updateData: Partial<KYCApplication> = {
        ...this.mapCommonFieldsToEntity(completionData),
        updated_at: new Date(),
        decision_made_at: new Date(),
      };

      // Tracking fields from client-side capture
      if (completionData.decision_made_ip) {
        updateData.decision_made_ip = completionData.decision_made_ip;
      }
      if (completionData.user_agent) {
        updateData.user_agent = completionData.user_agent;
      }
      if (completionData.form_opened_at) {
        updateData.form_opened_at = new Date(completionData.form_opened_at);
      }
      if (completionData.form_opened_ip) {
        updateData.form_opened_ip = completionData.form_opened_ip;
      }

      // Service-level validation: verify all required fields are present before approving
      const requiredFields = [
        'email',
        'contact_address',
        'date_of_birth',
        'gender',
        'state_of_origin',
        'nationality',
        'employment_status',
        'marital_status',
        'religion',
        'next_of_kin_full_name',
        'next_of_kin_phone_number',
        'next_of_kin_relationship',
        'next_of_kin_address',
        'next_of_kin_email',
        'intended_use_of_property',
        'number_of_occupants',
        'proposed_rent_amount',
        'rent_payment_frequency',
        'passport_photo_url',
        'id_document_url',
      ];

      const missingFields = requiredFields.filter(
        (field) => !updateData[field as keyof typeof updateData],
      );

      if (missingFields.length > 0) {
        throw new BadRequestException(
          `Cannot approve KYC application. Missing required fields: ${missingFields.join(', ')}`,
        );
      }

      // All required fields validated — set status to APPROVED
      updateData.status = ApplicationStatus.APPROVED;

      // Save the updated KYC
      await this.kycApplicationRepository.update(kyc.id, updateData);

      // Fetch the updated KYC with relations
      const updatedKyc = await this.kycApplicationRepository.findOne({
        where: { id: kyc.id },
        relations: ['property', 'tenant', 'kyc_link'],
      });

      if (!updatedKyc) {
        throw new NotFoundException(
          'Failed to retrieve updated KYC application',
        );
      }

      // Create property history events for tracking timeline
      try {
        const { PropertyHistory } = await import(
          '../property-history/entities/property-history.entity'
        );
        const propertyHistoryRepo =
          this.kycApplicationRepository.manager.getRepository(PropertyHistory);

        const historyEvents: Array<Partial<InstanceType<typeof PropertyHistory>>> = [];

        // If form_opened_at was captured, create a "form viewed" event
        if (updatedKyc.form_opened_at) {
          const openedDate = new Date(updatedKyc.form_opened_at);
          const ipInfo = updatedKyc.form_opened_ip
            ? ` from IP ${updatedKyc.form_opened_ip}`
            : '';
          const deviceInfo = updatedKyc.user_agent
            ? ` — ${updatedKyc.user_agent}`
            : '';
          historyEvents.push(
            propertyHistoryRepo.create({
              property_id: updatedKyc.property_id,
              event_type: 'kyc_form_viewed',
              event_description: `KYC form opened by ${updatedKyc.first_name} ${updatedKyc.last_name} on ${openedDate.toLocaleDateString('en-GB')} at ${openedDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}${ipInfo}${deviceInfo}`,
              related_entity_id: updatedKyc.id,
              related_entity_type: 'kyc_application',
              created_at: openedDate,
            }),
          );
        }

        // Create "application submitted" event for completion
        historyEvents.push(
          propertyHistoryRepo.create({
            property_id: updatedKyc.property_id,
            event_type: 'kyc_application_submitted',
            event_description: `${updatedKyc.first_name} ${updatedKyc.last_name} completed their KYC application for ${updatedKyc.property?.name || 'property'}`,
            related_entity_id: updatedKyc.id,
            related_entity_type: 'kyc_application',
          }),
        );

        await propertyHistoryRepo.save(historyEvents);
      } catch (error) {
        console.error('Failed to create property history events:', error);
      }

      // Send notification to landlord
      try {
        if (this.notificationService && updatedKyc.property) {
          await this.notificationService.create({
            date: new Date().toISOString(),
            type: NotificationType.KYC_SUBMITTED,
            description: `${updatedKyc.first_name} ${updatedKyc.last_name} completed their KYC application for ${updatedKyc.property.name}`,
            status: 'Completed',
            property_id: updatedKyc.property_id,
            user_id: updatedKyc.property.owner_id,
          });
        }
      } catch (error) {
        // Log error but don't fail the request if notification creation fails
        console.error('Failed to create KYC completion notification:', error);
      }

      // Emit WebSocket event to notify landlord
      try {
        if (this.eventsGateway && updatedKyc.property) {
          this.eventsGateway.emitKYCSubmission(
            updatedKyc.property_id,
            updatedKyc.property.owner_id,
            {
              id: updatedKyc.id,
              firstName: updatedKyc.first_name,
              lastName: updatedKyc.last_name,
              email: updatedKyc.email,
              phoneNumber: updatedKyc.phone_number,
            },
          );
        }
      } catch (error) {
        console.error('Failed to emit KYC completion event:', error);
      }

      // Send WhatsApp notification to landlord
      try {
        if (this.whatsappBotService && updatedKyc.property) {
          const property = updatedKyc.property;

          // Get landlord details
          const landlord = await this.propertyRepository
            .createQueryBuilder('property')
            .leftJoinAndSelect('property.owner', 'owner')
            .leftJoinAndSelect('owner.user', 'user')
            .where('property.id = :propertyId', { propertyId: property.id })
            .getOne();

          if (landlord?.owner?.user?.phone_number && updatedKyc.tenant_id) {
            const landlordPhone = this.utilService.normalizePhoneNumber(
              landlord.owner.user.phone_number,
            );
            const landlordName = this.utilService.toSentenceCase(
              landlord.owner.user.first_name,
            );
            const tenantName = this.utilService.toSentenceCase(
              updatedKyc.first_name,
            );

            await this.whatsappBotService.sendKYCCompletionNotification({
              phone_number: landlordPhone,
              landlord_name: landlordName,
              tenant_name: tenantName,
              property_name: property.name,
              tenant_id: updatedKyc.tenant_id,
            });

            console.log('✅ WhatsApp KYC completion notification sent:', {
              to: landlordPhone,
              tenant: tenantName,
              property: property.name,
              tenantId: updatedKyc.tenant_id,
            });
          }
        }
      } catch (error) {
        console.error(
          'Failed to send WhatsApp KYC completion notification:',
          error,
        );
      }

      // Send WhatsApp confirmation to tenant
      try {
        if (this.whatsappBotService && updatedKyc.phone_number) {
          const tenantPhone = this.utilService.normalizePhoneNumber(
            updatedKyc.phone_number,
          );
          const tenantName = `${updatedKyc.first_name} ${updatedKyc.last_name}`;

          await this.whatsappBotService.sendKYCSubmissionConfirmation({
            phone_number: tenantPhone,
            tenant_name: tenantName,
          });

          console.log(
            '✅ WhatsApp KYC completion confirmation sent to tenant:',
            {
              to: tenantPhone,
              tenant: tenantName,
            },
          );
        }
      } catch (error) {
        console.error(
          'Failed to send tenant KYC completion confirmation:',
          error,
        );
      }

      // Send WhatsApp notification to referral agent (if provided)
      try {
        if (
          this.whatsappBotService &&
          updatedKyc.referral_agent_phone_number &&
          updatedKyc.referral_agent_full_name &&
          updatedKyc.property
        ) {
          const property = updatedKyc.property;

          const agentPhone = this.utilService.normalizePhoneNumber(
            updatedKyc.referral_agent_phone_number,
          );
          const agentName = updatedKyc.referral_agent_full_name;
          const tenantName = `${updatedKyc.first_name} ${updatedKyc.last_name}`;

          await this.whatsappBotService.sendAgentKYCNotification({
            phone_number: agentPhone,
            agent_name: agentName,
            tenant_name: tenantName,
            property_name: property.name,
          });

          console.log(
            `✅ Agent KYC notification sent to ${agentName} (${agentPhone})`,
          );
        }
      } catch (error) {
        console.error('Failed to send agent KYC notification:', error);
      }

      console.log('✅ KYC completion successful:', {
        kycId: updatedKyc.id,
        status: updatedKyc.status,
        timestamp: new Date().toISOString(),
      });

      return updatedKyc;
    } catch (error) {
      console.error('❌ Error completing pending KYC:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
      });

      // Re-throw known exceptions
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      // Wrap unknown errors
      throw new HttpException(
        `Failed to complete KYC: ${error.message || 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get KYC link token for a specific application (for resending)
   */
  async getKYCTokenForApplication(
    applicationId: string,
    landlordId: string,
  ): Promise<string> {
    try {
      // Find the application with its KYC link
      const application = await this.kycApplicationRepository.findOne({
        where: { id: applicationId },
        relations: ['kyc_link', 'property'],
      });

      if (!application) {
        throw new NotFoundException('KYC application not found');
      }

      // Validate property ownership
      await this.validatePropertyOwnership(application.property_id, landlordId);

      if (!application.kyc_link) {
        throw new NotFoundException('KYC link not found for this application');
      }

      if (!application.kyc_link.is_active) {
        throw new BadRequestException('KYC link is no longer active');
      }

      return application.kyc_link.token;
    } catch (error) {
      console.error('❌ Error getting KYC token for application:', {
        error: error instanceof Error ? error.message : String(error),
        applicationId,
        landlordId,
        timestamp: new Date().toISOString(),
      });

      // Re-throw known exceptions
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      // Wrap unknown errors
      throw new HttpException(
        `Failed to get KYC token: ${error.message || 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Resend KYC completion link for a specific application
   * Uses the same template as initial KYC completion links
   */
  async resendKYCCompletionLink(
    applicationId: string,
    landlordId: string,
  ): Promise<void> {
    try {
      // Find the application with all necessary relations
      const application = await this.kycApplicationRepository.findOne({
        where: { id: applicationId },
        relations: [
          'kyc_link',
          'property',
          'property.owner',
          'property.owner.user',
        ],
      });

      if (!application) {
        throw new NotFoundException('KYC application not found');
      }

      // Validate property ownership
      await this.validatePropertyOwnership(application.property_id, landlordId);

      if (!application.kyc_link) {
        throw new NotFoundException('KYC link not found for this application');
      }

      if (!application.kyc_link.is_active) {
        throw new BadRequestException('KYC link is no longer active');
      }

      // Only allow resending for pending completion applications
      if (application.status !== ApplicationStatus.PENDING_COMPLETION) {
        throw new BadRequestException(
          'Can only resend KYC links for applications awaiting completion',
        );
      }

      // Prepare data for WhatsApp message
      const normalizedPhone = this.utilService.normalizePhoneNumber(
        application.phone_number,
      );
      const tenantName = this.utilService.toSentenceCase(
        application.first_name,
      );
      const landlordName = application.property?.owner?.user
        ? this.utilService.toSentenceCase(
            application.property.owner.user.first_name,
          )
        : 'Your landlord';

      // Send KYC completion link using the same method as initial creation
      if (this.whatsappBotService) {
        await this.whatsappBotService.sendKYCCompletionLink({
          phone_number: normalizedPhone,
          tenant_name: tenantName,
          landlord_name: landlordName,
          property_name: application.property.name,
          kyc_link_id: application.kyc_link.token,
        });

        console.log(
          `✅ KYC completion link resent to ${normalizedPhone} for application ${applicationId}`,
        );
      } else {
        throw new HttpException(
          'WhatsApp service not available',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    } catch (error) {
      console.error('❌ Error resending KYC completion link:', {
        error: error instanceof Error ? error.message : String(error),
        applicationId,
        landlordId,
        timestamp: new Date().toISOString(),
      });

      // Re-throw known exceptions
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof ForbiddenException ||
        error instanceof HttpException
      ) {
        throw error;
      }

      // Wrap unknown errors
      throw new HttpException(
        `Failed to resend KYC completion link: ${error.message || 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Validate property ownership
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
        'You are not authorized to access applications for this property',
      );
    }

    return property;
  }

  /**
   * Get history events for a KYC application by querying property_histories
   * for the application's property_id
   */
  async getApplicationHistory(
    applicationId: string,
    landlordId: string,
  ): Promise<
    Array<{
      id: string;
      eventType: string;
      eventDescription: string;
      createdAt: string;
    }>
  > {
    // Find the application and verify ownership
    const application = await this.kycApplicationRepository.findOne({
      where: { id: applicationId },
      relations: ['property'],
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }

    if (application.property?.owner_id !== landlordId) {
      throw new ForbiddenException(
        'Not authorized to view this application history',
      );
    }

    // Query property_histories for events related to this property
    const { PropertyHistory } = await import(
      '../property-history/entities/property-history.entity'
    );
    const propertyHistoryRepo =
      this.kycApplicationRepository.manager.getRepository(PropertyHistory);

    const historyEvents = await propertyHistoryRepo.find({
      where: {
        property_id: application.property_id,
      },
      order: { created_at: 'DESC' },
    });

    return historyEvents.map((event) => ({
      id: event.id,
      eventType: event.event_type,
      eventDescription: event.event_description || '',
      createdAt: event.created_at
        ? new Date(event.created_at).toISOString()
        : new Date().toISOString(),
    }));
  }
}

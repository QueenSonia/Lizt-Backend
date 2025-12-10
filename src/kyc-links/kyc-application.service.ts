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
import { Property } from '../properties/entities/property.entity';
import { PropertyTenant } from '../properties/entities/property-tenants.entity';
import { TenantStatusEnum } from '../properties/dto/create-property.dto';
import { CreateKYCApplicationDto } from './dto/create-kyc-application.dto';
import { CompleteKYCDto } from './dto/complete-kyc.dto';
import { EventsGateway } from '../events/events.gateway';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/enums/notification-type';
import { WhatsappBotService } from '../whatsapp-bot/whatsapp-bot.service';
import { UtilService } from '../utils/utility-service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class KYCApplicationService {
  constructor(
    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepository: Repository<KYCApplication>,
    @InjectRepository(KYCLink)
    private readonly kycLinkRepository: Repository<KYCLink>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
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

    if (selectedProperty.property_status !== 'vacant') {
      throw new BadRequestException(
        'Selected property is no longer available for applications',
      );
    }

    // Check if property is ready for marketing (has rental_price set)
    if (!selectedProperty.rental_price) {
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

        // If tenant is not active (tenancy ended), allow reapplication by deleting old application
        // This ensures a fresh application process
        await this.kycApplicationRepository.delete(existingApplication.id);
      } else {
        // If existing application has no tenant_id, check if it's still pending
        if (existingApplication.status === ApplicationStatus.PENDING) {
          throw new ConflictException(
            `User with phone number ${kycData.phone_number} has a pending application for this property`,
          );
        }

        // If it's rejected, allow reapplication by deleting old application
        if (existingApplication.status === ApplicationStatus.REJECTED) {
          await this.kycApplicationRepository.delete(existingApplication.id);
        }
      }
    }

    // Create new KYC application with automatic pending status
    // Handle optional fields properly to avoid undefined errors (relaxed validation)
    const applicationData: Partial<KYCApplication> = {
      kyc_link_id: kycLink.id,
      property_id: kycData.property_id, // Use the selected property from form data
      status: ApplicationStatus.PENDING,
      // Required fields
      first_name: kycData.first_name,
      last_name: kycData.last_name,
      phone_number: kycData.phone_number,
    };

    // Add optional fields only if they exist
    if (kycData.email) applicationData.email = kycData.email;
    if (kycData.contact_address)
      applicationData.contact_address = kycData.contact_address;
    if (kycData.date_of_birth)
      applicationData.date_of_birth = new Date(kycData.date_of_birth);
    if (kycData.gender) applicationData.gender = kycData.gender;
    if (kycData.nationality) applicationData.nationality = kycData.nationality;
    if (kycData.state_of_origin)
      applicationData.state_of_origin = kycData.state_of_origin;
    if (kycData.marital_status)
      applicationData.marital_status = kycData.marital_status;
    if (kycData.employment_status)
      applicationData.employment_status = kycData.employment_status;
    if (kycData.occupation) applicationData.occupation = kycData.occupation;
    if (kycData.job_title) applicationData.job_title = kycData.job_title;
    if (kycData.employer_name)
      applicationData.employer_name = kycData.employer_name;
    if (kycData.employer_address)
      applicationData.employer_address = kycData.employer_address;
    if (kycData.monthly_net_income)
      applicationData.monthly_net_income = kycData.monthly_net_income;
    if (kycData.reference1_name)
      applicationData.reference1_name = kycData.reference1_name;
    if (kycData.reference1_address)
      applicationData.reference1_address = kycData.reference1_address;
    if (kycData.reference1_relationship)
      applicationData.reference1_relationship = kycData.reference1_relationship;
    if (kycData.reference1_phone_number)
      applicationData.reference1_phone_number = kycData.reference1_phone_number;
    if (kycData.reference2_name)
      applicationData.reference2_name = kycData.reference2_name;
    if (kycData.reference2_address)
      applicationData.reference2_address = kycData.reference2_address;
    if (kycData.reference2_relationship)
      applicationData.reference2_relationship = kycData.reference2_relationship;
    if (kycData.reference2_phone_number)
      applicationData.reference2_phone_number = kycData.reference2_phone_number;

    // Add new fields
    if (kycData.religion) applicationData.religion = kycData.religion;
    if (kycData.reference1_email)
      applicationData.reference1_email = kycData.reference1_email;
    if (kycData.employer_phone_number)
      applicationData.employer_phone_number = kycData.employer_phone_number;
    if (kycData.length_of_employment)
      applicationData.length_of_employment = kycData.length_of_employment;

    // Self-employed specific fields
    if (kycData.nature_of_business)
      applicationData.nature_of_business = kycData.nature_of_business;
    if (kycData.business_name)
      applicationData.business_name = kycData.business_name;
    if (kycData.business_address)
      applicationData.business_address = kycData.business_address;
    if (kycData.business_duration)
      applicationData.business_duration = kycData.business_duration;
    if (kycData.intended_use_of_property)
      applicationData.intended_use_of_property =
        kycData.intended_use_of_property;
    if (kycData.number_of_occupants)
      applicationData.number_of_occupants = kycData.number_of_occupants;
    if (kycData.number_of_cars_owned)
      applicationData.number_of_cars_owned = kycData.number_of_cars_owned;
    if (kycData.proposed_rent_amount)
      applicationData.proposed_rent_amount = kycData.proposed_rent_amount;
    if (kycData.rent_payment_frequency)
      applicationData.rent_payment_frequency = kycData.rent_payment_frequency;
    if (kycData.additional_notes)
      applicationData.additional_notes = kycData.additional_notes;
    if (kycData.passport_photo_url)
      applicationData.passport_photo_url = kycData.passport_photo_url;
    if (kycData.id_document_url)
      applicationData.id_document_url = kycData.id_document_url;
    if (kycData.employment_proof_url)
      applicationData.employment_proof_url = kycData.employment_proof_url;
    if (kycData.business_proof_url)
      applicationData.business_proof_url = kycData.business_proof_url;

    const kycApplication =
      this.kycApplicationRepository.create(applicationData);

    const savedApplication =
      await this.kycApplicationRepository.save(kycApplication);

    // Return the application with relations loaded
    const applicationWithRelations =
      await this.kycApplicationRepository.findOne({
        where: { id: savedApplication.id },
        relations: ['property', 'kyc_link'],
      });

    if (!applicationWithRelations) {
      throw new Error('Failed to retrieve saved KYC application');
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

    // Send WhatsApp notification to landlord
    try {
      if (this.whatsappBotService && applicationWithRelations.property) {
        const property = applicationWithRelations.property;

        // Get landlord details
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
          const tenantName = `${kycData.first_name} ${kycData.last_name}`;
          const frontendUrl =
            this.configService.get('FRONTEND_URL') || 'https://www.lizt.co';

          await this.whatsappBotService.sendKYCApplicationNotification({
            phone_number: landlordPhone,
            landlord_name: landlordName,
            tenant_name: tenantName,
            property_name: property.name,
            application_id: savedApplication.id,
            frontend_url: frontendUrl,
          });
        }
      }
    } catch (error) {
      // Log error but don't fail the request if WhatsApp notification fails
      console.error('Failed to send WhatsApp KYC notification:', error);
    }

    // Send WhatsApp confirmation to tenant
    try {
      if (this.whatsappBotService && kycData.phone_number) {
        const tenantPhone = this.utilService.normalizePhoneNumber(
          kycData.phone_number,
        );
        const tenantName = `${kycData.first_name} ${kycData.last_name}`;

        await this.whatsappBotService.sendKYCSubmissionConfirmation({
          phone_number: tenantPhone,
          tenant_name: tenantName,
        });
      }
    } catch (error) {
      // Log error but don't fail the request if WhatsApp notification fails
      console.error('Failed to send tenant KYC confirmation:', error);
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
      relations: ['property', 'kyc_link', 'tenant'],
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
      employmentStatus: application.employment_status,
      occupation: application.occupation,
      jobTitle: application.job_title,
      employerName: application.employer_name,
      employerAddress: application.employer_address,
      employerPhoneNumber: application.employer_phone_number,
      lengthOfEmployment: application.length_of_employment,
      monthlyNetIncome: application.monthly_net_income,
      // Self-employed specific fields
      natureOfBusiness: application.nature_of_business,
      businessName: application.business_name,
      businessAddress: application.business_address,
      businessDuration: application.business_duration,
      reference1: {
        name: application.reference1_name,
        address: application.reference1_address,
        relationship: application.reference1_relationship,
        phoneNumber: application.reference1_phone_number,
        email: application.reference1_email,
      },
      reference2: application.reference2_name
        ? {
            name: application.reference2_name,
            address: application.reference2_address,
            relationship: application.reference2_relationship,
            phoneNumber: application.reference2_phone_number,
            email: null, // reference2_email not in schema
          }
        : null,
      tenantOffer: {
        proposedRentAmount: application.proposed_rent_amount,
        rentPaymentFrequency: application.rent_payment_frequency,
        intendedUse: application.intended_use_of_property,
        numberOfOccupants: application.number_of_occupants,
        additionalNotes: application.additional_notes,
      },
      documents: {
        passportPhoto: application.passport_photo_url,
        idDocument: application.id_document_url,
        employmentProof: application.employment_proof_url,
        businessProof: application.business_proof_url,
      },
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
      relations: ['property', 'kyc_link', 'tenant'],
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
   * Update application status (internal method for tenant attachment)
   * Requirements: 3.2, 3.4
   */
  async updateApplicationStatus(
    applicationId: string,
    status: ApplicationStatus,
    tenantId?: string,
  ): Promise<KYCApplication> {
    const application = await this.kycApplicationRepository.findOne({
      where: { id: applicationId },
    });

    if (!application) {
      throw new NotFoundException('KYC application not found');
    }

    // Update the application
    await this.kycApplicationRepository.update(applicationId, {
      status,
      tenant_id: tenantId,
    });

    // Return updated application
    const updatedApplication = await this.kycApplicationRepository.findOne({
      where: { id: applicationId },
      relations: ['property', 'kyc_link', 'tenant'],
    });

    if (!updatedApplication) {
      throw new NotFoundException('Updated KYC application not found');
    }

    return updatedApplication;
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
   */
  async getAllApplications(landlordId: string): Promise<any[]> {
    const applications = await this.kycApplicationRepository
      .createQueryBuilder('application')
      .leftJoinAndSelect('application.property', 'property')
      .leftJoinAndSelect('application.kyc_link', 'kyc_link')
      .leftJoinAndSelect('application.tenant', 'tenant')
      .where('property.owner_id = :landlordId', { landlordId })
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
      relations: ['property', 'kyc_link', 'tenant'],
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

      console.log('🔍 Checking for pending KYC completion:', {
        landlordId,
        phoneNumber,
        email,
        timestamp: new Date().toISOString(),
      });

      // Normalize phone number for consistent matching
      const normalizedPhone =
        this.utilService.normalizePhoneNumber(phoneNumber);

      // Build query to find pending completion KYCs
      const queryBuilder = this.kycApplicationRepository
        .createQueryBuilder('kyc')
        .leftJoinAndSelect('kyc.property', 'property')
        .leftJoinAndSelect('kyc.tenant', 'tenant')
        .where('kyc.status = :status', {
          status: ApplicationStatus.PENDING_COMPLETION,
        })
        .andWhere('property.owner_id = :landlordId', { landlordId })
        .andWhere('kyc.phone_number = :phone', { phone: normalizedPhone });

      // Also match by email if provided
      if (email) {
        queryBuilder.orWhere(
          'kyc.email = :email AND kyc.status = :status AND property.owner_id = :landlordId',
          { email, status: ApplicationStatus.PENDING_COMPLETION, landlordId },
        );
      }

      const pendingKycs = await queryBuilder.getMany();

      if (pendingKycs.length === 0) {
        console.log('✅ No pending KYC found for phone:', normalizedPhone);
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
        kycData: oldestKyc,
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
   */
  async completePendingKYC(
    kycId: string,
    completionData: CompleteKYCDto,
  ): Promise<KYCApplication> {
    try {
      // Validate input
      if (!kycId) {
        throw new BadRequestException('KYC ID is required');
      }

      console.log('📝 Completing pending KYC:', {
        kycId,
        timestamp: new Date().toISOString(),
      });

      // Fetch existing KYC with status pending_completion
      const kyc = await this.kycApplicationRepository.findOne({
        where: { id: kycId, status: ApplicationStatus.PENDING_COMPLETION },
        relations: ['property', 'tenant'],
      });

      if (!kyc) {
        throw new NotFoundException(
          'Pending KYC application not found or already completed',
        );
      }

      // Update KYC with completion data
      const updateData: Partial<KYCApplication> = {
        status: ApplicationStatus.APPROVED, // Auto-approve on completion
        updated_at: new Date(),
      };

      // Add all completion data fields
      if (completionData.email !== undefined)
        updateData.email = completionData.email;
      if (completionData.contact_address !== undefined)
        updateData.contact_address = completionData.contact_address;
      if (completionData.date_of_birth)
        updateData.date_of_birth = new Date(completionData.date_of_birth);
      if (completionData.gender !== undefined)
        updateData.gender = completionData.gender;
      if (completionData.state_of_origin !== undefined)
        updateData.state_of_origin = completionData.state_of_origin;
      if (completionData.nationality !== undefined)
        updateData.nationality = completionData.nationality;
      if (completionData.employment_status !== undefined)
        updateData.employment_status = completionData.employment_status;
      if (completionData.marital_status !== undefined)
        updateData.marital_status = completionData.marital_status;

      // Employment fields
      if (completionData.occupation !== undefined)
        updateData.occupation = completionData.occupation;
      if (completionData.job_title !== undefined)
        updateData.job_title = completionData.job_title;
      if (completionData.employer_name !== undefined)
        updateData.employer_name = completionData.employer_name;
      if (completionData.employer_address !== undefined)
        updateData.employer_address = completionData.employer_address;
      if (completionData.monthly_net_income !== undefined)
        updateData.monthly_net_income = completionData.monthly_net_income;
      if (completionData.employer_phone_number !== undefined)
        updateData.employer_phone_number = completionData.employer_phone_number;
      if (completionData.length_of_employment !== undefined)
        updateData.length_of_employment = completionData.length_of_employment;

      // Self-employed fields
      if (completionData.nature_of_business !== undefined)
        updateData.nature_of_business = completionData.nature_of_business;
      if (completionData.business_name !== undefined)
        updateData.business_name = completionData.business_name;
      if (completionData.business_address !== undefined)
        updateData.business_address = completionData.business_address;
      if (completionData.business_duration !== undefined)
        updateData.business_duration = completionData.business_duration;

      // References
      if (completionData.reference1_name !== undefined)
        updateData.reference1_name = completionData.reference1_name;
      if (completionData.reference1_phone_number !== undefined)
        updateData.reference1_phone_number =
          completionData.reference1_phone_number;
      if (completionData.reference1_relationship !== undefined)
        updateData.reference1_relationship =
          completionData.reference1_relationship;
      if (completionData.reference1_address !== undefined)
        updateData.reference1_address = completionData.reference1_address;
      if (completionData.reference1_email !== undefined)
        updateData.reference1_email = completionData.reference1_email;

      if (completionData.reference2_name !== undefined)
        updateData.reference2_name = completionData.reference2_name;
      if (completionData.reference2_phone_number !== undefined)
        updateData.reference2_phone_number =
          completionData.reference2_phone_number;
      if (completionData.reference2_relationship !== undefined)
        updateData.reference2_relationship =
          completionData.reference2_relationship;
      if (completionData.reference2_address !== undefined)
        updateData.reference2_address = completionData.reference2_address;

      // Additional personal information
      if (completionData.religion !== undefined)
        updateData.religion = completionData.religion;

      // Tenancy information
      if (completionData.intended_use_of_property !== undefined)
        updateData.intended_use_of_property =
          completionData.intended_use_of_property;
      if (completionData.number_of_occupants !== undefined)
        updateData.number_of_occupants = completionData.number_of_occupants;
      if (completionData.number_of_cars_owned !== undefined)
        updateData.number_of_cars_owned = completionData.number_of_cars_owned;
      if (completionData.proposed_rent_amount !== undefined)
        updateData.proposed_rent_amount = completionData.proposed_rent_amount;
      if (completionData.rent_payment_frequency !== undefined)
        updateData.rent_payment_frequency =
          completionData.rent_payment_frequency;
      if (completionData.additional_notes !== undefined)
        updateData.additional_notes = completionData.additional_notes;

      // Document URLs
      if (completionData.passport_photo_url !== undefined)
        updateData.passport_photo_url = completionData.passport_photo_url;
      if (completionData.id_document_url !== undefined)
        updateData.id_document_url = completionData.id_document_url;
      if (completionData.employment_proof_url !== undefined)
        updateData.employment_proof_url = completionData.employment_proof_url;
      if (completionData.business_proof_url !== undefined)
        updateData.business_proof_url = completionData.business_proof_url;

      // Save the updated KYC
      await this.kycApplicationRepository.update(kycId, updateData);

      // Fetch the updated KYC with relations
      const updatedKyc = await this.kycApplicationRepository.findOne({
        where: { id: kycId },
        relations: ['property', 'tenant', 'kyc_link'],
      });

      if (!updatedKyc) {
        throw new NotFoundException(
          'Failed to retrieve updated KYC application',
        );
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
        kycId,
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
}

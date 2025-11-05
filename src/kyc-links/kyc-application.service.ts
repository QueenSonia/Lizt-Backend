import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  KYCApplication,
  ApplicationStatus,
} from './entities/kyc-application.entity';
import { KYCLink } from './entities/kyc-link.entity';
import { Property } from '../properties/entities/property.entity';
import { CreateKYCApplicationDto } from './dto/create-kyc-application.dto';

@Injectable()
export class KYCApplicationService {
  constructor(
    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepository: Repository<KYCApplication>,
    @InjectRepository(KYCLink)
    private readonly kycLinkRepository: Repository<KYCLink>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
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

    // Check if user has already submitted an application for this property
    const existingApplication = await this.kycApplicationRepository.findOne({
      where: {
        kyc_link_id: kycLink.id,
        email: kycData.email,
      },
    });

    if (existingApplication) {
      throw new ConflictException(
        'You have already submitted an application for this property',
      );
    }

    // Create new KYC application with automatic pending status
    // Handle optional fields properly to avoid undefined errors (relaxed validation)
    const applicationData: Partial<KYCApplication> = {
      kyc_link_id: kycLink.id,
      property_id: kycLink.property_id,
      status: ApplicationStatus.PENDING,
      // Required fields
      first_name: kycData.first_name,
      last_name: kycData.last_name,
      phone_number: kycData.phone_number,
    };

    // Add optional fields only if they exist
    if (kycData.email) applicationData.email = kycData.email;
    if (kycData.date_of_birth)
      applicationData.date_of_birth = new Date(kycData.date_of_birth);
    if (kycData.gender) applicationData.gender = kycData.gender;
    if (kycData.nationality) applicationData.nationality = kycData.nationality;
    if (kycData.state_of_origin)
      applicationData.state_of_origin = kycData.state_of_origin;
    if (kycData.local_government_area)
      applicationData.local_government_area = kycData.local_government_area;
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
    let whereCondition: any = { property_id: propertyId };

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
      propertyId: application.property_id,
      status: application.status,
      firstName: application.first_name,
      lastName: application.last_name,
      email: application.email,
      phoneNumber: application.phone_number,
      dateOfBirth: application.date_of_birth
        ? application.date_of_birth instanceof Date
          ? application.date_of_birth.toISOString().split('T')[0]
          : new Date(application.date_of_birth).toISOString().split('T')[0]
        : null, // Format as YYYY-MM-DD
      gender: application.gender,
      nationality: application.nationality,
      stateOfOrigin: application.state_of_origin,
      localGovernmentArea: application.local_government_area,
      maritalStatus: application.marital_status,
      employmentStatus: application.employment_status,
      occupation: application.occupation,
      jobTitle: application.job_title,
      employerName: application.employer_name,
      employerAddress: application.employer_address,
      monthlyNetIncome: application.monthly_net_income,
      reference1: {
        name: application.reference1_name,
        relationship: application.reference1_relationship,
        phoneNumber: application.reference1_phone_number,
        email: null, // Not stored in current schema
      },
      reference2: application.reference2_name
        ? {
            name: application.reference2_name,
            relationship: application.reference2_relationship,
            phoneNumber: application.reference2_phone_number,
            email: null, // Not stored in current schema
          }
        : null,
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
    const application = await this.kycApplicationRepository.findOne({
      where: { id: applicationId },
      relations: ['property', 'kyc_link', 'tenant'],
    });

    if (!application) {
      throw new NotFoundException('KYC application not found');
    }

    // Validate that the landlord owns the property
    await this.validatePropertyOwnership(application.property_id, landlordId);

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
      relations: ['property'],
    });

    if (!kycLink) {
      throw new NotFoundException('Invalid KYC token');
    }

    if (!kycLink.is_active) {
      throw new BadRequestException('This KYC form is no longer available');
    }

    if (new Date() > kycLink.expires_at) {
      // Deactivate expired token
      await this.kycLinkRepository.update(kycLink.id, { is_active: false });
      throw new BadRequestException('This KYC form has expired');
    }

    // Check if property still exists and is vacant
    if (!kycLink.property) {
      await this.kycLinkRepository.update(kycLink.id, { is_active: false });
      throw new BadRequestException(
        'Property associated with this KYC form is no longer available',
      );
    }

    return kycLink;
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

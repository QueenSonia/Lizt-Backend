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
    const kycApplication = this.kycApplicationRepository.create({
      kyc_link_id: kycLink.id,
      property_id: kycLink.property_id,
      status: ApplicationStatus.PENDING,
      first_name: kycData.first_name,
      last_name: kycData.last_name,
      email: kycData.email,
      phone_number: kycData.phone_number,
      date_of_birth: new Date(kycData.date_of_birth),
      gender: kycData.gender,
      nationality: kycData.nationality,
      state_of_origin: kycData.state_of_origin,
      local_government_area: kycData.local_government_area,
      marital_status: kycData.marital_status,
      employment_status: kycData.employment_status,
      occupation: kycData.occupation,
      job_title: kycData.job_title,
      employer_name: kycData.employer_name,
      employer_address: kycData.employer_address,
      monthly_net_income: kycData.monthly_net_income,
      reference1_name: kycData.reference1_name,
      reference1_address: kycData.reference1_address,
      reference1_relationship: kycData.reference1_relationship,
      reference1_phone_number: kycData.reference1_phone_number,
      reference2_name: kycData.reference2_name,
      reference2_address: kycData.reference2_address,
      reference2_relationship: kycData.reference2_relationship,
      reference2_phone_number: kycData.reference2_phone_number,
    });

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
   */
  async getApplicationsByProperty(
    propertyId: string,
    landlordId: string,
  ): Promise<KYCApplication[]> {
    // Validate property ownership
    await this.validatePropertyOwnership(propertyId, landlordId);

    // Get all applications for the property with sorting
    const applications = await this.kycApplicationRepository.find({
      where: { property_id: propertyId },
      relations: ['property', 'kyc_link', 'tenant'],
      order: {
        created_at: 'DESC', // Most recent applications first
        status: 'ASC', // Pending applications first within same date
      },
    });

    return applications;
  }

  /**
   * Get applications by property with filtering and sorting options
   * Requirements: 4.1, 4.2, 4.3
   */
  async getApplicationsByPropertyWithFilters(
    propertyId: string,
    landlordId: string,
    filters?: {
      status?: ApplicationStatus;
      sortBy?: 'created_at' | 'first_name' | 'status';
      sortOrder?: 'ASC' | 'DESC';
    },
  ): Promise<KYCApplication[]> {
    // Validate property ownership
    await this.validatePropertyOwnership(propertyId, landlordId);

    const queryBuilder = this.kycApplicationRepository
      .createQueryBuilder('application')
      .leftJoinAndSelect('application.property', 'property')
      .leftJoinAndSelect('application.kyc_link', 'kyc_link')
      .leftJoinAndSelect('application.tenant', 'tenant')
      .where('application.property_id = :propertyId', { propertyId });

    // Apply status filter if provided
    if (filters?.status) {
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

    return await queryBuilder.getMany();
  }

  /**
   * Get a specific KYC application by ID (with landlord authorization)
   * Requirements: 4.1, 4.2, 4.3
   */
  async getApplicationById(
    applicationId: string,
    landlordId: string,
  ): Promise<KYCApplication> {
    const application = await this.kycApplicationRepository.findOne({
      where: { id: applicationId },
      relations: ['property', 'kyc_link', 'tenant'],
    });

    if (!application) {
      throw new NotFoundException('KYC application not found');
    }

    // Validate that the landlord owns the property
    await this.validatePropertyOwnership(application.property_id, landlordId);

    return application;
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
    // Validate property ownership
    await this.validatePropertyOwnership(propertyId, landlordId);

    const [total, pending, approved, rejected] = await Promise.all([
      this.kycApplicationRepository.count({
        where: { property_id: propertyId },
      }),
      this.kycApplicationRepository.count({
        where: { property_id: propertyId, status: ApplicationStatus.PENDING },
      }),
      this.kycApplicationRepository.count({
        where: { property_id: propertyId, status: ApplicationStatus.APPROVED },
      }),
      this.kycApplicationRepository.count({
        where: { property_id: propertyId, status: ApplicationStatus.REJECTED },
      }),
    ]);

    return { total, pending, approved, rejected };
  }

  /**
   * Get KYC applications by tenant ID (landlord access only)
   * Requirements: 4.5, 6.4
   */
  async getApplicationsByTenant(
    tenantId: string,
    landlordId: string,
  ): Promise<KYCApplication[]> {
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

    return applications;
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

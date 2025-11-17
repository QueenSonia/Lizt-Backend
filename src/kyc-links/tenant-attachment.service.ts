import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  KYCApplication,
  ApplicationStatus,
} from './entities/kyc-application.entity';
import { KYCLink } from './entities/kyc-link.entity';
import { Property } from '../properties/entities/property.entity';
import { PropertyTenant } from '../properties/entities/property-tenants.entity';
import { PropertyHistory } from '../property-history/entities/property-history.entity';
import { Rent } from '../rents/entities/rent.entity';
import { Account } from '../users/entities/account.entity';
import { Users } from '../users/entities/user.entity';
import { TenantKyc } from '../tenant-kyc/entities/tenant-kyc.entity';
import { AttachTenantDto, RentFrequency } from './dto/attach-tenant.dto';
import {
  PropertyStatusEnum,
  TenantStatusEnum,
} from '../properties/dto/create-property.dto';
import {
  RentStatusEnum,
  RentPaymentStatusEnum,
} from '../rents/dto/create-rent.dto';
import { DateService } from '../utils/date.helper';
import { RolesEnum } from '../base.entity';
import { WhatsappBotService } from '../whatsapp-bot/whatsapp-bot.service';
import { UtilService } from '../utils/utility-service';

@Injectable()
export class TenantAttachmentService {
  constructor(
    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepository: Repository<KYCApplication>,
    @InjectRepository(KYCLink)
    private readonly kycLinkRepository: Repository<KYCLink>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepository: Repository<PropertyHistory>,
    @InjectRepository(Rent)
    private readonly rentRepository: Repository<Rent>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    @InjectRepository(TenantKyc)
    private readonly tenantKycRepository: Repository<TenantKyc>,
    private readonly dataSource: DataSource,
    private readonly whatsappBotService: WhatsappBotService,
    private readonly utilService: UtilService,
  ) {}

  /**
   * Attach tenant to property with tenancy details
   * Requirements: 5.1, 5.2, 5.4, 5.5
   */
  async attachTenantToProperty(
    applicationId: string,
    tenancyDetails: AttachTenantDto,
    landlordId: string,
  ): Promise<{
    success: boolean;
    tenantId: string;
    propertyId: string;
    message: string;
  }> {
    console.log('Attaching tenant with data:', {
      applicationId,
      tenancyDetails,
      landlordId,
    });

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Get the KYC application with relations
      const application = await queryRunner.manager.findOne(KYCApplication, {
        where: { id: applicationId },
        relations: ['property', 'kyc_link'],
      });

      console.log('Found KYC application:', {
        id: application?.id,
        first_name: application?.first_name,
        last_name: application?.last_name,
        email: application?.email,
        phone_number: application?.phone_number,
        date_of_birth: application?.date_of_birth,
        gender: application?.gender,
        nationality: application?.nationality,
        marital_status: application?.marital_status,
        employment_status: application?.employment_status,
      });

      if (!application) {
        throw new NotFoundException('KYC application not found');
      }

      // Validate property ownership
      if (application.property.owner_id !== landlordId) {
        throw new ForbiddenException(
          'You are not authorized to attach tenants to this property',
        );
      }

      // Validate application status
      if (application.status !== ApplicationStatus.PENDING) {
        throw new BadRequestException(
          'Only pending applications can be used for tenant attachment',
        );
      }

      // Validate property status
      if (
        application.property.property_status === PropertyStatusEnum.OCCUPIED
      ) {
        throw new ConflictException(
          'Property is already occupied. Cannot attach another tenant.',
        );
      }

      // Validate tenancy details
      this.validateTenancyDetails(tenancyDetails);

      // Create or get tenant account
      const tenantAccount = await this.createOrGetTenantAccount(
        application,
        queryRunner.manager,
      );

      // CRITICAL: Clean up any existing tenant assignments before creating new ones
      // This prevents orphaned rent records and duplicate tenant assignments
      await this.cleanupExistingTenantAssignments(
        tenantAccount.id,
        queryRunner.manager,
      );

      // Calculate lease dates
      const tenancyStartDate = tenancyDetails.tenancyStartDate
        ? new Date(tenancyDetails.tenancyStartDate)
        : new Date();

      const leaseEndDate = this.calculateLeaseEndDate(
        tenancyStartDate,
        tenancyDetails.rentFrequency,
      );

      // Create rent record
      const rent = queryRunner.manager.create(Rent, {
        tenant_id: tenantAccount.id,
        property_id: application.property_id,
        lease_start_date: tenancyStartDate,
        lease_end_date: leaseEndDate,
        rental_price: tenancyDetails.rentAmount,
        security_deposit: tenancyDetails.securityDeposit || 0,
        service_charge: tenancyDetails.serviceCharge || 0,
        payment_frequency: this.mapRentFrequencyToPaymentFrequency(
          tenancyDetails.rentFrequency,
        ),
        rent_status: RentStatusEnum.ACTIVE,
        payment_status: RentPaymentStatusEnum.PENDING,
        amount_paid: 0,
      });

      await queryRunner.manager.save(rent);

      // Create property-tenant relationship
      const propertyTenant = queryRunner.manager.create(PropertyTenant, {
        property_id: application.property_id,
        tenant_id: tenantAccount.id,
        status: TenantStatusEnum.ACTIVE,
      });

      await queryRunner.manager.save(propertyTenant);

      // Update property status to OCCUPIED
      await queryRunner.manager.update(Property, application.property_id, {
        property_status: PropertyStatusEnum.OCCUPIED,
      });

      // Create property history record
      const propertyHistory = queryRunner.manager.create(PropertyHistory, {
        property_id: application.property_id,
        tenant_id: tenantAccount.id,
        move_in_date: DateService.getStartOfTheDay(tenancyStartDate),
        monthly_rent: tenancyDetails.rentAmount,
        owner_comment: `Tenant attached via KYC application ${applicationId}`,
        tenant_comment: null,
        move_out_date: null,
        move_out_reason: null,
      });

      await queryRunner.manager.save(propertyHistory);

      // Update application status to APPROVED and link to tenant
      await queryRunner.manager.update(KYCApplication, applicationId, {
        status: ApplicationStatus.APPROVED,
        tenant_id: tenantAccount.id,
      });

      // Reject all other pending applications for this property
      await this.rejectOtherApplications(
        application.property_id,
        applicationId,
        queryRunner.manager,
      );

      // Deactivate KYC links for this property
      await this.deactivateKYCLinks(
        application.property_id,
        queryRunner.manager,
      );

      // CRITICAL: Verify data integrity before committing
      console.log('Verifying data integrity before commit...');

      const verifyPropertyTenant = await queryRunner.manager.findOne(
        PropertyTenant,
        {
          where: {
            property_id: application.property_id,
            tenant_id: tenantAccount.id,
            status: TenantStatusEnum.ACTIVE,
          },
        },
      );

      const verifyRent = await queryRunner.manager.findOne(Rent, {
        where: {
          property_id: application.property_id,
          tenant_id: tenantAccount.id,
          rent_status: RentStatusEnum.ACTIVE,
        },
      });

      const verifyProperty = await queryRunner.manager.findOne(Property, {
        where: { id: application.property_id },
      });

      const verifyApplication = await queryRunner.manager.findOne(
        KYCApplication,
        {
          where: { id: applicationId },
        },
      );

      // Validate all critical records were created/updated correctly
      if (!verifyPropertyTenant) {
        throw new Error(
          'Data integrity check failed: PropertyTenant relationship not created',
        );
      }

      if (!verifyRent) {
        throw new Error('Data integrity check failed: Rent record not created');
      }

      if (
        !verifyProperty ||
        verifyProperty.property_status !== PropertyStatusEnum.OCCUPIED
      ) {
        throw new Error(
          `Data integrity check failed: Property status is ${verifyProperty?.property_status}, expected OCCUPIED`,
        );
      }

      if (
        !verifyApplication ||
        verifyApplication.status !== ApplicationStatus.APPROVED
      ) {
        throw new Error(
          `Data integrity check failed: Application status is ${verifyApplication?.status}, expected APPROVED`,
        );
      }

      if (
        !verifyApplication.tenant_id ||
        verifyApplication.tenant_id !== tenantAccount.id
      ) {
        throw new Error(
          'Data integrity check failed: Application not linked to tenant',
        );
      }

      console.log('Data integrity verification passed:', {
        propertyTenantId: verifyPropertyTenant.id,
        rentId: verifyRent.id,
        propertyStatus: verifyProperty.property_status,
        applicationStatus: verifyApplication.status,
        tenantLinked: verifyApplication.tenant_id === tenantAccount.id,
      });

      await queryRunner.commitTransaction();

      console.log('Tenant attachment completed successfully:', {
        tenantId: tenantAccount.id,
        propertyId: application.property_id,
        applicationId: applicationId,
      });

      // Send WhatsApp notification to tenant after successful attachment
      try {
        await this.sendTenantAttachmentWhatsAppNotification(
          tenantAccount,
          application,
          tenancyDetails,
          tenancyStartDate,
        );
      } catch (whatsappError) {
        // Log WhatsApp error but don't fail the entire operation
        console.error(
          'Failed to send WhatsApp notification to tenant:',
          whatsappError,
        );
        // Continue with success response even if WhatsApp fails
      }

      return {
        success: true,
        tenantId: tenantAccount.id,
        propertyId: application.property_id,
        message: 'Tenant successfully attached to property',
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('Tenant attachment error:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        detail: error.detail,
        constraint: error.constraint,
        table: error.table,
        column: error.column,
      });
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Reject all other applications for a property when one is approved
   * Requirements: 6.1, 6.2, 6.4
   */
  private async rejectOtherApplications(
    propertyId: string,
    excludeApplicationId: string,
    manager: any,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(KYCApplication)
      .set({ status: ApplicationStatus.REJECTED })
      .where('property_id = :propertyId', { propertyId })
      .andWhere('status = :status', { status: ApplicationStatus.PENDING })
      .andWhere('id != :excludeApplicationId', { excludeApplicationId })
      .execute();
  }

  /**
   * Deactivate KYC links when property becomes occupied
   * Requirements: 5.5, 6.3, 6.4
   */
  private async deactivateKYCLinks(
    propertyId: string,
    manager: any,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(KYCLink)
      .set({ is_active: false })
      .where('property_id = :propertyId', { propertyId })
      .andWhere('is_active = :isActive', { isActive: true })
      .execute();
  }

  /**
   * Create or get tenant account from KYC application data
   * FIXED: Always update existing accounts with latest KYC data
   * Requirements: 5.1, 5.2
   */
  private async createOrGetTenantAccount(
    application: KYCApplication,
    manager: any,
  ): Promise<Account> {
    let tenantAccount: Account | null = null;
    let existingUser: Users | null = null;

    // Strategy 1: Try to find TENANT account by email (only if email was provided and not empty)
    // IMPORTANT: We specifically look for TENANT role since users can have multiple accounts with different roles
    if (application.email && application.email.trim() !== '') {
      tenantAccount = await manager.findOne(Account, {
        where: { email: application.email, role: RolesEnum.TENANT },
        relations: ['user'],
      });

      if (tenantAccount) {
        existingUser = tenantAccount.user;
        console.log(
          `Found existing TENANT account by email: ${application.email}`,
        );
      }
    }

    // Strategy 2: Try to find by phone number (if not found by email)
    if (!tenantAccount && application.phone_number) {
      existingUser = await manager.findOne(Users, {
        where: { phone_number: application.phone_number },
      });

      if (existingUser) {
        console.log(
          `Found existing user by phone: ${application.phone_number}`,
        );

        // CRITICAL: Find or create TENANT account for this user
        // A user can have multiple accounts with different roles (landlord, tenant, etc.)
        tenantAccount = await manager.findOne(Account, {
          where: { userId: existingUser.id, role: RolesEnum.TENANT },
          relations: ['user'],
        });

        // If user exists but doesn't have a TENANT account, create one
        if (!tenantAccount) {
          console.log(
            `User ${existingUser.id} exists but has no TENANT account. Creating TENANT account...`,
          );

          const emailToUse =
            application.email && application.email.trim() !== ''
              ? application.email
              : existingUser.email;

          tenantAccount = manager.create(Account, {
            email: emailToUse,
            userId: existingUser.id,
            role: RolesEnum.TENANT,
            is_verified: false,
            password: null,
          });

          const savedTenantAccount = await manager.save(tenantAccount);
          console.log(
            `Created TENANT account ${savedTenantAccount.id} for existing user ${existingUser.id}`,
          );
          savedTenantAccount.user = existingUser;
          tenantAccount = savedTenantAccount;
        }
      }
    }

    // If account exists, UPDATE it with the latest KYC data
    if (tenantAccount && existingUser) {
      console.log(
        `Updating existing user ${existingUser.id} with new KYC data from application ${application.id}`,
      );

      // Prepare email value - use new email if provided, otherwise keep existing
      const emailToUse =
        application.email && application.email.trim() !== ''
          ? application.email
          : existingUser.email;

      // Update Users table with latest KYC data
      await manager.update(Users, existingUser.id, {
        first_name: application.first_name,
        last_name: application.last_name,
        email: emailToUse,
        phone_number: application.phone_number,
        date_of_birth: application.date_of_birth || existingUser.date_of_birth,
        gender: application.gender || existingUser.gender,
        nationality: application.nationality || existingUser.nationality,
        state_of_origin:
          application.state_of_origin || existingUser.state_of_origin,
        lga: existingUser.lga, // Keep existing LGA, not collected in new KYC form
        marital_status:
          application.marital_status || existingUser.marital_status,
      });

      console.log('Updated user data:', {
        userId: existingUser.id,
        first_name: application.first_name,
        last_name: application.last_name,
        email: emailToUse,
        phone_number: application.phone_number,
      });

      // Update Account table if email changed
      if (tenantAccount && emailToUse !== tenantAccount.email) {
        await manager.update(Account, tenantAccount.id, {
          email: emailToUse,
        });
        console.log(
          `Updated account email from ${tenantAccount.email} to ${emailToUse}`,
        );
      }

      // Reload the account with updated data
      const reloadedAccount = await manager.findOne(Account, {
        where: { id: tenantAccount.id },
        relations: ['user'],
      });

      if (!reloadedAccount) {
        throw new Error(
          `Failed to reload account ${tenantAccount.id} after update`,
        );
      }

      // Update or create TenantKyc record with latest data
      await this.updateOrCreateTenantKyc(application, existingUser.id, manager);

      return reloadedAccount;
    }

    // If no existing account, create new one
    console.log('Creating new user and account from KYC data');

    // Generate placeholder email if not provided
    const emailToUse =
      application.email && application.email.trim() !== ''
        ? application.email
        : `tenant_${application.phone_number}@placeholder.lizt.app`;

    const newUser = manager.create(Users, {
      first_name: application.first_name,
      last_name: application.last_name,
      email: emailToUse,
      phone_number: application.phone_number,
      date_of_birth: application.date_of_birth,
      gender: application.gender,
      nationality: application.nationality,
      state_of_origin: application.state_of_origin,
      lga: '', // LGA not collected in new KYC form
      marital_status: application.marital_status,
      role: RolesEnum.TENANT,
      is_verified: false,
    });

    console.log('Creating new user with data:', {
      first_name: application.first_name,
      last_name: application.last_name,
      email: emailToUse,
      phone_number: application.phone_number,
      isPlaceholderEmail: !application.email || application.email.trim() === '',
    });

    const savedUser = await manager.save(newUser);
    console.log('User created successfully:', savedUser.id);

    tenantAccount = manager.create(Account, {
      email: emailToUse,
      userId: savedUser.id,
      role: RolesEnum.TENANT,
      is_verified: false,
      password: null, // Tenant will set password when they first log in
    });

    const savedAccount = await manager.save(tenantAccount);
    console.log('Account created successfully:', savedAccount.id);
    savedAccount.user = savedUser;

    // Create TenantKyc record
    await this.updateOrCreateTenantKyc(application, savedUser.id, manager);

    return savedAccount;
  }

  /**
   * Update or create TenantKyc record with latest KYC data
   * This ensures TenantKyc always has the most recent data for this landlord
   * Requirements: 5.1, 5.2
   */
  private async updateOrCreateTenantKyc(
    application: KYCApplication,
    userId: string,
    manager: any,
  ): Promise<void> {
    // Find existing TenantKyc for this user and landlord
    const existingTenantKyc = await manager.findOne(TenantKyc, {
      where: {
        user_id: userId,
        admin_id: application.property.owner_id,
      },
    });

    // Prepare email - use application email if provided, otherwise empty string
    const emailToUse =
      application.email && application.email.trim() !== ''
        ? application.email
        : '';

    const tenantKycData = {
      first_name: application.first_name,
      last_name: application.last_name,
      email: emailToUse,
      phone_number: application.phone_number,
      date_of_birth: application.date_of_birth || new Date('1990-01-01'),
      gender: application.gender || 'other',
      nationality: application.nationality || 'Nigerian',
      current_residence: '',
      state_of_origin: application.state_of_origin || '',
      marital_status: application.marital_status || 'single',
      employment_status: application.employment_status || 'employed',
      occupation: application.occupation || '——',
      job_title: application.job_title || '——',
      employer_name: application.employer_name || '',
      employer_address: application.employer_address || '',
      monthly_net_income: application.monthly_net_income || '0',
      reference1_name: application.reference1_name || '',
      reference1_address: application.reference1_address || '',
      reference1_relationship: application.reference1_relationship || '',
      reference1_phone_number: application.reference1_phone_number || '',
      reference2_name: application.reference2_name || '',
      reference2_address: application.reference2_address || '',
      reference2_relationship: application.reference2_relationship || '',
      reference2_phone_number: application.reference2_phone_number || '',
    };

    if (existingTenantKyc) {
      // Update existing record with latest data
      console.log(
        `Updating existing TenantKyc record ${existingTenantKyc.id} for user ${userId}`,
      );
      await manager.update(TenantKyc, existingTenantKyc.id, tenantKycData);
    } else {
      // Create new record
      console.log(
        `Creating new TenantKyc record for user ${userId} and landlord ${application.property.owner_id}`,
      );

      // Generate a shorter identity hash
      // Format: first 20 chars of name + last 10 of phone + date (max 64 chars total)
      const nameHash = `${application.first_name}_${application.last_name}`
        .toLowerCase()
        .replace(/\s+/g, '_')
        .substring(0, 20); // Limit name to 20 chars
      const phoneHash = application.phone_number.slice(-10); // Last 10 digits
      const dateStr = application.date_of_birth
        ? application.date_of_birth.toString()
        : '1990-01-01';
      const dateHash = dateStr.replace(/-/g, ''); // YYYYMMDD format
      const identityHash = `${nameHash}_${phoneHash}_${dateHash}`.substring(
        0,
        64,
      ); // Ensure max 64 chars

      const tenantKyc = manager.create(TenantKyc, {
        ...tenantKycData,
        user_id: userId,
        admin_id: application.property.owner_id,
        identity_hash: identityHash,
      });

      await manager.save(tenantKyc);
    }
  }

  /**
   * Validate tenancy details
   * Requirements: 5.1, 5.2
   */
  private validateTenancyDetails(tenancyDetails: AttachTenantDto): void {
    if (tenancyDetails.rentAmount <= 0) {
      throw new BadRequestException('Rent amount must be greater than 0');
    }

    if (tenancyDetails.rentDueDate < 1 || tenancyDetails.rentDueDate > 31) {
      throw new BadRequestException('Rent due date must be between 1 and 31');
    }

    // Tenancy start date validation removed - allow past dates

    if (tenancyDetails.securityDeposit && tenancyDetails.securityDeposit < 0) {
      throw new BadRequestException('Security deposit cannot be negative');
    }

    if (tenancyDetails.serviceCharge && tenancyDetails.serviceCharge < 0) {
      throw new BadRequestException('Service charge cannot be negative');
    }
  }

  /**
   * Calculate lease end date based on rent frequency
   * Requirements: 5.1, 5.2
   */
  private calculateLeaseEndDate(
    startDate: Date,
    frequency: RentFrequency,
  ): Date {
    const endDate = new Date(startDate);

    switch (frequency) {
      case RentFrequency.MONTHLY:
        endDate.setFullYear(endDate.getFullYear() + 1); // Default 1 year lease
        break;
      case RentFrequency.QUARTERLY:
        endDate.setFullYear(endDate.getFullYear() + 1);
        break;
      case RentFrequency.BI_ANNUALLY:
        endDate.setFullYear(endDate.getFullYear() + 1);
        break;
      case RentFrequency.ANNUALLY:
        endDate.setFullYear(endDate.getFullYear() + 1);
        break;
      default:
        endDate.setFullYear(endDate.getFullYear() + 1);
    }

    return endDate;
  }

  /**
   * Map RentFrequency enum to payment frequency string
   * Requirements: 5.1, 5.2
   */
  private mapRentFrequencyToPaymentFrequency(frequency: RentFrequency): string {
    switch (frequency) {
      case RentFrequency.MONTHLY:
        return 'Monthly';
      case RentFrequency.QUARTERLY:
        return 'Quarterly';
      case RentFrequency.BI_ANNUALLY:
        return 'Bi-annually';
      case RentFrequency.ANNUALLY:
        return 'Annually';
      default:
        return 'Monthly';
    }
  }

  /**
   * Clean up existing tenant assignments to prevent orphaned records
   * This method ensures a tenant can only be assigned to one property at a time
   * Requirements: Data integrity, prevent duplicate tenant assignments
   */
  private async cleanupExistingTenantAssignments(
    tenantId: string,
    manager: any,
  ): Promise<void> {
    console.log(`Cleaning up existing assignments for tenant: ${tenantId}`);

    try {
      // 1. Find all existing active rent records for this tenant
      const existingRents = await manager.find(Rent, {
        where: {
          tenant_id: tenantId,
          rent_status: RentStatusEnum.ACTIVE,
        },
        relations: ['property'],
      });

      console.log(
        `Found ${existingRents.length} existing active rent records for tenant ${tenantId}`,
      );

      // 2. For each existing rent record, clean up the assignment
      for (const rent of existingRents) {
        console.log(
          `Cleaning up rent record ${rent.id} for property ${rent.property_id}`,
        );

        // Deactivate the rent record
        await manager.update(Rent, rent.id, {
          rent_status: RentStatusEnum.INACTIVE,
          payment_status: RentPaymentStatusEnum.OWING,
        });

        // Deactivate property-tenant relationship
        await manager.update(
          PropertyTenant,
          {
            tenant_id: tenantId,
            property_id: rent.property_id,
            status: TenantStatusEnum.ACTIVE,
          },
          { status: TenantStatusEnum.INACTIVE },
        );

        // Update property status back to VACANT if it was OCCUPIED
        const property = await manager.findOne(Property, {
          where: { id: rent.property_id },
        });

        if (
          property &&
          property.property_status === PropertyStatusEnum.OCCUPIED
        ) {
          await manager.update(Property, rent.property_id, {
            property_status: PropertyStatusEnum.VACANT,
          });

          console.log(`Updated property ${rent.property_id} status to VACANT`);
        }

        // Create property history record for the move-out
        const propertyHistory = manager.create(PropertyHistory, {
          property_id: rent.property_id,
          tenant_id: tenantId,
          move_in_date: rent.lease_start_date,
          move_out_date: DateService.getStartOfTheDay(new Date()),
          move_out_reason: 'other',
          monthly_rent: rent.rental_price,
          owner_comment: 'Tenant reassigned to another property via KYC system',
          tenant_comment: null,
        });

        await manager.save(propertyHistory);

        console.log(
          `Created move-out history record for property ${rent.property_id}`,
        );
      }

      console.log(
        `Successfully cleaned up ${existingRents.length} existing assignments for tenant ${tenantId}`,
      );
    } catch (error) {
      console.error(
        `Error cleaning up existing tenant assignments for tenant ${tenantId}:`,
        error,
      );
      throw new Error(
        `Failed to clean up existing tenant assignments: ${error.message}`,
      );
    }
  }

  /**
   * Fix existing data inconsistencies - can be called manually to clean up orphaned records
   * This method should be run as a one-time cleanup for existing data
   */
  async fixExistingDataInconsistencies(): Promise<{
    success: boolean;
    message: string;
    cleanedUpTenants: number;
    cleanedUpProperties: number;
  }> {
    console.log('Starting cleanup of existing data inconsistencies...');

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      let cleanedUpTenants = 0;
      let cleanedUpProperties = 0;

      // Find all tenants with multiple active rent records
      const duplicateTenants = await queryRunner.manager
        .createQueryBuilder(Rent, 'rent')
        .select('rent.tenant_id')
        .addSelect('COUNT(*)', 'count')
        .where('rent.rent_status = :status', { status: RentStatusEnum.ACTIVE })
        .groupBy('rent.tenant_id')
        .having('COUNT(*) > 1')
        .getRawMany();

      console.log(
        `Found ${duplicateTenants.length} tenants with multiple active rent records`,
      );

      // For each tenant with duplicates, keep only the most recent assignment
      for (const duplicate of duplicateTenants) {
        const tenantId = duplicate.rent_tenant_id;

        // Get all active rent records for this tenant, ordered by creation date
        const tenantRents = await queryRunner.manager.find(Rent, {
          where: {
            tenant_id: tenantId,
            rent_status: RentStatusEnum.ACTIVE,
          },
          order: { created_at: 'DESC' },
        });

        if (tenantRents.length > 1) {
          // Keep the most recent rent record, deactivate the rest
          const [mostRecent, ...oldRents] = tenantRents;

          console.log(
            `Tenant ${tenantId}: Keeping rent ${mostRecent.id}, deactivating ${oldRents.length} old records`,
          );

          for (const oldRent of oldRents) {
            // Deactivate old rent record
            await queryRunner.manager.update(Rent, oldRent.id, {
              rent_status: RentStatusEnum.INACTIVE,
              payment_status: RentPaymentStatusEnum.OWING,
            });

            // Deactivate old property-tenant relationship
            await queryRunner.manager.update(
              PropertyTenant,
              {
                tenant_id: tenantId,
                property_id: oldRent.property_id,
                status: TenantStatusEnum.ACTIVE,
              },
              { status: TenantStatusEnum.INACTIVE },
            );

            // Update old property status to VACANT
            await queryRunner.manager.update(Property, oldRent.property_id, {
              property_status: PropertyStatusEnum.VACANT,
            });

            // Create move-out history record
            const propertyHistory = queryRunner.manager.create(
              PropertyHistory,
              {
                property_id: oldRent.property_id,
                tenant_id: tenantId,
                move_in_date: oldRent.lease_start_date,
                move_out_date: DateService.getStartOfTheDay(new Date()),
                move_out_reason: 'data_cleanup',
                monthly_rent: oldRent.rental_price,
                owner_comment:
                  'Cleaned up duplicate tenant assignment during data consistency fix',
                tenant_comment: null,
              },
            );

            await queryRunner.manager.save(propertyHistory);
            cleanedUpProperties++;
          }

          cleanedUpTenants++;
        }
      }

      // Also check for properties marked as OCCUPIED but with no active rent records
      const occupiedPropertiesWithoutRent = await queryRunner.manager
        .createQueryBuilder(Property, 'property')
        .leftJoin(
          Rent,
          'rent',
          'rent.property_id = property.id AND rent.rent_status = :status',
          { status: RentStatusEnum.ACTIVE },
        )
        .where('property.property_status = :occupied', {
          occupied: PropertyStatusEnum.OCCUPIED,
        })
        .andWhere('rent.id IS NULL')
        .getMany();

      console.log(
        `Found ${occupiedPropertiesWithoutRent.length} occupied properties without active rent records`,
      );

      // Fix these properties by setting them to VACANT
      for (const property of occupiedPropertiesWithoutRent) {
        await queryRunner.manager.update(Property, property.id, {
          property_status: PropertyStatusEnum.VACANT,
        });
        console.log(
          `Fixed property ${property.id}: changed from OCCUPIED to VACANT`,
        );
        cleanedUpProperties++;
      }

      await queryRunner.commitTransaction();

      const message = `Data cleanup completed successfully. Cleaned up ${cleanedUpTenants} tenants with duplicate assignments and ${cleanedUpProperties} properties with inconsistent status.`;
      console.log(message);

      return {
        success: true,
        message,
        cleanedUpTenants,
        cleanedUpProperties,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('Error during data cleanup:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Send WhatsApp notification to tenant after successful attachment
   * Uses existing 'tenant_welcome' WhatsApp template
   */
  private async sendTenantAttachmentWhatsAppNotification(
    tenantAccount: Account,
    application: KYCApplication,
    tenancyDetails: AttachTenantDto,
    tenancyStartDate: Date,
  ): Promise<void> {
    try {
      // Validate phone number
      const phoneNumber = tenantAccount.user.phone_number;
      if (!phoneNumber) {
        console.warn(
          `No phone number found for tenant ${tenantAccount.id}, skipping WhatsApp notification`,
        );
        return;
      }

      // Normalize phone number to international format
      const normalizedPhone =
        this.utilService.normalizePhoneNumber(phoneNumber);
      if (!normalizedPhone) {
        console.warn(
          `Invalid phone number format for tenant ${tenantAccount.id}: ${phoneNumber}`,
        );
        return;
      }

      // Get landlord/agency information
      const landlord = await this.accountRepository.findOne({
        where: { id: application.property.owner_id },
        relations: ['user'],
      });

      // Use agency name (profile_name) if available, otherwise fallback to personal name
      const agencyName = landlord?.profile_name
        ? landlord.profile_name
        : landlord?.user
          ? `${this.utilService.toSentenceCase(landlord.user.first_name)} ${this.utilService.toSentenceCase(landlord.user.last_name)}`
          : 'Your Landlord';

      // Format tenant name
      const tenantName = `${this.utilService.toSentenceCase(tenantAccount.user.first_name)} ${this.utilService.toSentenceCase(tenantAccount.user.last_name)}`;

      // Property name
      const propertyName = application.property.name;

      console.log('Sending tenant attachment WhatsApp notification:', {
        phoneNumber: normalizedPhone,
        tenantName,
        propertyName,
        agencyName,
      });

      // Send WhatsApp notification using existing tenant_welcome template
      await this.whatsappBotService.sendTenantAttachmentNotification({
        phone_number: normalizedPhone,
        tenant_name: tenantName,
        landlord_name: agencyName,
        property_name: propertyName,
      });

      console.log(
        `WhatsApp notification sent successfully to tenant ${tenantAccount.id} at ${normalizedPhone}`,
      );
    } catch (error) {
      console.error('Error sending tenant attachment WhatsApp notification:', {
        error: error.message,
        stack: error.stack,
        tenantId: tenantAccount.id,
      });
      // Don't throw - we don't want to fail the entire operation if WhatsApp fails
    }
  }

  /**
   * Format rent frequency for user-friendly display
   */
  private formatRentFrequencyForDisplay(frequency: RentFrequency): string {
    switch (frequency) {
      case RentFrequency.MONTHLY:
        return 'Monthly';
      case RentFrequency.QUARTERLY:
        return 'Quarterly';
      case RentFrequency.BI_ANNUALLY:
        return 'Bi-Annually';
      case RentFrequency.ANNUALLY:
        return 'Annually';
      default:
        return 'Monthly';
    }
  }
}

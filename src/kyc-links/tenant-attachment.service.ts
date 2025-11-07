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

      await queryRunner.commitTransaction();

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
   * Requirements: 5.1, 5.2
   */
  private async createOrGetTenantAccount(
    application: KYCApplication,
    manager: any,
  ): Promise<Account> {
    // Check if account already exists with this email
    let tenantAccount = await manager.findOne(Account, {
      where: { email: application.email },
      relations: ['user'],
    });

    // Also check if user exists with this phone number
    if (!tenantAccount && application.phone_number) {
      const existingUser = await manager.findOne(Users, {
        where: { phone_number: application.phone_number },
      });

      if (existingUser) {
        // Find account for this user
        tenantAccount = await manager.findOne(Account, {
          where: { userId: existingUser.id },
          relations: ['user'],
        });
      }
    }

    if (!tenantAccount) {
      // Create new user and account from KYC data
      const newUser = manager.create(Users, {
        first_name: application.first_name,
        last_name: application.last_name,
        email: application.email,
        phone_number: application.phone_number,
        date_of_birth: application.date_of_birth,
        gender: application.gender,
        nationality: application.nationality,
        state_of_origin: application.state_of_origin,
        lga: application.local_government_area, // Note: field name is 'lga' in Users entity
        marital_status: application.marital_status,
        role: RolesEnum.TENANT,
        is_verified: false,
      });

      console.log('Creating new user with data:', {
        first_name: application.first_name,
        last_name: application.last_name,
        email: application.email,
        phone_number: application.phone_number,
      });

      const savedUser = await manager.save(newUser);
      console.log('User created successfully:', savedUser.id);

      tenantAccount = manager.create(Account, {
        email: application.email,
        userId: savedUser.id,
        role: RolesEnum.TENANT,
        is_verified: false,
        password: null, // Tenant will set password when they first log in
      });

      console.log('Creating account for user:', savedUser.id);
      tenantAccount = await manager.save(tenantAccount);
      console.log('Account created successfully:', tenantAccount.id);
      tenantAccount.user = savedUser;

      // Create TenantKyc record with the same data for consistency
      const identityHash =
        `${application.first_name}_${application.last_name}_${application.date_of_birth || '1990-01-01'}_${application.email}_${application.phone_number}`
          .toLowerCase()
          .replace(/\s+/g, '_');

      // Check if TenantKyc record already exists with this identity hash
      const existingTenantKycByHash = await manager.findOne(TenantKyc, {
        where: { identity_hash: identityHash },
      });

      if (!existingTenantKycByHash) {
        const tenantKyc = manager.create(TenantKyc, {
          first_name: application.first_name,
          last_name: application.last_name,
          email: application.email,
          phone_number: application.phone_number,
          date_of_birth: application.date_of_birth || new Date('1990-01-01'), // Default date if null
          gender: application.gender || 'other', // Default gender if null
          nationality: application.nationality || 'Nigerian', // Default nationality if null
          current_residence: '', // KYC application doesn't have this field
          state_of_origin: application.state_of_origin,
          local_government_area: application.local_government_area,
          marital_status: application.marital_status || 'single', // Default marital status if null
          employment_status: application.employment_status || 'employed', // Default employment status if null
          occupation: application.occupation || '——',
          job_title: application.job_title || '——',
          employer_name: application.employer_name,
          employer_address: application.employer_address,
          monthly_net_income: application.monthly_net_income || '0',
          reference1_name: '', // These would need to be added to KYC application if needed
          reference1_address: '',
          reference1_relationship: '',
          reference1_phone_number: '',
          user_id: savedUser.id,
          admin_id: application.property.owner_id,
          identity_hash: identityHash,
        });

        await manager.save(tenantKyc);
      }
    } else {
      // If account exists, check if TenantKyc record exists and create/update it
      const existingTenantKyc = await manager.findOne(TenantKyc, {
        where: { user_id: tenantAccount.user.id },
      });

      if (!existingTenantKyc) {
        // Create TenantKyc record for existing user
        const identityHash =
          `${application.first_name}_${application.last_name}_${application.date_of_birth || '1990-01-01'}_${application.email}_${application.phone_number}`
            .toLowerCase()
            .replace(/\s+/g, '_');

        // Check if TenantKyc record already exists with this identity hash
        const existingTenantKycByHash = await manager.findOne(TenantKyc, {
          where: { identity_hash: identityHash },
        });

        if (!existingTenantKycByHash) {
          const tenantKyc = manager.create(TenantKyc, {
            first_name: application.first_name,
            last_name: application.last_name,
            email: application.email,
            phone_number: application.phone_number,
            date_of_birth: application.date_of_birth || new Date('1990-01-01'), // Default date if null
            gender: application.gender || 'other', // Default gender if null
            nationality: application.nationality || 'Nigerian', // Default nationality if null
            current_residence: '',
            state_of_origin: application.state_of_origin,
            local_government_area: application.local_government_area,
            marital_status: application.marital_status || 'single', // Default marital status if null
            employment_status: application.employment_status || 'employed', // Default employment status if null
            occupation: application.occupation || '——',
            job_title: application.job_title || '——',
            employer_name: application.employer_name,
            employer_address: application.employer_address,
            monthly_net_income: application.monthly_net_income || '0',
            reference1_name: '',
            reference1_address: '',
            reference1_relationship: '',
            reference1_phone_number: '',
            user_id: tenantAccount.user.id,
            admin_id: application.property.owner_id,
            identity_hash: identityHash,
          });

          await manager.save(tenantKyc);
        }
      } else {
        // Update existing TenantKyc record with latest KYC application data
        await manager.update(TenantKyc, existingTenantKyc.id, {
          first_name: application.first_name,
          last_name: application.last_name,
          email: application.email,
          phone_number: application.phone_number,
          date_of_birth:
            application.date_of_birth ||
            existingTenantKyc.date_of_birth ||
            new Date('1990-01-01'),
          gender: application.gender || existingTenantKyc.gender || 'other',
          nationality:
            application.nationality ||
            existingTenantKyc.nationality ||
            'Nigerian',
          state_of_origin: application.state_of_origin,
          local_government_area: application.local_government_area,
          marital_status:
            application.marital_status ||
            existingTenantKyc.marital_status ||
            'single',
          employment_status:
            application.employment_status ||
            existingTenantKyc.employment_status ||
            'employed',
          occupation: application.occupation || existingTenantKyc.occupation,
          job_title: application.job_title || existingTenantKyc.job_title,
          employer_name:
            application.employer_name || existingTenantKyc.employer_name,
          employer_address:
            application.employer_address || existingTenantKyc.employer_address,
          monthly_net_income:
            application.monthly_net_income ||
            existingTenantKyc.monthly_net_income,
        });
      }
    }

    return tenantAccount;
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

    if (tenancyDetails.tenancyStartDate) {
      const startDate = new Date(tenancyDetails.tenancyStartDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (startDate < today) {
        throw new BadRequestException(
          'Tenancy start date cannot be in the past',
        );
      }
    }

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
}

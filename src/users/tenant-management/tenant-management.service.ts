import {
  ConflictException,
  ForbiddenException,
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import {
  rentToFees,
  sumRecurring,
  sumOneTime,
  feeLabelsCsv,
} from 'src/common/billing/fees';

import { Users } from '../entities/user.entity';
import { Account } from '../entities/account.entity';
import { Rent } from 'src/rents/entities/rent.entity';
import { Property } from 'src/properties/entities/property.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { buildTimelineEvents } from 'src/property-history/property-history-timeline.builder';
import {
  KYCApplication,
  ApplicationStatus,
} from 'src/kyc-links/entities/kyc-application.entity';
import {
  OfferLetter,
  OfferLetterStatus,
} from 'src/offer-letters/entities/offer-letter.entity';
import { Payment, PaymentStatus } from 'src/payments/entities/payment.entity';
import { TenantDetailDto } from '../dto/tenant-detail.dto';
import {
  RenewalInvoice,
  RenewalPaymentStatus,
} from 'src/tenancies/entities/renewal-invoice.entity';

import {
  CreateTenantDto,
  CreateTenantKycDto,
  UserFilter,
} from '../dto/create-user.dto';
import {
  AttachTenantToPropertyDto,
  RentFrequency,
} from '../dto/attach-tenant-to-property.dto';
import { calculateRentExpiryDate } from 'src/common/utils/rent-date.util';

import { RolesEnum } from 'src/base.entity';
import {
  RentPaymentStatusEnum,
  RentStatusEnum,
} from 'src/rents/dto/create-rent.dto';
import {
  PropertyStatusEnum,
  TenantStatusEnum,
} from 'src/properties/dto/create-property.dto';
import { DateService } from 'src/utils/date.helper';
import { UtilService } from 'src/utils/utility-service';
import { WhatsappBotService } from 'src/whatsapp-bot/whatsapp-bot.service';
import { config } from 'src/config';
import { buildUserFilter, buildUserFilterQB } from 'src/filters/query-filter';
import { AttachResult } from 'src/common/interfaces';
import { TenantBalancesService } from 'src/tenant-balances/tenant-balances.service';
import { AttachTenantFromKycDto } from '../dto/attach-tenant-from-kyc.dto';
import {
  TenantBalanceLedger,
  TenantBalanceLedgerType,
} from 'src/tenant-balances/entities/tenant-balance-ledger.entity';

/**
 * Internal interface for tenant KYC record
 */
interface TenantKycRecord {
  id?: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  email?: string;
  date_of_birth?: string | Date;
  gender?: string;
  state_of_origin?: string;
  nationality?: string;
  marital_status?: string;
  religion?: string;
  employment_status?: string;
  employer_name?: string;
  work_address?: string;
  job_title?: string;
  monthly_net_income?: string;
  work_phone_number?: string;
  length_of_employment?: string;
  nature_of_business?: string;
  business_name?: string;
  business_address?: string;
  business_duration?: string;
  current_address?: string;
  next_of_kin_full_name?: string;
  next_of_kin_address?: string;
  next_of_kin_relationship?: string;
  next_of_kin_phone_number?: string;
  next_of_kin_email?: string;
  guarantor_full_name?: string;
  guarantor_phone_number?: string;
  guarantor_email?: string;
  guarantor_address?: string;
  guarantor_relationship?: string;
  guarantor_occupation?: string;
}

/**
 * TenantManagementService handles all tenant-specific operations
 * Extracted from UsersService to follow Single Responsibility Principle
 */
@Injectable()
export class TenantManagementService {
  private readonly logger = new Logger(TenantManagementService.name);

  constructor(
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(Rent)
    private readonly rentRepository: Repository<Rent>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepository: Repository<KYCApplication>,
    @InjectRepository(OfferLetter)
    private readonly offerLetterRepository: Repository<OfferLetter>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly dataSource: DataSource,
    private readonly utilService: UtilService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => WhatsappBotService))
    private readonly whatsappBotService: WhatsappBotService,
    private readonly tenantBalancesService: TenantBalancesService,
  ) {}

  /**
   * Add a new tenant with basic information
   */
  async addTenant(user_id: string, dto: CreateTenantDto): Promise<Users> {
    const {
      phone_number,
      full_name,
      rental_price,
      rent_start_date,
      email,
      property_id,
      security_deposit,
      service_charge,
      payment_frequency,
    } = dto;

    const admin = (await this.accountRepository.findOne({
      where: {
        id: user_id,
        role: RolesEnum.LANDLORD,
      },
      relations: ['user'],
    })) as Account & { user: Users };

    if (!admin) {
      throw new HttpException('admin account not found', HttpStatus.NOT_FOUND);
    }

    return await this.dataSource.transaction(async (manager) => {
      try {
        // 1. Check existing user
        let tenantUser = await manager.getRepository(Users).findOne({
          where: {
            phone_number: this.utilService.normalizePhoneNumber(phone_number),
          },
        });

        if (tenantUser) {
          throw new HttpException(
            `Account with phone: ${this.utilService.normalizePhoneNumber(phone_number)} already exists`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        const property = await manager.getRepository(Property).findOne({
          where: { id: property_id },
        });

        if (!property) {
          throw new HttpException('Property not found', HttpStatus.NOT_FOUND);
        }

        const hasActiveRent = await manager.getRepository(Rent).findOne({
          where: {
            property_id: property_id,
            rent_status: RentStatusEnum.ACTIVE,
          },
        });

        if (hasActiveRent) {
          throw new HttpException(
            `Property is already rented out`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        const [first_name, last_name] = full_name.split(' ');
        // 2. Create tenant user
        tenantUser = manager.getRepository(Users).create({
          first_name: this.utilService.toSentenceCase(first_name),
          last_name: this.utilService.toSentenceCase(last_name),
          email,
          phone_number: this.utilService.normalizePhoneNumber(phone_number),
          role: RolesEnum.TENANT,
          is_verified: true,
        });

        await manager.getRepository(Users).save(tenantUser);

        // 3. Create tenant account
        const generatedPassword = await this.utilService.generatePassword();

        const userAccount = manager.getRepository(Account).create({
          user: tenantUser,
          email,
          password: generatedPassword,
          is_verified: true,
          profile_name: `${tenantUser.first_name} ${tenantUser.last_name}`,
          role: RolesEnum.TENANT,
          creator_id: user_id,
        });

        await manager.getRepository(Account).save(userAccount);

        property.property_status = PropertyStatusEnum.OCCUPIED;
        property.is_marketing_ready = false;
        await manager.getRepository(Property).save(property);

        // 4. create rent record
        const rent = manager.getRepository(Rent).create({
          property_id,
          tenant_id: userAccount.id,
          amount_paid: 0,
          rental_price: rental_price,
          rent_start_date: rent_start_date,
          security_deposit: security_deposit || 0,
          service_charge: service_charge || 0,
          payment_frequency: payment_frequency || 'Monthly',
          payment_status: RentPaymentStatusEnum.PENDING,
          rent_status: RentStatusEnum.ACTIVE,
        });

        await manager.getRepository(Rent).save(rent);

        // Record each charge as its own ledger entry so the outstanding
        // balance breakdown shows rent, service charge and security deposit
        // as separate line items.
        const initialCharges: Array<{ amount?: number; description: string }> =
          [
            { amount: rental_price, description: 'Rent' },
            { amount: service_charge, description: 'Service charge' },
            { amount: security_deposit, description: 'Security deposit' },
          ];
        for (const charge of initialCharges) {
          if (charge.amount && charge.amount > 0) {
            await this.tenantBalancesService.applyChange(
              userAccount.id,
              user_id,
              -charge.amount,
              {
                type: TenantBalanceLedgerType.INITIAL_BALANCE,
                description: charge.description,
                propertyId: property_id,
                relatedEntityType: 'rent',
                relatedEntityId: rent.id,
              },
              undefined,
              manager,
            );
          }
        }

        // 5. Assign tenant to property
        const propertyTenant = manager.getRepository(PropertyTenant).create({
          property_id,
          tenant_id: userAccount.id,
          status: TenantStatusEnum.ACTIVE,
        });

        await manager.getRepository(PropertyTenant).save(propertyTenant);

        // 6. Emit event and send notifications
        this.eventEmitter.emit('user.added', {
          user_id: user_id,
          property_id: property_id,
          property_name: property?.name,
          profile_name: `${tenantUser.first_name} ${tenantUser.last_name}`,
          role: RolesEnum.TENANT,
        });

        await this.whatsappBotService.sendTenantWelcomeTemplate({
          phone_number: this.utilService.normalizePhoneNumber(phone_number),
          tenant_name: `${this.utilService.toSentenceCase(first_name)} ${this.utilService.toSentenceCase(last_name)}`,
          landlord_name: admin.profile_name,
          property_name: property?.name,
          property_id: property_id,
        });

        // Only send notification to admin if phone number exists
        if (admin.user?.phone_number) {
          const admin_phone_number = this.utilService.normalizePhoneNumber(
            admin.user.phone_number,
          );

          await this.whatsappBotService.sendUserAddedTemplate({
            phone_number: admin_phone_number,
            name: 'Admin',
            user: `${tenantUser.first_name} ${tenantUser.last_name}`,
            property_name: property?.name,
          });
        }

        return tenantUser;
      } catch (error) {
        console.error('Error creating tenant:', error);
        if (error instanceof HttpException) throw error;
        throw new HttpException(
          error.message || 'Could not create tenant',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    });
  }

  /**
   * Attach an existing tenant to a property
   * This allows tenants to be attached to multiple properties
   */
  async attachTenantToProperty(
    tenantId: string,
    dto: AttachTenantToPropertyDto,
    landlordId: string,
  ): Promise<AttachResult> {
    const {
      propertyId,
      tenancyStartDate,
      rentAmount,
      rentFrequency,
      serviceCharge,
    } = dto;

    return await this.dataSource.transaction(async (manager) => {
      console.log('data received = ', dto);
      try {
        // 1. Verify tenant exists
        const tenantAccount = await manager.getRepository(Account).findOne({
          where: { id: tenantId },
          relations: ['user'],
        });

        if (!tenantAccount) {
          throw new NotFoundException('Tenant not found');
        }

        // 2. Verify property exists and belongs to this landlord
        const property = await manager.getRepository(Property).findOne({
          where: { id: propertyId },
        });

        if (!property) {
          throw new NotFoundException('Property not found');
        }

        if (property.owner_id !== landlordId) {
          throw new ForbiddenException(
            'You are not authorized to attach tenants to this property',
          );
        }

        // 3. Check if property is available for tenant attachment
        if (property.property_status === PropertyStatusEnum.OCCUPIED) {
          throw new ConflictException(
            'Property is already occupied. Cannot attach another tenant.',
          );
        }

        if (property.property_status === PropertyStatusEnum.INACTIVE) {
          throw new ConflictException(
            'Cannot attach tenant to inactive property. Please reactivate the property first.',
          );
        }

        if (
          property.property_status !== PropertyStatusEnum.VACANT &&
          property.property_status !== PropertyStatusEnum.OFFER_ACCEPTED
        ) {
          throw new ConflictException(
            'Tenant can only be attached to properties that are Vacant or have an accepted offer.',
          );
        }

        // 4. Check if tenant is already attached to this property
        const existingAttachment = await manager
          .getRepository(PropertyTenant)
          .findOne({
            where: {
              property_id: propertyId,
              tenant_id: tenantId,
              status: TenantStatusEnum.ACTIVE,
            },
          });

        if (existingAttachment) {
          throw new ConflictException(
            'Tenant is already attached to this property',
          );
        }

        // 5. Parse rent start date
        const rentStartDate = tenancyStartDate
          ? new Date(tenancyStartDate)
          : new Date();

        // 6. Calculate next rent due date based on frequency
        const nextRentDueDate = calculateRentExpiryDate(
          rentStartDate,
          rentFrequency,
        );

        // 7. Create rent record
        console.log(
          '💰 [AttachToProperty] Creating rent record with service_charge:',
          serviceCharge,
        );
        const rent = manager.getRepository(Rent).create({
          tenant_id: tenantId,
          property_id: propertyId,
          rent_start_date: rentStartDate,
          rental_price: rentAmount,
          security_deposit: 0,
          service_charge: serviceCharge || 0,
          payment_frequency:
            this.mapRentFrequencyToPaymentFrequency(rentFrequency),
          rent_status: RentStatusEnum.ACTIVE,
          payment_status: RentPaymentStatusEnum.PENDING,
          amount_paid: 0,
          expiry_date: nextRentDueDate,
        });
        console.log('Created rent record;', rent);

        await manager.getRepository(Rent).save(rent);

        // Record each charge as its own ledger entry so the outstanding
        // balance breakdown shows rent and service charge as separate
        // line items.
        if (rentAmount > 0) {
          await this.tenantBalancesService.applyChange(
            tenantId,
            landlordId,
            -rentAmount,
            {
              type: TenantBalanceLedgerType.INITIAL_BALANCE,
              description: 'Rent',
              propertyId: propertyId,
              relatedEntityType: 'rent',
              relatedEntityId: rent.id,
            },
            undefined,
            manager,
          );
        }

        if ((serviceCharge || 0) > 0) {
          await this.tenantBalancesService.applyChange(
            tenantId,
            landlordId,
            -(serviceCharge || 0),
            {
              type: TenantBalanceLedgerType.INITIAL_BALANCE,
              description: 'Service charge',
              propertyId: propertyId,
              relatedEntityType: 'rent',
              relatedEntityId: rent.id,
            },
            undefined,
            manager,
          );
        }

        // 8. Create property-tenant relationship
        const propertyTenant = manager.getRepository(PropertyTenant).create({
          property_id: propertyId,
          tenant_id: tenantId,
          status: TenantStatusEnum.ACTIVE,
        });

        await manager.getRepository(PropertyTenant).save(propertyTenant);

        // 9. Update property status to OCCUPIED and remove from marketing
        await manager.getRepository(Property).update(propertyId, {
          property_status: PropertyStatusEnum.OCCUPIED,
          is_marketing_ready: false,
        });

        // 10. Create property history record
        const propertyHistory = manager.getRepository(PropertyHistory).create({
          property_id: propertyId,
          tenant_id: tenantId,
          event_type: 'tenancy_started',
          move_in_date: DateService.getStartOfTheDay(rentStartDate),
          monthly_rent: rentAmount,
          owner_comment: 'Tenant moved in',
          tenant_comment: null,
          move_out_date: null,
          move_out_reason: null,
        });

        const savedPropertyHistory = await manager
          .getRepository(PropertyHistory)
          .save(propertyHistory);

        console.log(
          '🏠 DEBUG: Created property history record for tenant attachment:',
          {
            id: savedPropertyHistory.id,
            property_id: savedPropertyHistory.property_id,
            tenant_id: savedPropertyHistory.tenant_id,
            event_type: savedPropertyHistory.event_type,
            move_in_date: savedPropertyHistory.move_in_date,
            monthly_rent: savedPropertyHistory.monthly_rent,
            timestamp: new Date().toISOString(),
          },
        );

        // 11. Send WhatsApp notification to tenant
        try {
          const landlord = await manager.getRepository(Account).findOne({
            where: { id: landlordId },
            relations: ['user'],
          });

          const agencyName = landlord?.profile_name
            ? landlord.profile_name
            : landlord?.user
              ? `${this.utilService.toSentenceCase(landlord.user.first_name)} ${this.utilService.toSentenceCase(landlord.user.last_name)}`
              : 'Your Landlord';

          const tenantName = `${this.utilService.toSentenceCase(tenantAccount.user.first_name)} ${this.utilService.toSentenceCase(tenantAccount.user.last_name)}`;

          await this.whatsappBotService.sendTenantAttachmentNotification({
            phone_number: this.utilService.normalizePhoneNumber(
              tenantAccount.user.phone_number,
            ),
            tenant_name: tenantName,
            landlord_name: agencyName,
            property_name: property.name,
            property_id: propertyId,
          });

          // Emit tenant attached event for live feed
          this.eventEmitter.emit('tenant.attached', {
            property_id: propertyId,
            property_name: property.name,
            tenant_id: tenantId,
            tenant_name: tenantName,
            user_id: property.owner_id,
          });
        } catch (whatsappError) {
          console.error('Failed to send WhatsApp notification:', whatsappError);

          // Still emit the event even if WhatsApp fails
          const fallbackTenantName = `${this.utilService.toSentenceCase(tenantAccount.user.first_name)} ${this.utilService.toSentenceCase(tenantAccount.user.last_name)}`;
          this.eventEmitter.emit('tenant.attached', {
            property_id: propertyId,
            property_name: property.name,
            tenant_id: tenantId,
            tenant_name: fallbackTenantName,
            user_id: property.owner_id,
          });
        }

        return {
          success: true,
          message: 'Tenant successfully attached to property',
          tenantId: tenantId,
          propertyId: propertyId,
        };
      } catch (error) {
        console.error('Error attaching tenant to property:', error);
        if (error instanceof HttpException) throw error;
        throw new HttpException(
          error.message || 'Failed to attach tenant to property',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    });
  }

  /**
   * Map RentFrequency enum to payment frequency string
   */
  mapRentFrequencyToPaymentFrequency(frequency: RentFrequency): string {
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
   * Add a new tenant with KYC information
   */
  async addTenantKyc(user_id: string, dto: CreateTenantKycDto): Promise<Users> {
    const {
      phone_number,
      first_name,
      last_name,
      email,
      date_of_birth,
      gender,
      state_of_origin,
      lga,
      nationality,
      employment_status,
      marital_status,
      property_id,
      rent_amount,
      tenancy_start_date,
      tenancy_end_date,
      employer_name,
      job_title,
      employer_address,
      monthly_income,
      work_email,
      business_name,
      nature_of_business,
      business_address,
      business_monthly_income,
      business_website,
      source_of_funds,
      monthly_income_estimate,
      spouse_full_name,
      spouse_phone_number,
      spouse_occupation,
      spouse_employer,
    } = dto;

    const admin = (await this.accountRepository.findOne({
      where: {
        id: user_id,
        role: RolesEnum.LANDLORD,
      },
      relations: ['user'],
    })) as Account & { user: Users };

    if (!admin) {
      throw new HttpException('admin account not found', HttpStatus.NOT_FOUND);
    }

    console.log('=== DEBUG: Admin Data in addTenantKyc ===');
    console.log('Admin ID:', admin.id);
    console.log('Admin userId:', admin.userId);
    console.log('Admin user object:', admin.user);
    console.log('Admin user phone_number:', admin.user?.phone_number);
    console.log('=========================================');

    return await this.dataSource.transaction(async (manager) => {
      try {
        // 1. Check existing user
        let tenantUser = await manager.getRepository(Users).findOne({
          where: {
            phone_number: this.utilService.normalizePhoneNumber(phone_number),
          },
        });

        if (tenantUser) {
          throw new HttpException(
            `Account with phone: ${this.utilService.normalizePhoneNumber(phone_number)} already exists`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        const property = await manager.getRepository(Property).findOne({
          where: { id: property_id },
        });

        if (!property) {
          throw new HttpException('Property not found', HttpStatus.NOT_FOUND);
        }

        const hasActiveRent = await manager.getRepository(Rent).findOne({
          where: {
            property_id: property_id,
            rent_status: RentStatusEnum.ACTIVE,
          },
        });

        if (hasActiveRent) {
          throw new HttpException(
            `Property is already rented out`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        // 2. Create tenant user
        tenantUser = manager.getRepository(Users).create({
          first_name: this.utilService.toSentenceCase(first_name),
          last_name: this.utilService.toSentenceCase(last_name),
          email,
          phone_number: this.utilService.normalizePhoneNumber(phone_number),
          date_of_birth,
          gender,
          state_of_origin,
          lga,
          nationality,
          employment_status,
          marital_status,
          role: RolesEnum.TENANT,
          is_verified: true,
          employer_name,
          job_title,
          employer_address,
          monthly_income,
          work_email,
          nature_of_business,
          business_name,
          business_address,
          business_monthly_income,
          business_website,
          source_of_funds,
          monthly_income_estimate,
          spouse_full_name,
          spouse_phone_number,
          spouse_occupation,
          spouse_employer,
        });

        await manager.getRepository(Users).save(tenantUser);

        // 3. Create tenant account
        const generatedPassword = await this.utilService.generatePassword();

        const userAccount = manager.getRepository(Account).create({
          user: tenantUser,
          email,
          password: generatedPassword,
          is_verified: true,
          profile_name: `${tenantUser.first_name} ${tenantUser.last_name}`,
          role: RolesEnum.TENANT,
          creator_id: user_id,
        });

        await manager.getRepository(Account).save(userAccount);

        property.property_status = PropertyStatusEnum.OCCUPIED;
        property.is_marketing_ready = false;
        await manager.getRepository(Property).save(property);

        // 4. create rent record
        const serviceCharge = dto.service_charge || 0;
        const rent = manager.getRepository(Rent).create({
          property_id,
          tenant_id: userAccount.id,
          amount_paid: 0,
          rental_price: rent_amount,
          rent_start_date: tenancy_start_date,
          service_charge: serviceCharge,
          payment_status: RentPaymentStatusEnum.PENDING,
          rent_status: RentStatusEnum.ACTIVE,
        });

        await manager.getRepository(Rent).save(rent);

        // Record each charge as its own ledger entry so the outstanding
        // balance breakdown shows rent and service charge as separate
        // line items.
        if (rent_amount > 0) {
          await this.tenantBalancesService.applyChange(
            userAccount.id,
            user_id,
            -rent_amount,
            {
              type: TenantBalanceLedgerType.INITIAL_BALANCE,
              description: 'Rent',
              propertyId: property_id,
              relatedEntityType: 'rent',
              relatedEntityId: rent.id,
            },
          );
        }

        if (serviceCharge > 0) {
          await this.tenantBalancesService.applyChange(
            userAccount.id,
            user_id,
            -serviceCharge,
            {
              type: TenantBalanceLedgerType.INITIAL_BALANCE,
              description: 'Service charge',
              propertyId: property_id,
              relatedEntityType: 'rent',
              relatedEntityId: rent.id,
            },
          );
        }

        // 5. Assign tenant to property
        const propertyTenant = manager.getRepository(PropertyTenant).create({
          property_id,
          tenant_id: userAccount.id,
          status: TenantStatusEnum.ACTIVE,
        });

        await manager.getRepository(PropertyTenant).save(propertyTenant);

        // 6. Notify tenant
        await this.whatsappBotService.sendToUserWithTemplate(
          this.utilService.normalizePhoneNumber(tenantUser.phone_number),
          `${tenantUser.first_name} ${tenantUser.last_name}`,
        );

        this.eventEmitter.emit('user.added', {
          user_id: user_id,
          property_id: property_id,
          property_name: property?.name,
          profile_name: `${tenantUser.first_name} ${tenantUser.last_name}`,
          role: RolesEnum.TENANT,
        });

        await this.whatsappBotService.sendTenantWelcomeTemplate({
          phone_number: this.utilService.normalizePhoneNumber(phone_number),
          tenant_name: `${this.utilService.toSentenceCase(first_name)} ${this.utilService.toSentenceCase(last_name)}`,
          landlord_name: admin.profile_name,
          property_name: property?.name,
          property_id: property_id,
        });

        // Only send notification to admin if phone number exists
        if (admin.user?.phone_number) {
          const admin_phone_number = this.utilService.normalizePhoneNumber(
            admin.user.phone_number,
          );

          await this.whatsappBotService.sendUserAddedTemplate({
            phone_number: admin_phone_number,
            name: 'Admin',
            user: `${tenantUser.first_name} ${tenantUser.last_name}`,
            property_name: property?.name,
          });
        }

        return tenantUser;
      } catch (error) {
        console.error('Error creating tenant:', error);
        if (error instanceof HttpException) throw error;
        throw new HttpException(
          error.message || 'Could not create tenant',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    });
  }

  /**
   * Attach tenant from KYC application
   */
  async attachTenantFromKyc(
    landlordId: string,
    dto: AttachTenantFromKycDto,
  ): Promise<{
    tenantUser: Users;
    tenantAccount: Account;
    property: Property;
  }> {
    // 1. Fetch the KYC application
    const kycApplication = await this.kycApplicationRepository.findOne({
      where: { id: dto.kycApplicationId },
      relations: ['property'],
    });

    if (!kycApplication) {
      throw new HttpException(
        'KYC Application not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // 2. Resolve rent due date. Preferred input is tenancyEndDate (derived
    // server-side); legacy callers still pass rentDueDate directly.
    const resolvedRentDueDate = dto.rentDueDate ?? dto.tenancyEndDate;
    if (!resolvedRentDueDate) {
      throw new HttpException(
        'Either rentDueDate or tenancyEndDate must be provided',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 3. Map KYC application data to CreateTenantKycDto
    const tenantKycDto: TenantKycFromApplicationDto = {
      phone_number: kycApplication.phone_number,
      first_name: kycApplication.first_name,
      last_name: kycApplication.last_name,
      email:
        kycApplication.email ||
        `${kycApplication.phone_number}@placeholder.com`,
      date_of_birth: kycApplication.date_of_birth || new Date('1990-01-01'),
      gender: kycApplication.gender || 'male',
      state_of_origin: kycApplication.state_of_origin || 'N/A',
      lga: 'N/A',
      nationality: kycApplication.nationality || 'Nigerian',
      employment_status: kycApplication.employment_status || 'employed',
      marital_status: kycApplication.marital_status || 'single',
      property_id: dto.propertyId,
      rent_amount: dto.rentAmount,
      rent_frequency: dto.rentFrequency,
      tenancy_start_date: new Date(dto.tenancyStartDate),
      rent_due_date: new Date(resolvedRentDueDate),
      employer_name: kycApplication.employer_name,
      job_title: kycApplication.job_title,
      employer_address: kycApplication.work_address,
      monthly_income: kycApplication.monthly_net_income
        ? parseFloat(kycApplication.monthly_net_income)
        : undefined,
      work_email: kycApplication.email,
      business_name: kycApplication.business_name,
      nature_of_business: kycApplication.nature_of_business,
      business_address: kycApplication.business_address,
      business_monthly_income: undefined,
      business_website: undefined,
      source_of_funds: undefined,
      monthly_income_estimate: undefined,
      spouse_full_name: undefined,
      spouse_phone_number: undefined,
      spouse_occupation: undefined,
      spouse_employer: undefined,
      service_charge: dto.serviceCharge,
      caution_deposit: dto.cautionDeposit,
      legal_fee: dto.legalFee,
      agency_fee: dto.agencyFee,
      service_charge_recurring: dto.serviceChargeRecurring,
      security_deposit_recurring: dto.securityDepositRecurring,
      legal_fee_recurring: dto.legalFeeRecurring,
      agency_fee_recurring: dto.agencyFeeRecurring,
      other_fees: dto.otherFees?.map((f) => ({
        externalId: f.externalId ?? randomUUID(),
        name: f.name,
        amount: f.amount,
        recurring: f.recurring,
      })),
    };

    // 3. Handle existing user or create new tenant
    const result = await this.handleTenantFromKyc(landlordId, tenantKycDto);

    // 4. Update KYC application status to approved and set tenant_id
    await this.kycApplicationRepository.update(dto.kycApplicationId, {
      status: ApplicationStatus.APPROVED,
      tenant_id: result.tenantAccount.id,
    });

    // 5. Backfill tenant_id on applicant-phase property history records
    // These events (KYC submitted, offer letter sent/accepted, invoice generated/sent, etc.)
    // were created before the tenant account existed, so they have tenant_id = NULL
    try {
      const propertyHistoryRepo =
        this.dataSource.getRepository(PropertyHistory);
      const backfillResult = await propertyHistoryRepo
        .createQueryBuilder()
        .update(PropertyHistory)
        .set({ tenant_id: result.tenantAccount.id })
        .where('property_id = :propertyId', {
          propertyId: dto.propertyId,
        })
        .andWhere('tenant_id IS NULL')
        .execute();

      console.log(
        `Backfilled tenant_id on ${backfillResult.affected} applicant-phase property history records`,
      );
    } catch (backfillError) {
      console.error(
        'Failed to backfill tenant_id on property history records:',
        backfillError,
      );
      // Don't fail the attachment — backfill is best-effort
    }

    return result;
  }

  /**
   * Handle tenant creation from KYC - supports existing users
   */
  private async handleTenantFromKyc(
    landlordId: string,
    dto: TenantKycFromApplicationDto,
  ): Promise<{
    tenantUser: Users;
    tenantAccount: Account;
    property: Property;
  }> {
    const txResult = await this.dataSource.transaction(async (manager) => {
      const {
        phone_number,
        first_name,
        last_name,
        email,
        date_of_birth,
        gender,
        state_of_origin,
        lga,
        nationality,
        employment_status,
        marital_status,
        property_id,
        rent_amount,
        rent_frequency,
        tenancy_start_date,
        rent_due_date,
        employer_name,
        job_title,
        employer_address,
        monthly_income,
        work_email,
        business_name,
        nature_of_business,
        business_address,
        service_charge,
        caution_deposit,
        legal_fee,
        agency_fee,
        service_charge_recurring,
        security_deposit_recurring,
        legal_fee_recurring,
        agency_fee_recurring,
        other_fees,
      } = dto;

      // 1. Check if user already exists
      const normalizedPhone =
        this.utilService.normalizePhoneNumber(phone_number);
      console.log('🔍 Looking for existing user with phone:', normalizedPhone);
      console.log('📞 Original phone number:', phone_number);

      // Create comprehensive list of phone number variations to try
      const phoneVariations = [
        normalizedPhone,
        phone_number,
        phone_number.startsWith('+') ? phone_number.substring(1) : phone_number,
        phone_number.startsWith('+234')
          ? '0' + phone_number.substring(4)
          : null,
        phone_number.startsWith('234') ? '0' + phone_number.substring(3) : null,
        phone_number.startsWith('0') ? phone_number.substring(1) : null,
        phone_number.startsWith('0') ? '234' + phone_number.substring(1) : null,
        phone_number.startsWith('0')
          ? '+234' + phone_number.substring(1)
          : null,
      ].filter(Boolean) as string[];

      console.log('🔍 Phone variations to try:', phoneVariations);

      let tenantUser: Users | null = null;

      // Try each phone variation
      for (const phoneVariation of phoneVariations) {
        tenantUser = await manager.getRepository(Users).findOne({
          where: {
            phone_number: phoneVariation,
          },
        });

        if (tenantUser) {
          console.log(
            '🔍 Found existing user with phone variation:',
            phoneVariation,
            'User ID:',
            tenantUser.id,
          );
          break;
        }
      }

      if (!tenantUser) {
        console.log('🔍 No existing user found with any phone variation');
      }

      console.log(
        '👤 Final result - Found existing user:',
        tenantUser ? `Yes (ID: ${tenantUser.id})` : 'No',
      );

      // 2. If user doesn't exist, create new user
      if (!tenantUser) {
        console.log('➕ Creating new user with phone:', normalizedPhone);

        try {
          const userData: Partial<Users> = {
            first_name: this.utilService.toSentenceCase(first_name),
            last_name: this.utilService.toSentenceCase(last_name),
            email,
            phone_number: this.utilService.normalizePhoneNumber(phone_number),
            date_of_birth,
            gender: gender as Users['gender'],
            state_of_origin,
            lga,
            nationality,
            employment_status: employment_status as Users['employment_status'],
            marital_status: marital_status as Users['marital_status'],
            role: RolesEnum.TENANT,
            is_verified: true,
            employer_name,
            job_title,
            employer_address,
            monthly_income,
            work_email,
            nature_of_business,
            business_name,
            business_address,
          };
          const newUser = manager.getRepository(Users).create(userData);

          tenantUser = await manager.getRepository(Users).save(newUser);
          console.log(
            '✅ Successfully created new user with ID:',
            tenantUser.id,
          );
        } catch (error: unknown) {
          // If duplicate key error, try to find the existing user again
          const dbError = error as { code?: string; constraint?: string };
          if (
            dbError.code === '23505' &&
            dbError.constraint === 'UQ_17d1817f241f10a3dbafb169fd2'
          ) {
            console.log(
              '⚠️ Duplicate key error caught, searching for existing user again...',
            );

            // Try all possible phone number formats
            const phoneVariants = [
              normalizedPhone,
              phone_number,
              phone_number.startsWith('+')
                ? phone_number.substring(1)
                : `+${phone_number}`,
            ];

            for (const phoneVariant of phoneVariants) {
              const foundUser = await manager.getRepository(Users).findOne({
                where: { phone_number: phoneVariant },
              });
              if (foundUser) {
                tenantUser = foundUser;
                console.log(
                  '🔄 Found existing user with phone variant:',
                  phoneVariant,
                  'User ID:',
                  tenantUser.id,
                );
                break;
              }
            }

            if (!tenantUser) {
              console.error(
                '❌ Could not find existing user even after duplicate key error',
              );
              throw error;
            }
          } else {
            throw error;
          }
        }
      } else {
        console.log('♻️ Using existing user with ID:', tenantUser.id);
      }

      // Ensure tenantUser is not null at this point
      if (!tenantUser) {
        throw new HttpException(
          'Failed to create or find tenant user',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // 3. Check if property exists and is available
      const property = await manager.getRepository(Property).findOne({
        where: { id: property_id },
      });

      if (!property) {
        throw new HttpException('Property not found', HttpStatus.NOT_FOUND);
      }

      // 4. Check if property already has active rent
      const hasActiveRent = await manager.getRepository(Rent).findOne({
        where: {
          property_id: property_id,
          rent_status: RentStatusEnum.ACTIVE,
        },
      });

      if (hasActiveRent) {
        throw new HttpException(
          'Property is already rented out',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      // 5. Create account for tenant if it doesn't exist
      let tenantAccount = await manager.getRepository(Account).findOne({
        where: { userId: tenantUser.id, role: RolesEnum.TENANT },
      });

      if (!tenantAccount) {
        const accountEmail = tenantUser.email || email;
        if (!accountEmail) {
          throw new HttpException(
            'Email is required to create tenant account',
            HttpStatus.BAD_REQUEST,
          );
        }

        tenantAccount = manager.getRepository(Account).create({
          userId: tenantUser.id,
          role: RolesEnum.TENANT,
          email: accountEmail,
        });
        tenantAccount = await manager
          .getRepository(Account)
          .save(tenantAccount);
      }

      // 6. Create rent record — Billing v2 persists every fee + recurring
      // flag + otherFees so downstream money events (renewal cron,
      // property history) can reconstruct the fee set.
      const rent = manager.getRepository(Rent).create({
        tenant_id: tenantAccount.id,
        property_id: property_id,
        rent_start_date: tenancy_start_date,
        rental_price: rent_amount,
        security_deposit: caution_deposit || 0,
        security_deposit_recurring: !!security_deposit_recurring,
        service_charge: service_charge || 0,
        service_charge_recurring: service_charge_recurring !== false,
        legal_fee: legal_fee != null ? legal_fee : null,
        legal_fee_recurring: !!legal_fee_recurring,
        agency_fee: agency_fee != null ? agency_fee : null,
        agency_fee_recurring: !!agency_fee_recurring,
        other_fees: other_fees ?? [],
        payment_frequency: this.mapRentFrequencyToPaymentFrequency(
          rent_frequency as RentFrequency,
        ),
        rent_status: RentStatusEnum.ACTIVE,
        payment_status: RentPaymentStatusEnum.PENDING,
        amount_paid: 0,
        expiry_date: rent_due_date,
      });

      await manager.getRepository(Rent).save(rent);

      // Compute fee split off the just-saved Rent row so this function is the
      // single source of truth for the recurring/one-time classification.
      const fees = rentToFees(rent);
      const recurringFees = fees.filter((f) => f.recurring);
      const oneTimeFees = fees.filter((f) => !f.recurring);
      const recurringPeriodCharge = sumRecurring(fees);
      const oneTimeCharge = sumOneTime(fees);

      // Direct-attach has no Paystack leg — the landlord is recording existing
      // state, not collecting payment. The tenant starts owing exactly the
      // first period's recurring charges + all one-time move-in fees.
      if (recurringPeriodCharge > 0) {
        await this.tenantBalancesService.applyChange(
          tenantAccount.id,
          landlordId,
          -recurringPeriodCharge,
          {
            type: TenantBalanceLedgerType.INITIAL_BALANCE,
            description: 'Tenancy started — recurring charges',
            propertyId: property_id,
            relatedEntityType: 'rent',
            relatedEntityId: rent.id,
            metadata: {
              batch_id: 'billing-v2',
              breakdown: recurringFees,
            },
          },
          undefined,
          manager,
        );
      }

      if (oneTimeCharge > 0) {
        await this.tenantBalancesService.applyChange(
          tenantAccount.id,
          landlordId,
          -oneTimeCharge,
          {
            type: TenantBalanceLedgerType.ONE_TIME_FEES,
            description: `Move-in fees — ${feeLabelsCsv(oneTimeFees)}`,
            propertyId: property_id,
            relatedEntityType: 'rent',
            relatedEntityId: rent.id,
            metadata: {
              batch_id: 'billing-v2',
              breakdown: oneTimeFees,
            },
          },
          undefined,
          manager,
        );
      }

      // 7. Create property-tenant relationship
      const propertyTenant = manager.getRepository(PropertyTenant).create({
        property_id: property_id,
        tenant_id: tenantAccount.id,
        status: TenantStatusEnum.ACTIVE,
      });

      await manager.getRepository(PropertyTenant).save(propertyTenant);

      // 8. Update property status to occupied and remove from marketing
      await manager.getRepository(Property).update(property_id, {
        property_status: PropertyStatusEnum.OCCUPIED,
        is_marketing_ready: false,
      });

      // 9. Create property history record
      const propertyHistory = manager.getRepository(PropertyHistory).create({
        property_id: property_id,
        tenant_id: tenantAccount.id,
        event_type: 'tenancy_started',
        move_in_date: tenancy_start_date,
        monthly_rent: rent_amount,
        owner_comment: 'Tenant moved in',
        tenant_comment: null,
        move_out_date: null,
        move_out_reason: null,
      });

      await manager.getRepository(PropertyHistory).save(propertyHistory);

      // 10. Send WhatsApp notification to tenant and emit live feed event
      try {
        const landlord = await manager.getRepository(Account).findOne({
          where: { id: landlordId },
          relations: ['user'],
        });

        const agencyName = landlord?.profile_name
          ? landlord.profile_name
          : landlord?.user
            ? `${this.utilService.toSentenceCase(landlord.user.first_name)} ${this.utilService.toSentenceCase(landlord.user.last_name)}`
            : 'Your Landlord';

        const tenantName = `${this.utilService.toSentenceCase(tenantUser.first_name)} ${this.utilService.toSentenceCase(tenantUser.last_name)}`;

        await this.whatsappBotService.sendTenantAttachmentNotification({
          phone_number: this.utilService.normalizePhoneNumber(
            tenantUser.phone_number,
          ),
          tenant_name: tenantName,
          landlord_name: agencyName,
          property_name: property.name,
          property_id: property_id,
        });

        // Emit tenant attached event for live feed
        this.eventEmitter.emit('tenant.attached', {
          property_id: property_id,
          property_name: property.name,
          tenant_id: tenantAccount.id,
          tenant_name: tenantName,
          user_id: property.owner_id,
        });
      } catch (whatsappError) {
        console.error('Failed to send WhatsApp notification:', whatsappError);

        // Still emit the event even if WhatsApp fails
        const fallbackTenantName = `${this.utilService.toSentenceCase(tenantUser.first_name)} ${this.utilService.toSentenceCase(tenantUser.last_name)}`;
        this.eventEmitter.emit('tenant.attached', {
          property_id: property_id,
          property_name: property.name,
          tenant_id: tenantAccount.id,
          tenant_name: fallbackTenantName,
          user_id: property.owner_id,
        });
      }

      return { tenantUser, tenantAccount, property };
    });

    return {
      tenantUser: txResult.tenantUser,
      tenantAccount: txResult.tenantAccount,
      property: txResult.property,
    };
  }

  /**
   * Get all tenants with pagination
   */
  async getAllTenants(queryParams: UserFilter): Promise<{
    users: Users[];
    pagination: {
      totalRows: number;
      perPage: number;
      currentPage: number;
      totalPages: number;
      hasNextPage: boolean;
    };
  }> {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;

    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;

    const skip = (page - 1) * size;

    queryParams.role = RolesEnum.TENANT;

    const qb = this.usersRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.property_tenants', 'property_tenants')
      .leftJoinAndSelect('property_tenants.property', 'property')
      .leftJoinAndSelect('user.rents', 'rents')
      .where('user.role = :role', { role: RolesEnum.TENANT.toLowerCase() });

    buildUserFilterQB(qb, queryParams);

    qb.orderBy('user.created_at', 'DESC').skip(skip).take(size);

    const [users, count] = await qb.getManyAndCount();

    const totalPages = Math.ceil(count / size);
    return {
      users,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  /**
   * Get tenants of a specific admin/landlord
   */
  async getTenantsOfAnAdmin(
    creator_id: string,
    queryParams: UserFilter,
  ): Promise<{
    users: Account[];
    pagination: {
      totalRows: number;
      perPage: number;
      currentPage: number;
      totalPages: number;
      hasNextPage: boolean;
    };
  }> {
    const page = queryParams?.page ?? config.DEFAULT_PAGE_NO;
    const size = queryParams?.size ?? config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    // Only return tenants who have active rents (currently assigned to properties)
    const qb = this.accountRepository
      .createQueryBuilder('accounts')
      .leftJoin('accounts.user', 'user')
      .addSelect([
        'user.id',
        'user.first_name',
        'user.last_name',
        'user.email',
        'user.phone_number',
        'user.logo_urls',
      ])
      .innerJoin(
        'accounts.rents',
        'rents',
        'rents.rent_status = :activeStatus AND rents.deleted_at IS NULL',
        { activeStatus: 'active' },
      )
      .addSelect([
        'rents.id',
        'rents.rental_price',
        'rents.service_charge',
        'rents.expiry_date',
        'rents.rent_start_date',
        'rents.payment_frequency',
        'rents.rent_status',
        'rents.tenant_id',
        'rents.property_id',
      ])
      .leftJoin('rents.property', 'property')
      .addSelect([
        'property.id',
        'property.name',
        'property.location',
        'property.property_status',
      ])
      .where('accounts.creator_id = :creator_id', { creator_id });

    // Apply sorting
    if (queryParams.sort_by === 'rent' && queryParams?.sort_order) {
      qb.orderBy(
        'rents.rental_price',
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
    } else if (queryParams.sort_by === 'date' && queryParams?.sort_order) {
      qb.orderBy(
        'accounts.created_at',
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
    } else if (queryParams.sort_by === 'name' && queryParams?.sort_order) {
      qb.orderBy(
        'accounts.profile_name',
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
    } else if (queryParams.sort_by === 'property' && queryParams?.sort_order) {
      qb.orderBy(
        'property.name',
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
    } else if (queryParams.sort_by && queryParams?.sort_order) {
      qb.orderBy(
        `property.${queryParams.sort_by}`,
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
    }

    const [users, count] = await qb.skip(skip).take(size).getManyAndCount();

    const totalPages = Math.ceil(count / size);
    return {
      users,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  /**
   * Get a single tenant of an admin with full details
   */
  async getSingleTenantOfAnAdmin(
    tenantId: string,
    adminId: string,
  ): Promise<TenantDetailDto> {
    console.log('🔍 DEBUG: getSingleTenantOfAnAdmin called:', {
      tenantId,
      adminId,
      timestamp: new Date().toISOString(),
    });

    const tenantAccount = await this.accountRepository
      .createQueryBuilder('account')
      .innerJoin('account.user', 'user')
      .addSelect([
        'user.id',
        'user.first_name',
        'user.last_name',
        'user.email',
        'user.phone_number',
        'user.logo_urls',
        'user.date_of_birth',
        'user.gender',
        'user.state_of_origin',
        'user.nationality',
        'user.employment_status',
        'user.employer_name',
        'user.job_title',
        'user.monthly_income',
        'user.marital_status',
      ])
      .leftJoin('user.kyc', 'kyc')
      .addSelect([
        'kyc.id',
        'kyc.occupation',
        'kyc.employers_name',
        'kyc.state_of_origin',
        'kyc.nationality',
        'kyc.marital_status',
        'kyc.next_of_kin',
        'kyc.next_of_kin_address',
        'kyc.guarantor',
        'kyc.guarantor_address',
        'kyc.guarantor_phone_number',
        'kyc.monthly_income',
      ])
      .leftJoin(
        'user.tenant_kycs',
        'tenant_kyc',
        'tenant_kyc.admin_id = :adminId',
      )
      .addSelect([
        'tenant_kyc.id',
        'tenant_kyc.first_name',
        'tenant_kyc.last_name',
        'tenant_kyc.email',
        'tenant_kyc.phone_number',
        'tenant_kyc.date_of_birth',
        'tenant_kyc.gender',
        'tenant_kyc.nationality',
        'tenant_kyc.state_of_origin',
        'tenant_kyc.marital_status',
        'tenant_kyc.employment_status',
        'tenant_kyc.occupation',
        'tenant_kyc.employer_name',
        'tenant_kyc.monthly_net_income',
        'tenant_kyc.contact_address',
        'tenant_kyc.next_of_kin_full_name',
        'tenant_kyc.next_of_kin_address',
        'tenant_kyc.next_of_kin_phone_number',
        'tenant_kyc.next_of_kin_relationship',
      ])
      .leftJoin('account.rents', 'rents')
      .addSelect([
        'rents.id',
        'rents.property_id',
        'rents.tenant_id',
        'rents.amount_paid',
        'rents.expiry_date',
        'rents.rent_start_date',
        'rents.rental_price',
        'rents.service_charge',
        'rents.payment_frequency',
        'rents.payment_status',
        'rents.rent_status',
        'rents.created_at',
      ])
      .leftJoin('rents.property', 'property')
      .addSelect([
        'property.id',
        'property.name',
        'property.location',
        'property.property_status',
        'property.property_type',
        'property.owner_id',
      ])
      .leftJoin('account.service_requests', 'service_requests')
      .addSelect([
        'service_requests.id',
        'service_requests.description',
        'service_requests.status',
        'service_requests.date_reported',
        'service_requests.created_at',
      ])
      .leftJoin('service_requests.property', 'sr_property')
      .addSelect(['sr_property.id', 'sr_property.name', 'sr_property.location'])
      .leftJoin('account.property_histories', 'property_histories')
      .addSelect([
        'property_histories.id',
        'property_histories.event_type',
        'property_histories.event_description',
        'property_histories.move_in_date',
        'property_histories.move_out_date',
        'property_histories.move_out_reason',
        'property_histories.monthly_rent',
        'property_histories.owner_comment',
        'property_histories.created_at',
        'property_histories.related_entity_id',
        'property_histories.related_entity_type',
      ])
      .leftJoin('property_histories.property', 'past_property')
      .addSelect([
        'past_property.id',
        'past_property.name',
        'past_property.location',
        'past_property.owner_id',
      ])
      .leftJoin('account.notice_agreements', 'notice_agreements')
      .addSelect(['notice_agreements.id', 'notice_agreements.created_at'])
      .leftJoin('notice_agreements.property', 'notice_property')
      .addSelect(['notice_property.id', 'notice_property.name'])
      .where('account.id = :tenantId', { tenantId })
      .andWhere((qb) => {
        // Check for current tenancy OR past tenancy (property history)
        const currentTenancySubQuery = qb
          .subQuery()
          .select('1')
          .from(PropertyTenant, 'pt')
          .innerJoin('pt.property', 'p')
          .where('pt.tenant_id = account.id')
          .andWhere('p.owner_id = :adminId')
          .getQuery();

        const pastTenancySubQuery = qb
          .subQuery()
          .select('1')
          .from(PropertyHistory, 'ph')
          .innerJoin('ph.property', 'p')
          .where('ph.tenant_id = account.id')
          .andWhere('p.owner_id = :adminId')
          .getQuery();

        return `(EXISTS ${currentTenancySubQuery} OR EXISTS ${pastTenancySubQuery})`;
      })
      .setParameters({ tenantId, adminId })
      .getOne();

    console.log('🔍 DEBUG: Tenant query result:', {
      tenantId,
      adminId,
      found: !!tenantAccount?.id,
      propertyHistoriesCount: tenantAccount?.property_histories?.length || 0,
      rentsCount: tenantAccount?.rents?.length || 0,
      serviceRequestsCount: tenantAccount?.service_requests?.length || 0,
    });

    if (!tenantAccount?.id) {
      console.log('❌ DEBUG: Tenant not found for landlord:', {
        tenantId,
        adminId,
        timestamp: new Date().toISOString(),
      });
      throw new HttpException(
        `Tenant with id: ${tenantId} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    // Query KYC application separately to get all data and document URLs
    const kycApplication = await this.kycApplicationRepository.findOne({
      where: { tenant_id: tenantId },
      order: { created_at: 'DESC' },
    });

    // Query offer letters for this tenant (via KYC applications)
    const kycApplications = await this.kycApplicationRepository.find({
      where: { tenant_id: tenantId },
      select: ['id', 'property_id'],
    });
    const kycApplicationIds = kycApplications.map((k) => k.id);

    // Fetch applicant-phase property history records for the KYC application's property.
    // These events (kyc_form_viewed, kyc_application_submitted, offer_letter_sent, etc.)
    // may not have tenant_id set if the backfill was incomplete, so we query by property_id
    // and merge them into the tenant's property_histories to ensure the full applicant
    // journey always appears at the start of the tenant detail timeline.
    const kycPropertyIds = [
      ...new Set(
        kycApplications
          .map((k) => k.property_id)
          .filter((pid): pid is string => !!pid),
      ),
    ];

    if (kycPropertyIds.length > 0) {
      const propertyHistoryRepo =
        this.dataSource.getRepository(PropertyHistory);
      // Fetch events for the property where tenant_id is NULL (not yet backfilled)
      // or already belongs to this tenant. This avoids pulling in events from
      // other tenants on the same property.
      const applicantPhaseHistories = await propertyHistoryRepo
        .createQueryBuilder('ph')
        .leftJoinAndSelect('ph.property', 'property')
        .where('ph.property_id IN (:...propertyIds)', {
          propertyIds: kycPropertyIds,
        })
        .andWhere('(ph.tenant_id IS NULL OR ph.tenant_id = :tenantId)', {
          tenantId,
        })
        .orderBy('ph.created_at', 'ASC')
        .getMany();

      // Merge applicant-phase histories into the tenant account's property_histories,
      // deduplicating by id so events that were already backfilled don't appear twice.
      const existingIds = new Set(
        (tenantAccount.property_histories || []).map((ph) => ph.id),
      );
      const newHistories = applicantPhaseHistories.filter(
        (ph) => !existingIds.has(ph.id),
      );

      if (newHistories.length > 0) {
        tenantAccount.property_histories = [
          ...newHistories,
          ...(tenantAccount.property_histories || []),
        ];
      }
    }

    let offerLetters: OfferLetter[] = [];
    if (kycApplicationIds.length > 0) {
      offerLetters = await this.offerLetterRepository
        .createQueryBuilder('offer')
        .leftJoinAndSelect('offer.property', 'property')
        .where('offer.kyc_application_id IN (:...kycIds)', {
          kycIds: kycApplicationIds,
        })
        .andWhere('offer.landlord_id = :adminId', { adminId })
        .orderBy('offer.created_at', 'DESC')
        .getMany();
    }

    // Query payments for these offer letters
    let payments: Payment[] = [];
    if (offerLetters.length > 0) {
      const offerLetterIds = offerLetters.map((o) => o.id);
      payments = await this.paymentRepository
        .createQueryBuilder('payment')
        .leftJoinAndSelect('payment.offerLetter', 'offerLetter')
        .leftJoinAndSelect('offerLetter.property', 'property')
        .where('payment.offer_letter_id IN (:...offerIds)', {
          offerIds: offerLetterIds,
        })
        .andWhere('payment.status = :status', {
          status: PaymentStatus.COMPLETED,
        })
        .orderBy('payment.paid_at', 'DESC')
        .getMany();
    }

    return await this.formatTenantData(
      tenantAccount,
      kycApplication,
      adminId,
      offerLetters,
      payments,
    );
  }

  /**
   * Get tenant and property info for a tenant
   */
  async getTenantAndPropertyInfo(tenant_id: string): Promise<Account> {
    const tenant = await this.accountRepository.findOne({
      where: {
        id: tenant_id,
        role: RolesEnum.TENANT,
      },
      relations: [
        'user',
        'property_tenants',
        'property_tenants.property.rents',
      ],
    });

    if (!tenant?.id) {
      throw new HttpException(
        `Tenant with id: ${tenant_id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    return tenant;
  }

  /**
   * Format tenant data for response
   */
  private async formatTenantData(
    account: Account,
    kycApplication?: KYCApplication | null,
    adminId?: string,
    offerLetters?: OfferLetter[],
    payments?: Payment[],
  ): Promise<TenantDetailDto> {
    const user = account.user;
    const kyc = (user as Users & { kyc?: Record<string, string> }).kyc ?? {};
    const tenantKyc = (user as Users & { tenant_kycs?: TenantKycRecord[] })
      .tenant_kycs?.[0];

    // Filter data by adminId if provided
    const rents = adminId
      ? account.rents?.filter((r) => r.property?.owner_id === adminId) || []
      : account.rents || [];

    // Fetch wallet balance and ledger (requires adminId as landlordId)
    let walletBalance = 0;
    let ledgerEntries: TenantBalanceLedger[] = [];
    if (adminId) {
      walletBalance = await this.tenantBalancesService.getBalance(
        account.id,
        adminId,
      );
      ledgerEntries = await this.tenantBalancesService.getLedger(
        account.id,
        adminId,
      );
    }
    // Derive display values from unified balance
    const totalOutstandingBalance = walletBalance < 0 ? -walletBalance : 0;
    const totalCreditBalance = walletBalance > 0 ? walletBalance : 0;

    // Create maps for efficient lookups of related entities for date resolution
    const rentMap = new Map<string, any>();
    const propertyHistoryMap = new Map<string, any>();

    // Populate rent map for date resolution
    rents.forEach((rent) => {
      rentMap.set(rent.id, rent);
    });

    // Populate property history map for payment date resolution
    (account.property_histories || []).forEach((ph) => {
      if (ph.id) {
        propertyHistoryMap.set(ph.id, ph);
      }
    });

    // Build outstandingBalanceBreakdown from ledger entries grouped by property.
    // Charges: balance_change < 0. Exclude:
    //   - CREDIT_APPLIED: legacy artifact from old two-step payment flow
    //   - related_entity_type = 'property_history': these are reversal entries created
    //     when a manual payment is edited/deleted. They're accounting artifacts and
    //     should not appear as charges — the property_history record is authoritative
    //     for the current payment amount.
    // Note: MIGRATION entries are included — they represent real rent charges carried
    // forward at ledger setup time.
    const obEntriesByProperty = new Map<string, TenantBalanceLedger[]>();
    ledgerEntries
      .filter(
        (e) =>
          Number(e.balance_change) < 0 &&
          e.type !== TenantBalanceLedgerType.CREDIT_APPLIED &&
          e.related_entity_type !== 'property_history',
      )
      .forEach((e) => {
        const key = e.property_id || 'global';
        if (!obEntriesByProperty.has(key)) obEntriesByProperty.set(key, []);
        obEntriesByProperty.get(key)!.push(e);
      });

    const outstandingBalanceBreakdown = Array.from(
      obEntriesByProperty.entries(),
    ).map(([propId, entries]) => {
      const propRent = rents.find((r) => r.property_id === propId);
      return {
        rentId: propRent?.id || propId,
        propertyName:
          propRent?.property?.name ||
          entries[0]?.property?.name ||
          // For NULL property_id (migration entries), try to resolve from tenant's rent records
          (propId === 'global' && rents.length > 0
            ? rents[0].property?.name
            : null) ||
          'Unknown Property',
        propertyId: propId === 'global' ? propRent?.property_id || '' : propId,
        outstandingAmount: entries.reduce(
          (sum, e) => sum + -Number(e.balance_change),
          0,
        ),
        tenancyStartDate: propRent?.rent_start_date
          ? new Date(propRent.rent_start_date)
          : null,
        tenancyEndDate: propRent?.expiry_date
          ? new Date(propRent.expiry_date)
          : null,
        transactions: entries
          .map((e) => {
            // Implement date resolution based on related entity type
            let transactionDate: Date;
            // Normalize migration entries to the same label as initial_balance charges
            const baseDescription =
              e.type === TenantBalanceLedgerType.MIGRATION
                ? 'Historical tenancy recorded'
                : e.description || String(e.type);
            let periodDescription = baseDescription;

            if (e.related_entity_type === 'rent' && e.related_entity_id) {
              // For rent-related entries, use rent_start_date from the specific rent record
              const relatedRent = rentMap.get(e.related_entity_id);
              if (relatedRent && relatedRent.rent_start_date) {
                transactionDate = new Date(relatedRent.rent_start_date);

                // Generate specific period description for this rent
                const startDate = new Date(relatedRent.rent_start_date);
                const endDate = relatedRent.expiry_date
                  ? new Date(relatedRent.expiry_date)
                  : null;
                if (endDate) {
                  const startStr = startDate.toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  });
                  const endStr = endDate.toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  });
                  periodDescription = `${baseDescription} (${startStr} - ${endStr})`;
                }
              } else {
                // Fallback to created_at if rent record not found
                transactionDate = new Date(e.created_at!);
              }
            } else if (
              e.related_entity_type === 'property_history' &&
              e.related_entity_id
            ) {
              // For property history-related entries, use move_in_date from the specific property history record
              const relatedPH = propertyHistoryMap.get(e.related_entity_id);
              if (relatedPH && relatedPH.move_in_date) {
                transactionDate = new Date(relatedPH.move_in_date);
              } else {
                // Fallback to created_at if property history record not found
                transactionDate = new Date(e.created_at!);
              }
            } else {
              // For other entry types, use created_at
              transactionDate = new Date(e.created_at!);
            }

            return {
              id: e.id,
              type: periodDescription,
              amount: -Number(e.balance_change), // charges are negative balance_change; expose as positive
              date: transactionDate,
            };
          })
          .sort((a, b) => b.date.getTime() - a.date.getTime()),
      };
    });

    const serviceRequests = adminId
      ? account.service_requests?.filter(
          (sr) => sr.property?.owner_id === adminId,
        ) || []
      : account.service_requests || [];

    const propertyHistories = adminId
      ? account.property_histories?.filter(
          (ph) => ph.property?.owner_id === adminId,
        ) || []
      : account.property_histories || [];

    const noticeAgreements = adminId
      ? account.notice_agreements?.filter(
          (na) => na.property?.owner_id === adminId,
        ) || []
      : account.notice_agreements || [];

    // Find the most recent ACTIVE rent record for current details
    const activeRent = rents
      ?.filter((rent) => rent.rent_status === RentStatusEnum.ACTIVE)
      .sort(
        (a, b) =>
          new Date(b.expiry_date).getTime() - new Date(a.expiry_date).getTime(),
      )[0];
    const property = activeRent?.property;

    // Aggregate documents from different sources
    const documents = noticeAgreements
      .flatMap((na) => na.notice_documents || [])
      .map((doc, index) => ({
        id: `${account.id}-doc-${index}`,
        name: doc.name ?? 'Untitled Document',
        url: doc.url,
        type: doc.type ?? 'General',
        uploadDate: new Date().toISOString(),
      }));

    // Build the combined history timeline. Delegates to the shared
    // builder so the tenant view and the KYC-applicant timeline endpoint
    // return identical shapes and render via the same frontend component.
    const tenantName =
      `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Tenant';
    const history = buildTimelineEvents({
      propertyHistories,
      serviceRequests,
      offerLetters: offerLetters || [],
      payments: payments || [],
      tenantName,
    });

    // Fetch all pending landlord renewal invoices for active rents in one query
    const activeRentPropertyIds = rents
      .filter((r) => r.rent_status === RentStatusEnum.ACTIVE)
      .map((r) => r.property_id);

    const pendingInvoiceMap = new Map<
      string,
      { rentAmount: number; serviceCharge: number; totalAmount: number }
    >();

    if (activeRentPropertyIds.length > 0) {
      const pendingInvoices = await this.dataSource
        .getRepository(RenewalInvoice)
        .find({
          where: {
            tenant_id: account.id,
            payment_status: RenewalPaymentStatus.UNPAID,
            token_type: In(['landlord', 'draft']),
            property_id: In(activeRentPropertyIds),
          },
          order: { created_at: 'DESC' },
          select: [
            'id',
            'property_id',
            'rent_amount',
            'service_charge',
            'total_amount',
          ],
        });

      // Keep only the most-recent invoice per property (results already ordered DESC)
      for (const inv of pendingInvoices) {
        if (!pendingInvoiceMap.has(inv.property_id)) {
          pendingInvoiceMap.set(inv.property_id, {
            rentAmount: parseFloat(inv.rent_amount.toString()),
            serviceCharge: parseFloat((inv.service_charge || 0).toString()),
            totalAmount: parseFloat(inv.total_amount.toString()),
          });
        }
      }
    }

    // Pending invoice for the primary active rent (used by single-tenancy view)
    const activePendingInvoice = activeRent
      ? (pendingInvoiceMap.get(activeRent.property_id) ?? null)
      : null;

    // Fetch ALL renewal invoices for this tenant (for Documents tab)
    const allRenewalInvoices = await this.dataSource
      .getRepository(RenewalInvoice)
      .find({
        where: {
          tenant_id: account.id,
          ...(adminId
            ? {
                property: { owner_id: adminId },
              }
            : {}),
        },
        relations: ['property'],
        order: { created_at: 'DESC' },
        select: [
          'id',
          'token',
          'receipt_token',
          'property_id',
          'rent_amount',
          'total_amount',
          'payment_status',
          'created_at',
          'paid_at',
          'start_date',
          'end_date',
        ],
      });

    const renewalInvoiceSummaries = allRenewalInvoices.map((inv) => ({
      id: inv.id,
      token: inv.token,
      receiptToken: inv.receipt_token || null,
      propertyName: inv.property?.name || 'Property',
      totalAmount: parseFloat((inv.total_amount ?? 0).toString()),
      paymentStatus: inv.payment_status,
      createdAt: inv.created_at
        ? new Date(inv.created_at).toISOString()
        : new Date().toISOString(),
      paidAt: inv.paid_at
        ? typeof inv.paid_at === 'string'
          ? inv.paid_at
          : inv.paid_at.toISOString()
        : null,
      startDate: inv.start_date
        ? typeof inv.start_date === 'string'
          ? inv.start_date
          : inv.start_date.toISOString()
        : null,
      endDate: inv.end_date
        ? typeof inv.end_date === 'string'
          ? inv.end_date
          : inv.end_date.toISOString()
        : null,
    }));

    return {
      id: account.id,

      // Personal info
      firstName:
        kycApplication?.first_name ?? tenantKyc?.first_name ?? user.first_name,
      lastName:
        kycApplication?.last_name ?? tenantKyc?.last_name ?? user.last_name,
      phone:
        kycApplication?.phone_number ??
        tenantKyc?.phone_number ??
        user.phone_number,
      email: kycApplication?.email ?? tenantKyc?.email ?? account.email,
      dateOfBirth:
        this.formatDateField(tenantKyc?.date_of_birth) ??
        this.formatDateField(user.date_of_birth),
      gender:
        kycApplication?.gender ?? tenantKyc?.gender ?? user.gender ?? null,
      stateOfOrigin:
        kycApplication?.state_of_origin ??
        tenantKyc?.state_of_origin ??
        user.state_of_origin ??
        kyc.state_of_origin ??
        '',
      lga: user.lga ?? kyc.lga_of_origin ?? null,
      nationality:
        kycApplication?.nationality ??
        tenantKyc?.nationality ??
        user.nationality ??
        kyc.nationality ??
        null,
      maritalStatus:
        kycApplication?.marital_status ??
        tenantKyc?.marital_status ??
        user.marital_status ??
        kyc.marital_status ??
        null,
      religion: kycApplication?.religion ?? tenantKyc?.religion ?? null,

      // Employment Info
      employmentStatus:
        kycApplication?.employment_status ??
        tenantKyc?.employment_status ??
        user.employment_status ??
        null,
      employerName:
        kycApplication?.employer_name ??
        tenantKyc?.employer_name ??
        user.employer_name ??
        kyc.employers_name ??
        null,
      employerAddress:
        kycApplication?.work_address ??
        tenantKyc?.work_address ??
        user.employer_address ??
        kyc.employers_address ??
        null,
      jobTitle:
        kycApplication?.job_title ??
        tenantKyc?.job_title ??
        user.job_title ??
        kyc.occupation ??
        null,
      workEmail: user.work_email ?? null,
      monthlyIncome: kycApplication?.monthly_net_income
        ? parseFloat(kycApplication.monthly_net_income)
        : tenantKyc?.monthly_net_income
          ? parseFloat(tenantKyc.monthly_net_income)
          : (user.monthly_income ??
            (kyc ? parseFloat(kyc.monthly_income) : null)),
      employerPhoneNumber:
        kycApplication?.work_phone_number ??
        tenantKyc?.work_phone_number ??
        null,
      lengthOfEmployment:
        kycApplication?.length_of_employment ??
        tenantKyc?.length_of_employment ??
        null,

      // Self-employed Info
      natureOfBusiness:
        kycApplication?.nature_of_business ??
        tenantKyc?.nature_of_business ??
        null,
      businessName:
        kycApplication?.business_name ?? tenantKyc?.business_name ?? null,
      businessAddress:
        kycApplication?.business_address ?? tenantKyc?.business_address ?? null,
      businessDuration:
        kycApplication?.business_duration ??
        tenantKyc?.business_duration ??
        null,
      occupation:
        kycApplication?.occupation ??
        tenantKyc?.occupation ??
        kyc.occupation ??
        null,

      // Residence info
      currentAddress:
        kycApplication?.contact_address ??
        tenantKyc?.current_residence ??
        kyc.former_house_address ??
        null,

      // Next of Kin Info
      nokName:
        kycApplication?.next_of_kin_full_name ??
        tenantKyc?.next_of_kin_full_name ??
        kyc.next_of_kin ??
        null,
      nokRelationship:
        kycApplication?.next_of_kin_relationship ??
        tenantKyc?.next_of_kin_relationship ??
        null,
      nokPhone:
        kycApplication?.next_of_kin_phone_number ??
        tenantKyc?.next_of_kin_phone_number ??
        null,
      nokEmail:
        kycApplication?.next_of_kin_email ??
        tenantKyc?.next_of_kin_email ??
        null,
      nokAddress:
        kycApplication?.next_of_kin_address ??
        tenantKyc?.next_of_kin_address ??
        kyc.next_of_kin_address ??
        null,

      // Guarantor Info
      guarantorName:
        kycApplication?.referral_agent_full_name ??
        tenantKyc?.referral_agent_full_name ??
        (!kycApplication?.referral_agent_full_name &&
        !tenantKyc?.referral_agent_full_name
          ? (kycApplication?.next_of_kin_full_name ??
            tenantKyc?.next_of_kin_full_name)
          : null) ??
        kyc?.guarantor ??
        null,
      guarantorPhone:
        kycApplication?.referral_agent_phone_number ??
        tenantKyc?.referral_agent_phone_number ??
        (!kycApplication?.referral_agent_phone_number &&
        !tenantKyc?.referral_agent_phone_number
          ? (kycApplication?.next_of_kin_phone_number ??
            tenantKyc?.next_of_kin_phone_number)
          : null) ??
        kyc.guarantor_phone_number ??
        null,
      guarantorEmail:
        kycApplication?.next_of_kin_email ??
        tenantKyc?.next_of_kin_email ??
        null,
      guarantorAddress:
        kycApplication?.next_of_kin_address ??
        tenantKyc?.next_of_kin_address ??
        kyc.guarantor_address ??
        null,
      guarantorRelationship:
        kycApplication?.next_of_kin_relationship ??
        tenantKyc?.next_of_kin_relationship ??
        null,
      guarantorOccupation:
        kycApplication?.occupation ??
        tenantKyc?.occupation ??
        kyc.guarantor_occupation ??
        null,

      // Tenancy Proposal Information
      intendedUseOfProperty: kycApplication?.intended_use_of_property ?? null,
      numberOfOccupants: kycApplication?.number_of_occupants ?? null,
      numberOfCarsOwned: null,
      proposedRentAmount: kycApplication?.proposed_rent_amount ?? null,
      rentPaymentFrequency: kycApplication?.rent_payment_frequency ?? null,
      additionalNotes: kycApplication?.additional_notes ?? null,

      // Include TenantKyc ID for frontend updates
      tenantKycId: tenantKyc?.id ?? null,

      // Passport Photo URL from KYC Application
      passportPhotoUrl: kycApplication?.passport_photo_url ?? null,

      // current tenancy info
      property: property?.name || '——',
      propertyId: property?.id || '——',
      propertyAddress: property?.location || '——',
      propertyStatus: property?.property_status || 'Vacant',
      leaseStartDate: this.formatDateField(activeRent?.rent_start_date),
      leaseEndDate: this.formatDateField(activeRent?.expiry_date),
      firstRentDate: this.formatDateField(
        rents?.length
          ? rents.reduce(
              (earliest, rent) =>
                !earliest ||
                (rent.rent_start_date &&
                  new Date(rent.rent_start_date) < new Date(earliest))
                  ? rent.rent_start_date
                  : earliest,
              null as Date | null,
            )
          : null,
      ),
      tenancyStatus: activeRent?.rent_status ?? 'Inactive',
      rentAmount: activeRent?.rental_price || 0,
      serviceCharge: activeRent?.service_charge || 0,
      rentFrequency: activeRent?.payment_frequency || 'Annually',
      rentStatus: activeRent?.payment_status || '——',
      nextRentDue: this.formatDateField(activeRent?.expiry_date),
      pendingInvoiceRentAmount: activePendingInvoice?.rentAmount ?? null,
      pendingInvoiceTotalAmount: activePendingInvoice?.totalAmount ?? null,
      outstandingBalance: totalOutstandingBalance,
      creditBalance: totalCreditBalance,
      paymentFrequency: activeRent?.payment_frequency || null,
      paymentHistory: (account.rents || [])
        .map((rent) => ({
          id: rent.id,
          date: new Date(rent.created_at!).toISOString(),
          amount: rent.amount_paid,
          status: rent.payment_status,
          reference: rent.rent_receipts?.[0] || null,
        }))
        .sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        ),

      // Aggregated Lists
      documents: documents,
      maintenanceIssues: (account.service_requests || []).map((sr) => ({
        id: sr.id,
        title: sr.issue_category,
        description: sr.description,
        status: sr.status || '——',
        reportedDate: new Date(sr.date_reported).toISOString(),
        resolvedDate: sr.resolution_date
          ? new Date(sr.resolution_date).toISOString()
          : null,
        priority: sr.status === 'URGENT' ? 'High' : 'Medium',
      })),
      activeTenancies: rents
        .filter((rent) => rent.rent_status === RentStatusEnum.ACTIVE)
        .map((rent) => {
          const pendingInvoice =
            pendingInvoiceMap.get(rent.property_id) ?? null;
          return {
            id: rent.id,
            property: rent.property?.name ?? 'Unknown Property',
            propertyId: rent.property_id,
            rentAmount: rent.rental_price || 0,
            serviceCharge: rent.service_charge || 0,
            rentFrequency: rent.payment_frequency || 'Annually',
            rentDueDate: this.formatDateField(rent.expiry_date),
            tenancyStartDate: this.formatDateField(rent.rent_start_date),
            outstandingBalance: totalOutstandingBalance,
            pendingInvoiceRentAmount: pendingInvoice?.rentAmount ?? null,
            pendingInvoiceTotalAmount: pendingInvoice?.totalAmount ?? null,
            status: 'Active' as const,
          };
        }),
      tenancyHistory: (propertyHistories || [])
        .filter((ph) => ph.move_out_date)
        .map((ph) => ({
          id: ph.id,
          property: ph.property?.name ?? 'Unknown Property',
          startDate: this.formatDateField(ph.move_in_date) ?? '——',
          endDate: this.formatDateField(ph.move_out_date),
          status: 'Completed' as const,
        })),

      // System Info
      whatsAppConnected: false,

      // Outstanding Balance Info
      totalOutstandingBalance,
      totalCreditBalance,
      outstandingBalanceBreakdown,
      paymentTransactions: [
        // Manual payments — property history is the authority for which payments
        // currently exist and at what amount. Edited payments update in place so
        // we never see stale pre-edit amounts. Deleted payments remove the record.
        ...(account.property_histories || [])
          .filter((h) => {
            if (h.event_type !== 'user_added_payment') return false;
            if (adminId && h.property?.owner_id !== adminId) return false;
            return true;
          })
          .map((ph) => {
            try {
              const data = JSON.parse(ph.event_description || '{}');
              const amount = Number(data.paymentAmount || 0);
              if (amount <= 0) return null;
              return {
                id: `payment-history-${ph.id}`,
                type: data.description || 'Payment received',
                amount: -amount,
                date: ph.move_in_date
                  ? new Date(ph.move_in_date)
                  : new Date(ph.created_at!),
              };
            } catch {
              return null;
            }
          })
          .filter((t): t is NonNullable<typeof t> => t !== null),

        // Renewal invoice payments — no property history entry is created for
        // these, so we read them directly from the ledger.
        ...ledgerEntries
          .filter(
            (e) =>
              Number(e.balance_change) > 0 &&
              e.related_entity_type === 'renewal_invoice',
          )
          .map((e) => ({
            id: e.id,
            type: e.description || 'Renewal payment',
            amount: -Number(e.balance_change), // payments are positive balance_change; show as negative (money out for tenant)
            date: new Date(e.created_at!),
          })),
      ].sort((a, b) => b.date.getTime() - a.date.getTime()),

      history: history,
      renewalInvoices: renewalInvoiceSummaries,
      kycInfo: {
        kycStatus: kycApplication ? 'Verified' : 'Not Submitted',
        kycSubmittedDate: kycApplication?.created_at
          ? new Date(kycApplication.created_at).toISOString()
          : null,
        kycDocuments: kycApplication
          ? [
              ...(kycApplication.passport_photo_url
                ? [
                    {
                      id: `kyc-passport-${kycApplication.id}`,
                      name: 'Passport Photo',
                      type: 'Passport',
                      url: kycApplication.passport_photo_url,
                      uploadDate: kycApplication.created_at
                        ? new Date(kycApplication.created_at).toISOString()
                        : new Date().toISOString(),
                    },
                  ]
                : []),
              ...(kycApplication.id_document_url
                ? [
                    {
                      id: `kyc-id-${kycApplication.id}`,
                      name: 'ID Document',
                      type: 'ID',
                      url: kycApplication.id_document_url,
                      uploadDate: kycApplication.created_at
                        ? new Date(kycApplication.created_at).toISOString()
                        : new Date().toISOString(),
                    },
                  ]
                : []),
              ...(kycApplication.employment_proof_url
                ? [
                    {
                      id: `kyc-employment-${kycApplication.id}`,
                      name: 'Employment Proof',
                      type: 'Employment',
                      url: kycApplication.employment_proof_url,
                      uploadDate: kycApplication.created_at
                        ? new Date(kycApplication.created_at).toISOString()
                        : new Date().toISOString(),
                    },
                  ]
                : []),
              ...(kycApplication.business_proof_url
                ? [
                    {
                      id: `kyc-business-${kycApplication.id}`,
                      name: 'Business Proof',
                      type: 'Business',
                      url: kycApplication.business_proof_url,
                      uploadDate: kycApplication.created_at
                        ? new Date(kycApplication.created_at).toISOString()
                        : new Date().toISOString(),
                    },
                  ]
                : []),
            ]
          : [],
      },
    };
  }

  /**
   * Helper to format date fields
   */
  private formatDateField(
    date: string | Date | null | undefined,
  ): string | null {
    if (!date) return null;
    if (typeof date === 'string') return date;
    if (date instanceof Date) return date.toISOString().split('T')[0];
    return null;
  }

  /**
   * Helper to get service request update description
   */
  private getServiceRequestUpdateDescription(status: string): string {
    switch (status.toLowerCase()) {
      case 'resolved':
        return 'Issue fixed and marked as resolved.';
      case 'closed':
        return 'Tenant confirmed issue is fully resolved.';
      case 'reopened':
        return 'Tenant reopened the request: issue not fully resolved.';
      default:
        return 'Service request updated.';
    }
  }
}

/**
 * Internal interface for tenant KYC data from application
 */
interface TenantKycFromApplicationDto {
  phone_number: string;
  first_name: string;
  last_name: string;
  email: string;
  date_of_birth: Date;
  gender: string;
  state_of_origin: string;
  lga: string;
  nationality: string;
  employment_status: string;
  marital_status: string;
  property_id: string;
  rent_amount: number;
  rent_frequency: string;
  tenancy_start_date: Date;
  rent_due_date: Date;
  employer_name?: string;
  job_title?: string;
  employer_address?: string;
  monthly_income?: number;
  work_email?: string;
  business_name?: string;
  nature_of_business?: string;
  business_address?: string;
  business_monthly_income?: number;
  business_website?: string;
  source_of_funds?: string;
  monthly_income_estimate?: number;
  spouse_full_name?: string;
  spouse_phone_number?: string;
  spouse_occupation?: string;
  spouse_employer?: string;
  service_charge?: number;
  caution_deposit?: number;
  legal_fee?: number;
  agency_fee?: number;
  // Billing v2 — per-fee recurring flags + dynamic other fees.
  service_charge_recurring?: boolean;
  security_deposit_recurring?: boolean;
  legal_fee_recurring?: boolean;
  agency_fee_recurring?: boolean;
  other_fees?: Array<{
    externalId: string;
    name: string;
    amount: number;
    recurring: boolean;
  }>;
}

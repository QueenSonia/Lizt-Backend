import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreatePropertyDto,
  PropertyFilter,
  PropertyStatusEnum,
  TenantStatusEnum,
} from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Property } from './entities/property.entity';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { buildPropertyFilter } from 'src/filters/query-filter';
import { ServiceRequestStatusEnum } from 'src/service-requests/dto/create-service-request.dto';
import { DateService } from 'src/utils/date.helper';
import { PropertyTenant } from './entities/property-tenants.entity';
import { config } from 'src/config';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { MoveTenantInDto, MoveTenantOutDto } from './dto/move-tenant.dto';
import { PropertyGroup } from './entities/property-group.entity';
import { ScheduledMoveOut } from './entities/scheduled-move-out.entity';
import { CreatePropertyGroupDto } from './dto/create-property-group.dto';
import { RentsService } from 'src/rents/rents.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Users } from 'src/users/entities/user.entity';
import { UsersService } from 'src/users/users.service';
import { AssignTenantDto } from './dto/assign-tenant.dto';
import { Rent } from 'src/rents/entities/rent.entity';
import {
  RentPaymentStatusEnum,
  RentStatusEnum,
} from 'src/rents/dto/create-rent.dto';
import { UtilService } from 'src/utils/utility-service';
import { WhatsappBotService } from 'src/whatsapp-bot/whatsapp-bot.service';
import { WhatsAppNotificationLogService } from 'src/whatsapp-bot/whatsapp-notification-log.service';
import { PerformanceMonitor } from 'src/utils/performance-monitor';
import { KYCApplicationService } from 'src/kyc-links/kyc-application.service';
import { KYCLink } from 'src/kyc-links/entities/kyc-link.entity';
import {
  TenantKyc,
  Gender,
  MaritalStatus,
  EmploymentStatus,
} from 'src/tenant-kyc/entities/tenant-kyc.entity';
import { Account } from 'src/users/entities/account.entity';
import {
  KYCApplication,
  ApplicationStatus,
  ApplicationType,
} from 'src/kyc-links/entities/kyc-application.entity';
import { ExistingTenantDto } from './dto/existing-tenant.dto';
import { CreatePropertyWithTenantDto } from './dto/create-property-with-tenant.dto';
import { RolesEnum } from 'src/base.entity';
import { KYCLinksService } from 'src/kyc-links/kyc-links.service';
import { DatabaseErrorHandlerService } from 'src/database/database-error-handler.service';
import { OfferLetter } from 'src/offer-letters/entities/offer-letter.entity';
import { NotificationService } from 'src/notifications/notification.service';
import { NotificationType } from 'src/notifications/enums/notification-type';
import {
  RenewalInvoice,
  RenewalPaymentStatus,
} from 'src/tenancies/entities/renewal-invoice.entity';
import { TenantBalancesService } from 'src/tenant-balances/tenant-balances.service';
import { TenantBalanceLedgerType } from 'src/tenant-balances/entities/tenant-balance-ledger.entity';

@Injectable()
export class PropertiesService {
  constructor(
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(PropertyGroup)
    private readonly propertyGroupRepository: Repository<PropertyGroup>,
    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepository: Repository<PropertyHistory>,
    @InjectRepository(ScheduledMoveOut)
    private readonly scheduledMoveOutRepository: Repository<ScheduledMoveOut>,
    @InjectRepository(TenantKyc)
    private readonly tenantKycRepository: Repository<TenantKyc>,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(Rent)
    private readonly rentRepository: Repository<Rent>,
    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepository: Repository<KYCApplication>,
    @InjectRepository(KYCLink)
    private readonly kycLinkRepository: Repository<KYCLink>,
    @InjectRepository(RenewalInvoice)
    private readonly renewalInvoiceRepository: Repository<RenewalInvoice>,
    private readonly userService: UsersService,
    private readonly rentService: RentsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
    private readonly kycApplicationService: KYCApplicationService,
    private readonly kycLinksService: KYCLinksService,
    private readonly utilService: UtilService,
    private readonly whatsappBotService: WhatsappBotService,
    private readonly databaseErrorHandler: DatabaseErrorHandlerService,
    private readonly notificationService: NotificationService,
    private readonly whatsappNotificationLog: WhatsAppNotificationLogService,
    private readonly tenantBalancesService: TenantBalancesService,
  ) {}

  async createProperty(
    propertyData: CreatePropertyDto,
    ownerId: string,
  ): Promise<Property> {
    try {
      // create the property
      const newProperty = this.propertyRepository.create({
        ...propertyData,
        owner_id: ownerId,
      });

      // save the single entity to the database
      const savedProperty = await this.propertyRepository.save(newProperty);

      // Add a history record for property creation
      await this.propertyHistoryRepository.save({
        property_id: savedProperty.id,
        event_type: 'property_created',
        event_description: 'Property was added to the system.',
      });

      //// Tenant assignment-on-property-creation option removed from frontend form
      // If tenant_id is provided, create PropertyTenant relationship
      // if (propertyData.tenant_id) {
      //   const propertyTenant = this.propertyTenantRepository.create({
      //     property_id: savedProperty.id,
      //     tenant_id: propertyData.tenant_id,
      //     status: TenantStatusEnum.ACTIVE,
      //   });

      //   await this.propertyTenantRepository.save(propertyTenant);

      //   // Update property status to NOT_VACANT
      //   savedProperty.property_status = PropertyStatusEnum.OCCUPIED;
      //   await this.propertyRepository.save(savedProperty);
      // }

      // ✅ Emit event after property is created
      this.eventEmitter.emit('property.created', {
        property_id: savedProperty.id,
        property_name: savedProperty.name,
        user_id: savedProperty.owner_id,
      });

      // Get the full property with relations for notification
      const property = await this.getPropertyById(savedProperty.id);

      if (!property?.owner?.user?.phone_number) {
        console.warn(
          'Property owner or phone number not found for notification',
        );
      } else {
        const admin_phone_number = this.utilService.normalizePhoneNumber(
          property.owner.user.phone_number,
        );

        // Fire-and-forget - don't block response for notification
        this.userService
          .sendPropertiesNotification({
            phone_number: admin_phone_number,
            name: 'Admin',
            property_name: savedProperty.name,
          })
          .catch((error) => {
            console.error('Failed to send properties notification:', error);
          });
      }
      return savedProperty;
    } catch (error) {
      // Log the detailed error and throw a standardized exception
      console.error('Error creating property in service:', error);
      throw new Error(`Failed to create property: ${error.message}`);
    }
  }

  /**
   * Create a property with an existing tenant
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
   */
  async createPropertyWithExistingTenant(
    propertyData: CreatePropertyDto,
    tenantData: ExistingTenantDto,
    ownerId: string,
  ): Promise<{
    property: Property;
    kycStatus: string;
    isExistingTenant: boolean;
  }> {
    // Validate input data
    if (!propertyData || !tenantData || !ownerId) {
      throw new HttpException(
        'Missing required data for property creation',
        HttpStatus.BAD_REQUEST,
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      console.log('🏠 Creating property with existing tenant:', {
        propertyName: propertyData.name,
        tenantPhone: tenantData.phone,
        ownerId,
        timestamp: new Date().toISOString(),
      });
      // 1. Create property record
      const newProperty = queryRunner.manager.create(Property, {
        ...propertyData,
        owner_id: ownerId,
        property_status: PropertyStatusEnum.OCCUPIED, // Property is occupied from the start
      });
      const savedProperty = await queryRunner.manager.save(
        Property,
        newProperty,
      );

      // 2. Normalize tenant phone number
      const normalizedPhone = this.utilService.normalizePhoneNumber(
        tenantData.phone,
      );

      // 3. Check for duplicate phone (for warning - doesn't block creation)
      const duplicateCheck = await this.checkExistingTenant(
        ownerId,
        normalizedPhone,
      );
      if (duplicateCheck.exists) {
        console.log(
          `⚠️ Warning: Phone number ${normalizedPhone} already exists for property: ${duplicateCheck.propertyName}`,
        );
      }

      const firstName = tenantData.firstName;
      const lastName = tenantData.surname;

      // 4. Find or create tenant user (BEFORE transaction to avoid transaction abort issues)
      console.log('🔍 Step 4: Checking for existing tenant user...', {
        normalizedPhone,
        firstName,
        lastName,
      });

      // Try multiple phone number formats to find existing user
      let tenantUser = await this.usersRepository.findOne({
        where: { phone_number: normalizedPhone },
      });

      if (!tenantUser) {
        // Try with original phone format
        console.log('🔄 Trying with original phone format:', tenantData.phone);
        tenantUser = await this.usersRepository.findOne({
          where: { phone_number: tenantData.phone },
        });
      }

      if (!tenantUser) {
        // Try without the + prefix (database might store without it)
        const phoneWithoutPlus = normalizedPhone.replace('+', '');
        console.log('� Tsrying without + prefix:', phoneWithoutPlus);
        tenantUser = await this.usersRepository.findOne({
          where: { phone_number: phoneWithoutPlus },
        });
      }

      console.log('📞 User lookup result:', {
        found: !!tenantUser,
        userId: tenantUser?.id,
        userRole: tenantUser?.role,
      });

      if (!tenantUser) {
        // Create new user OUTSIDE transaction first
        const email =
          tenantData.email ||
          `${normalizedPhone.replace('+', '')}@placeholder.lizt.app`;

        console.log('👤 Creating new user...', {
          firstName,
          lastName,
          phone: normalizedPhone,
          email,
        });

        try {
          tenantUser = this.usersRepository.create({
            first_name: firstName,
            last_name: lastName,
            phone_number: normalizedPhone,
            email: email,
            role: RolesEnum.TENANT,
            is_verified: false,
            creator_id: ownerId,
          });
          tenantUser = await this.usersRepository.save(tenantUser);
          console.log('✅ User created successfully:', {
            userId: tenantUser.id,
            phone: tenantUser.phone_number,
          });
        } catch (userError) {
          console.error('❌ User creation failed:', {
            errorCode: userError.code,
            errorMessage: userError.message,
            constraint: userError.constraint,
            detail: userError.detail,
          });

          // If user creation fails due to duplicate, try to find the existing user again
          if (userError.code === '23505') {
            console.log(
              `✅ User already exists, finding existing user for new property...`,
            );

            // Try all phone number formats again
            tenantUser = await this.usersRepository.findOne({
              where: { phone_number: normalizedPhone },
            });

            if (!tenantUser) {
              tenantUser = await this.usersRepository.findOne({
                where: { phone_number: tenantData.phone },
              });
            }

            if (!tenantUser) {
              const phoneWithoutPlus = normalizedPhone.replace('+', '');
              tenantUser = await this.usersRepository.findOne({
                where: { phone_number: phoneWithoutPlus },
              });
            }

            // If phone lookup failed and duplicate was on email, try finding by email
            if (!tenantUser && tenantData.email) {
              tenantUser = await this.usersRepository.findOne({
                where: { email: tenantData.email },
              });

              // Update the existing user's phone to match what the landlord entered
              if (tenantUser && tenantUser.phone_number !== normalizedPhone) {
                console.log('📞 Updating existing user phone number:', {
                  oldPhone: tenantUser.phone_number,
                  newPhone: normalizedPhone,
                });
                tenantUser.phone_number = normalizedPhone;
                tenantUser = await this.usersRepository.save(tenantUser);
              }
            }

            if (!tenantUser) {
              throw new HttpException(
                'Unable to find the existing user with this phone number or email. Please try again.',
                HttpStatus.INTERNAL_SERVER_ERROR,
              );
            }

            console.log('✅ Found and reusing existing user:', {
              userId: tenantUser.id,
              phone: tenantUser.phone_number,
              role: tenantUser.role,
            });
          } else {
            throw userError;
          }
        }
      } else {
        console.log('✅ Using existing user:', {
          userId: tenantUser.id,
          phone: tenantUser.phone_number,
          role: tenantUser.role,
        });
      }

      // 6. Create tenant account
      // Check outside transaction first
      let tenantAccount = await this.accountRepository.findOne({
        where: { userId: tenantUser.id, role: RolesEnum.TENANT },
      });

      if (!tenantAccount) {
        // Double-check within transaction
        tenantAccount = await queryRunner.manager.findOne(Account, {
          where: { userId: tenantUser.id, role: RolesEnum.TENANT },
        });
      }

      if (!tenantAccount) {
        try {
          tenantAccount = queryRunner.manager.create(Account, {
            userId: tenantUser.id,
            email: tenantUser.email,
            role: RolesEnum.TENANT,
            is_verified: false,
            creator_id: ownerId,
          });
          tenantAccount = await queryRunner.manager.save(
            Account,
            tenantAccount,
          );
        } catch (accountError) {
          // If account creation fails due to duplicate, try to fetch the existing account
          if (accountError.code === '23505') {
            console.log(
              `Account for user ${tenantUser.id} was created by another process, fetching...`,
            );
            tenantAccount = await this.accountRepository.findOne({
              where: { userId: tenantUser.id, role: RolesEnum.TENANT },
            });
            if (!tenantAccount) {
              throw new HttpException(
                'Failed to create or find tenant account',
                HttpStatus.INTERNAL_SERVER_ERROR,
              );
            }
          } else {
            throw accountError;
          }
        }
      }

      // 7. Get or create KYC link for landlord
      const kycLinkResponse = await this.kycLinksService.generateKYCLink(
        ownerId,
        'property_addition',
      );

      // Get the actual KYC link entity
      const kycLink = await queryRunner.manager.findOne(KYCLink, {
        where: { landlord_id: ownerId, is_active: true },
      });

      if (!kycLink) {
        throw new HttpException(
          'Failed to get or create KYC link for landlord',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // 8. Check if tenant already has ANY KYC application for this landlord
      let kycApplication = await queryRunner.manager.findOne(KYCApplication, {
        where: {
          tenant_id: tenantAccount.id,
          kyc_link: { landlord_id: ownerId },
        },
        relations: ['kyc_link'],
        order: {
          created_at: 'DESC', // Most recent first
        },
      });

      let isNewKycApplication = false;
      // Track whether tenant had a prior KYC so we can pick the right WhatsApp message
      const hadExistingKyc = !!kycApplication;

      if (kycApplication) {
        const status = kycApplication.status;

        if (
          status === ApplicationStatus.APPROVED ||
          status === ApplicationStatus.REJECTED
        ) {
          console.log(
            `${status === ApplicationStatus.APPROVED ? '✅' : '❌'} Tenant has ${status} KYC — creating PROPERTY_ADDITION placeholder pre-filled with existing data`,
          );
          // Create a new PENDING_COMPLETION PROPERTY_ADDITION placeholder for this property,
          // pre-filled with their existing data so the frontend can autofill and detect
          // the form type via check-pending.
          const newPlaceholder = queryRunner.manager.create(KYCApplication, {
            kyc_link_id: kycLink.id,
            property_id: savedProperty.id,
            initial_property_id: savedProperty.id,
            tenant_id: tenantAccount.id,
            status: ApplicationStatus.PENDING_COMPLETION,
            application_type: ApplicationType.PROPERTY_ADDITION,
            // Copy personal/employment/next-of-kin data from existing application
            first_name: kycApplication.first_name,
            last_name: kycApplication.last_name,
            phone_number: kycApplication.phone_number,
            email: kycApplication.email,
            contact_address: kycApplication.contact_address,
            date_of_birth: kycApplication.date_of_birth,
            gender: kycApplication.gender,
            nationality: kycApplication.nationality,
            state_of_origin: kycApplication.state_of_origin,
            marital_status: kycApplication.marital_status,
            employment_status: kycApplication.employment_status,
            religion: kycApplication.religion,
            occupation: kycApplication.occupation,
            job_title: kycApplication.job_title,
            employer_name: kycApplication.employer_name,
            work_address: kycApplication.work_address,
            work_phone_number: kycApplication.work_phone_number,
            monthly_net_income: kycApplication.monthly_net_income,
            length_of_employment: kycApplication.length_of_employment,
            nature_of_business: kycApplication.nature_of_business,
            business_name: kycApplication.business_name,
            business_address: kycApplication.business_address,
            business_duration: kycApplication.business_duration,
            next_of_kin_full_name: kycApplication.next_of_kin_full_name,
            next_of_kin_address: kycApplication.next_of_kin_address,
            next_of_kin_relationship: kycApplication.next_of_kin_relationship,
            next_of_kin_phone_number: kycApplication.next_of_kin_phone_number,
            next_of_kin_email: kycApplication.next_of_kin_email,
            passport_photo_url: kycApplication.passport_photo_url || '-',
            id_document_url: kycApplication.id_document_url || '-',
            employment_proof_url: kycApplication.employment_proof_url,
            business_proof_url: kycApplication.business_proof_url,
            // Tenancy fields intentionally omitted — not part of this form
          });
          await queryRunner.manager.save(KYCApplication, newPlaceholder);
          kycApplication = newPlaceholder;
        } else if (status === ApplicationStatus.PENDING) {
          console.log(
            '⏳ Tenant has KYC AWAITING APPROVAL — no new form needed',
          );
        } else if (status === ApplicationStatus.PENDING_COMPLETION) {
          console.log(
            '📝 Tenant has PENDING COMPLETION KYC — ensuring PROPERTY_ADDITION type',
          );
          // Ensure the placeholder is marked as property addition for this property
          await queryRunner.manager.update(KYCApplication, kycApplication.id, {
            application_type: ApplicationType.PROPERTY_ADDITION,
            property_id: savedProperty.id,
          });
          kycApplication.application_type = ApplicationType.PROPERTY_ADDITION;
        }
      } else {
        // Create new KYC application only if tenant has NO existing KYC for this landlord
        console.log('🆕 Creating new KYC application for new tenant');
        isNewKycApplication = true;
        kycApplication = queryRunner.manager.create(KYCApplication, {
          kyc_link_id: kycLink.id,
          property_id: savedProperty.id,
          initial_property_id: savedProperty.id,
          tenant_id: tenantAccount.id,
          status: ApplicationStatus.PENDING_COMPLETION,
          application_type: ApplicationType.PROPERTY_ADDITION, // Mark as property addition
          first_name: firstName,
          last_name: lastName,
          phone_number: normalizedPhone,
          email: tenantData.email || '-',
          // Placeholder defaults for required fields — tenant will complete these via KYC form
          contact_address: '-',
          date_of_birth: new Date('1900-01-01'),
          gender: Gender.MALE,
          nationality: '-',
          state_of_origin: '-',
          marital_status: MaritalStatus.SINGLE,
          employment_status: EmploymentStatus.EMPLOYED,
          religion: '-',
          next_of_kin_full_name: '-',
          next_of_kin_address: '-',
          next_of_kin_relationship: '-',
          next_of_kin_phone_number: '-',
          next_of_kin_email: '-',
          // Tenancy fields are optional for PROPERTY_ADDITION - will be null in DB
          passport_photo_url: '-',
          id_document_url: '-',
        });
        await queryRunner.manager.save(KYCApplication, kycApplication);
      }

      // 9. Attach tenant to property
      // Check if this tenant is already attached to this property
      let propertyTenant = await queryRunner.manager.findOne(PropertyTenant, {
        where: {
          property_id: savedProperty.id,
          tenant_id: tenantAccount.id,
        },
      });

      if (propertyTenant) {
        // Update existing relationship to active status
        propertyTenant.status = TenantStatusEnum.ACTIVE;
        await queryRunner.manager.save(PropertyTenant, propertyTenant);
        console.log(
          '✅ Updated existing property-tenant relationship to active',
        );
      } else {
        // Create new property-tenant relationship
        propertyTenant = queryRunner.manager.create(PropertyTenant, {
          property_id: savedProperty.id,
          tenant_id: tenantAccount.id,
          status: TenantStatusEnum.ACTIVE,
        });
        await queryRunner.manager.save(PropertyTenant, propertyTenant);
        console.log('✅ Created new property-tenant relationship');
      }

      // 10. Create rent records
      const rentStartDate = new Date(tenantData.tenancyStartDate);
      const rentDueDate = new Date(tenantData.rentDueDate);

      // Calculate expiry date based on rent frequency
      let expiryDate: Date;
      const frequency = tenantData.rentFrequency.toLowerCase();
      if (frequency === 'monthly') {
        expiryDate = new Date(rentStartDate);
        expiryDate.setMonth(expiryDate.getMonth() + 1);
      } else if (frequency === 'quarterly') {
        expiryDate = new Date(rentStartDate);
        expiryDate.setMonth(expiryDate.getMonth() + 3);
      } else if (frequency === 'annually' || frequency === 'yearly') {
        expiryDate = new Date(rentStartDate);
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);
      } else {
        // Default to monthly
        expiryDate = new Date(rentStartDate);
        expiryDate.setMonth(expiryDate.getMonth() + 1);
      }

      const rent = queryRunner.manager.create(Rent, {
        property_id: savedProperty.id,
        tenant_id: tenantAccount.id,
        rent_start_date: rentStartDate,
        expiry_date: expiryDate,
        rental_price: tenantData.rentAmount,
        amount_paid: tenantData.rentAmount,
        service_charge: tenantData.serviceChargeAmount || 0,
        payment_frequency: tenantData.rentFrequency,
        payment_status: RentPaymentStatusEnum.PAID,
        rent_status: RentStatusEnum.ACTIVE,
      });
      await queryRunner.manager.save(Rent, rent);

      // 11. Property status already set to OCCUPIED in step 1

      // 12. Create property history record
      const propertyHistory = queryRunner.manager.create(PropertyHistory, {
        property_id: savedProperty.id,
        tenant_id: tenantAccount.id,
        event_type: 'tenancy_started',
        move_in_date: rentStartDate,
        monthly_rent: tenantData.rentAmount,
        owner_comment: 'Tenant moved in', // Simplified comment
        tenant_comment: null,
        move_out_date: null,
        move_out_reason: null,
      });
      await queryRunner.manager.save(PropertyHistory, propertyHistory);

      // Commit transaction before sending WhatsApp (non-critical operation)
      await queryRunner.commitTransaction();

      // 13. Queue WhatsApp notification based on KYC status (logged to DB, sent async with retries)
      try {
        const landlord = await this.usersRepository.findOne({
          where: { id: ownerId },
        });

        const landlordName = landlord
          ? this.utilService.toSentenceCase(landlord.first_name)
          : 'Your landlord';

        const tenantName = this.utilService.toSentenceCase(firstName);

        // Only send link if tenant needs to fill the form (PENDING_COMPLETION)
        // PENDING means they already submitted — no form needed, but still notify them
        if (kycApplication.status === ApplicationStatus.PENDING_COMPLETION) {
          await this.whatsappNotificationLog.queue(
            'sendKYCCompletionLink',
            {
              phone_number: normalizedPhone,
              tenant_name: tenantName,
              landlord_name: landlordName,
              property_name: savedProperty.name,
              kyc_link_id: kycLink.token,
              landlord_id: ownerId,
              recipient_name: tenantName,
              // 'update' if they had a prior KYC with this landlord, 'complete' if brand new
              action_text: hadExistingKyc ? 'update' : 'complete',
            },
            savedProperty.id,
          );
        } else if (kycApplication.status === ApplicationStatus.PENDING) {
          await this.whatsappBotService.sendTenantWelcomeTemplate({
            phone_number: normalizedPhone,
            tenant_name: tenantName,
            landlord_name: landlordName,
            property_name: savedProperty.name,
            property_id: savedProperty.id,
          });
        }
      } catch (error) {
        console.error('Failed to queue WhatsApp notification:', error);
      }

      // Emit event after property is created
      this.eventEmitter.emit('property.created', {
        property_id: savedProperty.id,
        property_name: savedProperty.name,
        user_id: savedProperty.owner_id,
        has_tenant: true,
      });

      // Emit tenant attached event for live feed
      this.eventEmitter.emit('tenant.attached', {
        property_id: savedProperty.id,
        property_name: savedProperty.name,
        tenant_id: tenantAccount.id,
        tenant_name: `${firstName} ${lastName}`,
        user_id: ownerId,
      });

      // Determine if tenant is "existing" - true if we reused an existing KYC application
      const isExistingTenant = !isNewKycApplication;

      console.log('✅ Property with existing tenant created successfully:', {
        propertyId: savedProperty.id,
        propertyName: savedProperty.name,
        kycStatus: kycApplication.status,
        isExistingTenant,
        timestamp: new Date().toISOString(),
      });

      return {
        property: savedProperty,
        kycStatus: kycApplication.status,
        isExistingTenant,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();

      // Enhanced error logging
      console.error('❌ Error creating property with existing tenant:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        propertyData: {
          name: propertyData.name,
          location: propertyData.location,
        },
        tenantData: {
          firstName: tenantData.firstName,
          surname: tenantData.surname,
          phone: tenantData.phone,
        },
        ownerId,
        timestamp: new Date().toISOString(),
      });

      // Provide specific error messages based on error type
      if (error instanceof HttpException) {
        throw error;
      }

      // Database constraint violations
      if (error.code === '23505') {
        // Check which constraint was violated
        const constraintName = error.constraint || '';
        const errorDetail = error.detail || '';

        if (
          constraintName.includes('phone') ||
          errorDetail.includes('phone_number')
        ) {
          throw new HttpException(
            'This phone number is already registered. The existing tenant will be reused for this property.',
            HttpStatus.CONFLICT,
          );
        }

        if (constraintName.includes('email') || errorDetail.includes('email')) {
          throw new HttpException(
            'This email address is already registered in the system. Please use a different email or leave it blank.',
            HttpStatus.CONFLICT,
          );
        }

        if (
          errorDetail.includes('name') ||
          errorDetail.includes('properties')
        ) {
          throw new HttpException(
            'A property with this name already exists. Please choose a different name.',
            HttpStatus.CONFLICT,
          );
        }

        // Check for property-tenant relationship constraint
        if (
          constraintName.includes('property_tenants') ||
          errorDetail.includes('property_tenants')
        ) {
          throw new HttpException(
            'This tenant is already attached to this property. Please check your data.',
            HttpStatus.CONFLICT,
          );
        }

        // Generic duplicate error
        throw new HttpException(
          'Some information is already in use. Tenants can be reused across multiple properties, but property names must be unique.',
          HttpStatus.CONFLICT,
        );
      }

      // Foreign key violations
      if (error.code === '23503') {
        throw new HttpException(
          'Invalid data provided. Please check all fields and try again.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Generic database errors
      if (error.code && error.code.startsWith('23')) {
        throw new HttpException(
          'Unable to create property due to data conflict. Please review your information and try again.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Default error
      throw new HttpException(
        `Failed to create property with tenant: ${error.message || 'Please try again or contact support.'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      await queryRunner.release();
    }
  }

  async getAllProperties(queryParams: PropertyFilter) {
    const page = queryParams.page
      ? Number(queryParams.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const { query } = await buildPropertyFilter(queryParams);

    // Optimized query: only select columns actually used by frontend
    const qb = this.propertyRepository
      .createQueryBuilder('property')
      .select([
        'property.id',
        'property.name',
        'property.description',
        'property.location',
        'property.property_status',
        'property.property_type',
        'property.rental_price',
        'property.is_marketing_ready',
        'property.owner_id',
      ])
      // Only load active rents with needed columns
      .leftJoin(
        'property.rents',
        'rents',
        'rents.rent_status = :activeStatus AND rents.deleted_at IS NULL',
        { activeStatus: RentStatusEnum.ACTIVE },
      )
      .addSelect([
        'rents.id',
        'rents.rent_status',
        'rents.rental_price',
        'rents.expiry_date',
        'rents.payment_frequency',
        'rents.rent_start_date',
        'rents.tenant_id',
      ])
      // Tenant account - minimal columns
      .leftJoin('rents.tenant', 'tenant')
      .addSelect(['tenant.id', 'tenant.userId'])
      // User - only name/contact fields used by frontend
      .leftJoin('tenant.user', 'user')
      .addSelect([
        'user.id',
        'user.first_name',
        'user.last_name',
        'user.phone_number',
        'user.email',
      ])
      // TenantKyc - only override fields (first_name, last_name, phone, email)
      .leftJoin(
        'user.tenant_kycs',
        'tenantKyc',
        'tenantKyc.admin_id = property.owner_id AND tenantKyc.deleted_at IS NULL',
      )
      .addSelect([
        'tenantKyc.id',
        'tenantKyc.first_name',
        'tenantKyc.last_name',
        'tenantKyc.phone_number',
        'tenantKyc.email',
      ])
      // property_tenants not used in list view transformation, skip it
      .loadRelationCountAndMap(
        'property.offer_letter_count',
        'property.offer_letters',
      )
      .where(query);

    // Apply sorting (rent requires custom logic)
    if (queryParams.sort_by === 'rent' && queryParams?.sort_order) {
      qb.orderBy(
        'rents.rental_price',
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
    } else if (queryParams.sort_by === 'expiry' && queryParams?.sort_order) {
      qb.orderBy(
        'rents.expiry_date',
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
    } else if (queryParams.sort_by && queryParams?.sort_order) {
      qb.orderBy(
        `property.${queryParams.sort_by}`,
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
    }

    const [properties, count] = await qb
      .skip(skip)
      .take(size)
      .getManyAndCount();

    const totalPages = Math.ceil(count / size);

    return {
      properties,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  // async getVacantProperty(query: { owner_id: string }) {
  //   return await this.propertyRepository.find({
  //     where: {
  //       property_status: PropertyStatusEnum.VACANT,
  //       ...query,
  //     },
  //     relations: ['property_tenants', 'rents', 'rents.tenant'],
  //   });
  // }

  async getVacantProperties(ownerId: string): Promise<Property[]> {
    return this.propertyRepository
      .createQueryBuilder('property')
      .select([
        'property.id',
        'property.name',
        'property.location',
        'property.property_status',
        'property.rental_price',
        'property.is_marketing_ready',
      ])
      .where('property.owner_id = :ownerId', { ownerId })
      .andWhere('property.property_status IN (:...statuses)', {
        statuses: [
          PropertyStatusEnum.VACANT,
          PropertyStatusEnum.OFFER_PENDING,
          PropertyStatusEnum.OFFER_ACCEPTED,
        ],
      })
      .getMany();
  }

  async fetchAllVacantProperties(ownerId: string): Promise<Property[]> {
    return this.getVacantProperties(ownerId);
  }

  async getMarketingReadyProperties(ownerId: string): Promise<Property[]> {
    return this.propertyRepository
      .createQueryBuilder('property')
      .select([
        'property.id',
        'property.name',
        'property.location',
        'property.property_status',
        'property.rental_price',
        'property.is_marketing_ready',
      ])
      .where('property.owner_id = :ownerId', { ownerId })
      .andWhere('property.is_marketing_ready = :isReady', { isReady: true })
      .andWhere('property.property_status IN (:...statuses)', {
        statuses: [
          PropertyStatusEnum.VACANT,
          PropertyStatusEnum.OFFER_PENDING,
          PropertyStatusEnum.OFFER_ACCEPTED,
        ],
      })
      .getMany();
  }

  async getPropertyById(id: string): Promise<any> {
    // Use query builder for better performance - only load needed columns
    const property = await this.propertyRepository
      .createQueryBuilder('property')
      .leftJoin('property.rents', 'rent')
      .addSelect([
        'rent.id',
        'rent.tenant_id',
        'rent.property_id',
        'rent.amount_paid',
        'rent.expiry_date',
        'rent.rent_start_date',
        'rent.rental_price',
        'rent.payment_frequency',
        'rent.payment_status',
        'rent.rent_status',
        'rent.created_at',
      ])
      .leftJoin('rent.tenant', 'rentTenant')
      .addSelect(['rentTenant.id', 'rentTenant.userId'])
      .leftJoin('rentTenant.user', 'rentTenantUser')
      .addSelect([
        'rentTenantUser.id',
        'rentTenantUser.first_name',
        'rentTenantUser.last_name',
        'rentTenantUser.email',
        'rentTenantUser.phone_number',
      ])
      .leftJoin('property.property_tenants', 'propertyTenant')
      .addSelect([
        'propertyTenant.id',
        'propertyTenant.tenant_id',
        'propertyTenant.property_id',
        'propertyTenant.status',
      ])
      .leftJoin('propertyTenant.tenant', 'tenant')
      .addSelect(['tenant.id', 'tenant.userId'])
      .leftJoin('tenant.user', 'tenantUser')
      .addSelect([
        'tenantUser.id',
        'tenantUser.first_name',
        'tenantUser.last_name',
        'tenantUser.email',
        'tenantUser.phone_number',
      ])
      .leftJoin(
        'tenantUser.tenant_kycs',
        'tenantKyc',
        'tenantKyc.admin_id = property.owner_id',
      )
      .addSelect([
        'tenantKyc.id',
        'tenantKyc.first_name',
        'tenantKyc.last_name',
        'tenantKyc.email',
        'tenantKyc.phone_number',
      ])
      .leftJoin('property.service_requests', 'serviceRequest')
      .addSelect([
        'serviceRequest.id',
        'serviceRequest.description',
        'serviceRequest.status',
        'serviceRequest.date_reported',
      ])
      .leftJoin('serviceRequest.tenant', 'srTenant')
      .addSelect(['srTenant.id', 'srTenant.userId'])
      .leftJoin('srTenant.user', 'srTenantUser')
      .addSelect([
        'srTenantUser.id',
        'srTenantUser.first_name',
        'srTenantUser.last_name',
      ])
      .leftJoin(
        'srTenantUser.tenant_kycs',
        'srTenantKyc',
        'srTenantKyc.admin_id = property.owner_id',
      )
      .addSelect([
        'srTenantKyc.id',
        'srTenantKyc.first_name',
        'srTenantKyc.last_name',
      ])
      .leftJoin('property.owner', 'owner')
      .addSelect(['owner.id', 'owner.userId'])
      .leftJoin('owner.user', 'ownerUser')
      .addSelect([
        'ownerUser.id',
        'ownerUser.first_name',
        'ownerUser.last_name',
      ])
      .leftJoin(
        'property.kyc_applications',
        'kycApplication',
        'kycApplication.status = :pendingStatus',
        { pendingStatus: 'pending' },
      )
      .addSelect([
        'kycApplication.id',
        'kycApplication.status',
        'kycApplication.first_name',
        'kycApplication.last_name',
        'kycApplication.email',
        'kycApplication.phone_number',
        'kycApplication.tenant_id',
        'kycApplication.passport_photo_url',
        'kycApplication.created_at',
      ])
      .where('property.id = :id', { id })
      .getOne();
    if (!property?.id) {
      throw new HttpException(
        `Property with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    const activeTenantRelation = property.property_tenants.find(
      (pt) => pt.status === 'active',
    );
    const activeRent = property.rents.find((r) => r.rent_status === 'active');

    let activeTenantInfo: any | null = null;
    if (activeTenantRelation && activeRent) {
      const tenantUser = activeTenantRelation.tenant.user;
      const tenantKyc = tenantUser.tenant_kycs?.[0]; // Get TenantKyc data if available (filtered by admin_id)

      // Prioritize TenantKyc data over User data for consistency
      const firstName = tenantKyc?.first_name ?? tenantUser.first_name;
      const lastName = tenantKyc?.last_name ?? tenantUser.last_name;
      const phone = tenantKyc?.phone_number ?? tenantUser.phone_number;

      // For email, check if it's a placeholder and handle accordingly
      let email: string | null = tenantKyc?.email ?? tenantUser.email;
      if (
        email &&
        (email.includes('@placeholder.lizt.app') ||
          email.includes('@placeholder.com'))
      ) {
        email = null; // Don't show placeholder emails to frontend
      }
      // Also check if email is empty string
      if (email === '') {
        email = null;
      }

      activeTenantInfo = {
        id: activeTenantRelation.tenant.id,
        name: `${firstName} ${lastName}`,
        email: email,
        phone: phone,
        rentAmount: activeRent.rental_price,
        leaseStartDate: activeRent.rent_start_date.toISOString(),
        rentExpiryDate: activeRent.expiry_date?.toISOString() || null,
      };
    }

    // 2. Format Rent Payments
    const rentPayments = property.rents.map((rent) => ({
      id: rent.id,
      paymentDate: rent.created_at,
      amountPaid: rent.amount_paid,
      status: rent.payment_status,
    }));

    // 3. Format Service Requests
    const serviceRequests = property.service_requests.map((sr) => {
      const tenantUser = sr.tenant.user;
      const tenantKyc = tenantUser.tenant_kycs?.[0]; // Filtered by admin_id in query

      // Prioritize TenantKyc data for consistency
      const firstName = tenantKyc?.first_name ?? tenantUser.first_name;
      const lastName = tenantKyc?.last_name ?? tenantUser.last_name;

      return {
        id: sr.id,
        tenantName: `${firstName} ${lastName}`,
        propertyName: property.name,
        messagePreview: sr.description.substring(0, 100) + '...',
        dateReported: sr.date_reported.toISOString(),
        status: sr.status,
      };
    });

    // 4. Computed Description
    const computedDescription = `${property.name} is a ${property.no_of_bedrooms === -1 ? 'studio' : `${property.no_of_bedrooms}`}-bedroom ${property.property_type?.toLowerCase()} located in ${property.location}`;

    // 5. Format KYC Applications
    const kycApplications =
      property.kyc_applications?.map((app) => ({
        id: app.id,
        status: app.status,
        applicantName: `${app.first_name} ${app.last_name}`,
        email: app.email,
        phoneNumber: app.phone_number,
        submissionDate: app.created_at
          ? new Date(app.created_at).toISOString()
          : new Date().toISOString(),
      })) || [];

    // 6. KYC Link Status - Now general per landlord, not property-specific
    const hasActiveKYCLink = false; // Always false since links are now general
    const kycApplicationCount = kycApplications.length;

    // 7. Build the final DTO
    return {
      id: property.id,
      name: property.name,
      location: property.location,
      description: property.description || computedDescription,
      status: property.property_status.toUpperCase() as
        | 'VACANT'
        | 'OCCUPIED'
        | 'INACTIVE', // Normalize to uppercase for frontend type consistency
      propertyType: property.property_type,
      bedrooms: property.no_of_bedrooms,
      bathrooms: property.no_of_bathrooms,
      // size: property.size, //add field to repository
      // yearBuilt: property.year_built, // Add to property repository
      tenant: activeTenantInfo,
      rentPayments: rentPayments,
      serviceRequests: serviceRequests,
      kycApplications: kycApplications,
      kycApplicationCount: kycApplicationCount,
      hasActiveKYCLink: hasActiveKYCLink,
    };
  }

  async getPropertyDetails(id: string): Promise<any> {
    // Step 1: Load basic property data with only active rent (most critical data)
    const property = await this.propertyRepository
      .createQueryBuilder('property')
      .leftJoinAndSelect(
        'property.rents',
        'rent',
        'rent.rent_status = :activeStatus AND rent.deleted_at IS NULL',
        { activeStatus: 'active' },
      )
      .leftJoinAndSelect('rent.tenant', 'rentTenant')
      .leftJoinAndSelect('rentTenant.user', 'rentTenantUser')
      .where('property.id = :id', { id })
      .getOne();

    if (!property?.id) {
      throw new HttpException(
        `Property with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    // Step 2: Load active property tenant separately (only if needed)
    let activeTenantRelation: PropertyTenant | null = null;
    const activeRent = property.rents.find((r) => r.rent_status === 'active');

    if (activeRent) {
      activeTenantRelation = await this.dataSource
        .getRepository(PropertyTenant)
        .createQueryBuilder('pt')
        .leftJoinAndSelect('pt.tenant', 'tenant')
        .leftJoinAndSelect('tenant.user', 'user')
        .leftJoinAndSelect(
          'user.tenant_kycs',
          'tenantKyc',
          'tenantKyc.admin_id = :ownerId AND tenantKyc.deleted_at IS NULL',
          { ownerId: property.owner_id },
        )
        .where('pt.property_id = :propertyId', { propertyId: id })
        .andWhere('pt.status = :status', { status: 'active' })
        .andWhere('pt.deleted_at IS NULL')
        .getOne();
    }

    // Step 3: Load property history (separate query, sorted in DB)
    const propertyHistories = await this.dataSource
      .getRepository(PropertyHistory)
      .createQueryBuilder('history')
      .leftJoinAndSelect('history.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'user')
      .leftJoinAndSelect(
        'user.tenant_kycs',
        'tenantKyc',
        'tenantKyc.admin_id = :ownerId AND tenantKyc.deleted_at IS NULL',
        { ownerId: property.owner_id },
      )
      .where('history.property_id = :propertyId', { propertyId: id })
      .orderBy('history.created_at', 'DESC')
      .limit(50) // Limit history to last 50 events
      .getMany();

    // Step 4: Load KYC applications (separate query, only recent ones)
    const kycApplications = await this.dataSource
      .getRepository(KYCApplication)
      .createQueryBuilder('kyc')
      .select([
        'kyc.id',
        'kyc.status',
        'kyc.first_name',
        'kyc.last_name',
        'kyc.email',
        'kyc.phone_number',
        'kyc.employment_status',
        'kyc.monthly_net_income',
        'kyc.tenant_id',
        'kyc.passport_photo_url',
        'kyc.created_at',
      ])
      .where('kyc.property_id = :propertyId', { propertyId: id })
      .andWhere('kyc.deleted_at IS NULL')
      .orderBy('kyc.created_at', 'DESC')
      .limit(20) // Limit to 20 most recent applications
      .getMany();

    // Current tenant information
    let currentTenant: any | null = null;
    let pendingRenewalInvoice: {
      id: string;
      rentAmount: number;
      serviceCharge: number;
      totalAmount: number;
      paymentFrequency: string | null;
      endDate: string | null;
    } | null = null;
    if (activeTenantRelation && activeRent) {
      const tenantUser = activeTenantRelation.tenant.user;
      const tenantKyc = tenantUser.tenant_kycs?.[0];

      const firstName = tenantKyc?.first_name ?? tenantUser.first_name;
      const lastName = tenantKyc?.last_name ?? tenantUser.last_name;
      const email = tenantKyc?.email ?? tenantUser.email;
      const phone = tenantKyc?.phone_number ?? tenantUser.phone_number;

      const tenantKycApplication = kycApplications
        .filter((app) => app.tenant_id === activeTenantRelation.tenant.id)
        .sort((a, b) => {
          const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return dateB - dateA;
        })[0];

      // Check for latest renewal invoice for this property+tenant
      const latestRenewalInvoice = await this.renewalInvoiceRepository.findOne({
        where: {
          property_id: property.id,
          tenant_id: activeTenantRelation.tenant.id,
        },
        order: { created_at: 'DESC' },
        select: [
          'id',
          'payment_status',
          'token_type',
          'total_amount',
          'amount_paid',
          'rent_amount',
          'service_charge',
          'payment_frequency',
          'end_date',
        ],
      });

      let renewalStatus: 'pending' | 'paid' | null = null;
      if (latestRenewalInvoice) {
        if (latestRenewalInvoice.payment_status === 'paid') {
          renewalStatus = 'paid';
        } else if (latestRenewalInvoice.token_type === 'landlord') {
          // Only show 'pending' badge when the tenant has actually been notified
          renewalStatus = 'pending';
        }
        // draft invoices (silent saves) do not trigger the badge
      }

      // Pending landlord invoice (unpaid) — the amount the tenant is expected to pay
      pendingRenewalInvoice =
        latestRenewalInvoice &&
        latestRenewalInvoice.payment_status === RenewalPaymentStatus.UNPAID &&
        (latestRenewalInvoice.token_type === 'landlord' ||
          latestRenewalInvoice.token_type === 'draft')
          ? {
              id: latestRenewalInvoice.id,
              rentAmount: parseFloat(
                latestRenewalInvoice.rent_amount.toString(),
              ),
              serviceCharge: parseFloat(
                (latestRenewalInvoice.service_charge || 0).toString(),
              ),
              totalAmount: parseFloat(
                latestRenewalInvoice.total_amount.toString(),
              ),
              paymentFrequency: latestRenewalInvoice.payment_frequency ?? null,
              endDate: latestRenewalInvoice.end_date
                ? latestRenewalInvoice.end_date instanceof Date
                  ? latestRenewalInvoice.end_date.toISOString().split('T')[0]
                  : String(latestRenewalInvoice.end_date)
                : null,
            }
          : null;

      // Outstanding balance: negative wallet = owes money
      const walletBal = await this.tenantBalancesService.getBalance(
        activeTenantRelation.tenant.id,
        property.owner_id,
      );
      const totalOutstandingBalance = walletBal < 0 ? -walletBal : 0;

      currentTenant = {
        id: activeTenantRelation.tenant.id,
        tenancyId: activeTenantRelation.id,
        name: `${firstName} ${lastName}`,
        email: email,
        phone: phone,
        tenancyStartDate: activeRent.rent_start_date
          .toISOString()
          .split('T')[0],
        paymentCycle: activeRent.payment_frequency
          ? activeRent.payment_frequency.charAt(0).toUpperCase() +
            activeRent.payment_frequency.slice(1)
          : 'Monthly',
        passportPhoto: tenantKycApplication?.passport_photo_url || null,
        renewalStatus,
        outstandingBalance: totalOutstandingBalance,
      };
    }

    // Property history formatting (reuse existing logic)
    const history = propertyHistories
      .map((hist) => {
        const tenantUser = hist.tenant?.user;
        const tenantKyc = tenantUser?.tenant_kycs?.[0];
        let tenantName: string;

        if (tenantUser) {
          tenantName = `${tenantKyc?.first_name ?? tenantUser.first_name} ${
            tenantKyc?.last_name ?? tenantUser.last_name
          }`;
        } else {
          const descMatch = hist.event_description?.match(
            /(?:for|to|by)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/,
          );
          if (descMatch) {
            tenantName = descMatch[1];
          } else {
            const linkedKycApp =
              hist.related_entity_type === 'kyc_application' &&
              hist.related_entity_id
                ? kycApplications.find(
                    (app) => app.id === hist.related_entity_id,
                  )
                : null;

            if (linkedKycApp) {
              tenantName = `${linkedKycApp.first_name} ${linkedKycApp.last_name}`;
            } else {
              const kycApp = kycApplications[0];
              tenantName = kycApp
                ? `${kycApp.first_name} ${kycApp.last_name}`
                : currentTenant?.name || 'Unknown';
            }
          }
        }

        switch (hist.event_type) {
          case 'property_created':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'property_created',
              title: 'Property Created',
              description: 'Property was added to the system.',
              details: null,
            };
          case 'tenancy_started': {
            const moveInDate = hist.move_in_date
              ? new Date(hist.move_in_date).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })
              : 'an unspecified date';

            return {
              id: hist.id,
              date: hist.created_at || hist.move_in_date,
              eventType: 'tenancy_started',
              title: 'Tenant attached',
              description: `${tenantName} attached to this property on ${moveInDate}.`,
              details: hist.monthly_rent
                ? `Rent: ₦${hist.monthly_rent?.toLocaleString()} / year`
                : null,
            };
          }
          case 'outstanding_balance_recorded': {
            let obAmount = 0;
            let obReason: string | null = null;
            try {
              const parsed = JSON.parse(hist.event_description || '{}');
              obAmount = parsed.amount || 0;
              obReason = parsed.reason || null;
            } catch {}
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'outstanding_balance_recorded',
              title: 'Outstanding balance recorded',
              description: `Outstanding balance recorded — ${tenantName} — ₦${obAmount.toLocaleString()}`,
              details: obReason,
              amount: obAmount,
            };
          }
          case 'tenancy_ended':
            return {
              id: hist.id,
              date: hist.created_at || hist.move_out_date,
              eventType: 'tenancy_ended',
              title: 'Tenancy Ended',
              description: 'Tenant moved out of the property.',
              details: hist.move_out_reason
                ? `Reason: ${hist.move_out_reason.replace(/_/g, ' ')}`
                : null,
            };
          case 'service_request_created':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'service_request_created',
              title: 'Service Request Created',
              description: 'Service request opened by tenant.',
              details: hist.event_description
                ? `Issue: "${hist.event_description}"`
                : null,
            };
          case 'service_request_updated': {
            const parts = hist.event_description?.split('|||') || [];
            const status = parts[0] || 'updated';
            const issueDescription = parts[1] || 'Service request updated';
            const resolver = parts.length > 2 ? parts[2] : null;

            let title = 'Service Request Updated';
            let eventType = 'service_request_updated';
            let description = issueDescription;
            const details = resolver ? `Resolver: ${resolver}` : null;

            if (status.toLowerCase() === 'resolved') {
              title = 'Service Request Resolved';
              eventType = 'service_request_resolved';
              description = 'Issue fixed and marked as resolved.';
            } else if (status.toLowerCase() === 'closed') {
              title = 'Service Request Closed';
              eventType = 'service_request_closed';
              description = 'Tenant confirmed issue is fully resolved.';
            } else if (status.toLowerCase() === 'reopened') {
              title = 'Service Request Reopened';
              eventType = 'service_request_reopened';
              description =
                'Tenant reopened the request: issue not fully resolved.';
            }

            return {
              id: hist.id,
              date: hist.created_at,
              eventType: eventType,
              title: title,
              description: description,
              details: details,
            };
          }
          case 'property_deactivated':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'property_deactivated',
              title: 'Property Deactivated',
              description: 'Property is no longer active.',
              details: null,
            };
          case 'property_activated':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'property_activated',
              title: 'Property Activated',
              description: hist.event_description,
              details: null,
            };
          case 'property_edited':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'property_edited',
              title: 'Property Updated',
              description:
                hist.event_description || 'Property details were updated.',
              details: null,
            };
          case 'property_marketing_enabled':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'property_marketing_enabled',
              title: 'Ready for Marketing',
              description:
                hist.event_description ||
                'Property marked as ready for marketing.',
              details: null,
            };
          case 'property_marketing_disabled':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'property_marketing_disabled',
              title: 'Removed from Marketing',
              description:
                hist.event_description || 'Property removed from marketing.',
              details: null,
            };
          case 'property_deleted':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'property_deleted',
              title: 'Property Deleted',
              description: 'Property removed from the system.',
              details: null,
            };
          case 'kyc_application_submitted':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'kyc_application_submitted',
              title: 'Tenant application received',
              description:
                hist.event_description ||
                `${tenantName} submitted a KYC application for this property.`,
              details: tenantName,
            };
          case 'kyc_application_approved':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'kyc_application_approved',
              title: 'KYC application approved',
              description:
                hist.event_description ||
                `KYC application approved for ${tenantName}`,
              details: tenantName,
            };
          case 'kyc_application_rejected':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'kyc_application_rejected',
              title: 'KYC application rejected',
              description:
                hist.event_description ||
                `KYC application rejected for ${tenantName}`,
              details: tenantName,
            };
          case 'offer_letter_sent':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'offer_letter_sent',
              title: 'Offer letter sent',
              description:
                hist.event_description || `Offer letter sent to ${tenantName}`,
              details: tenantName,
            };
          case 'offer_letter_viewed':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'offer_letter_viewed',
              title: 'Offer letter viewed',
              description:
                hist.event_description ||
                `Offer letter viewed by ${tenantName}`,
              details: tenantName,
            };
          case 'offer_letter_accepted':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'offer_letter_accepted',
              title: 'Offer letter accepted',
              description:
                hist.event_description ||
                `Offer letter accepted by ${tenantName}`,
              details: tenantName,
            };
          case 'offer_letter_rejected':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'offer_letter_rejected',
              title: 'Offer letter rejected',
              description:
                hist.event_description ||
                `Offer letter rejected by ${tenantName}`,
              details: tenantName,
            };
          case 'invoice_generated': {
            const invoiceAmountMatch =
              hist.event_description?.match(/₦([\d,]+)/);
            const invoiceAmount = invoiceAmountMatch
              ? invoiceAmountMatch[1]
              : null;
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'invoice_generated',
              title: 'Invoice generated',
              description:
                hist.event_description || `Invoice generated for ${tenantName}`,
              details: tenantName,
              amount: invoiceAmount,
            };
          }
          case 'invoice_sent':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'invoice_sent',
              title: 'Invoice sent',
              description:
                hist.event_description || `Invoice sent to ${tenantName}`,
              details: tenantName,
              amount: null,
            };
          case 'invoice_viewed':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'invoice_viewed',
              title: 'Invoice viewed',
              description:
                hist.event_description || `Invoice viewed by ${tenantName}`,
              details: tenantName !== 'Unknown' ? tenantName : null,
              amount: null,
            };
          case 'receipt_issued': {
            const receiptAmountMatch =
              hist.event_description?.match(/₦([\d,]+)/);
            const receiptAmount = receiptAmountMatch
              ? receiptAmountMatch[1]
              : null;
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'receipt_issued',
              title: 'Receipt issued',
              description:
                hist.event_description || `Receipt issued for ${tenantName}`,
              details: tenantName,
              amount: receiptAmount,
            };
          }
          case 'receipt_sent':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'receipt_sent',
              title: 'Receipt sent',
              description:
                hist.event_description || `Receipt sent to ${tenantName}`,
              details: tenantName,
              amount: null,
            };
          case 'receipt_viewed':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'receipt_viewed',
              title: 'Receipt viewed',
              description:
                hist.event_description || `Receipt viewed by ${tenantName}`,
              details: tenantName !== 'Unknown' ? tenantName : null,
              amount: null,
            };
          case 'payment_initiated': {
            const paymentAmountMatch =
              hist.event_description?.match(/₦([\d,]+)/);
            const paymentAmount = paymentAmountMatch
              ? paymentAmountMatch[1]
              : null;
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'payment_initiated',
              title: 'Payment initiated',
              description:
                hist.event_description || `${tenantName} initiated a payment`,
              details: tenantName,
              amount: paymentAmount,
            };
          }
          case 'payment_completed_full': {
            const fullPayAmountMatch =
              hist.event_description?.match(/₦([\d,]+)/);
            const fullPayAmount = fullPayAmountMatch
              ? fullPayAmountMatch[1]
              : null;
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'payment_completed_full',
              title: 'Payment completed',
              description:
                hist.event_description ||
                `${tenantName} completed full payment`,
              details: tenantName,
              amount: fullPayAmount,
            };
          }
          case 'payment_completed_partial': {
            const partialAmountMatch =
              hist.event_description?.match(/₦([\d,]+)/);
            const partialAmount = partialAmountMatch
              ? partialAmountMatch[1]
              : null;
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'payment_completed_partial',
              title: 'Partial payment received',
              description:
                hist.event_description ||
                `${tenantName} made a partial payment`,
              details: tenantName,
              amount: partialAmount,
            };
          }
          case 'payment_cancelled':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'payment_cancelled',
              title: 'Payment cancelled',
              description:
                hist.event_description || `${tenantName} cancelled a payment`,
              details: tenantName,
              amount: null,
            };
          case 'rent_reminder_sent':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'rent_reminder_sent',
              title: 'Rent reminder sent',
              description:
                hist.event_description || `Rent reminder sent to ${tenantName}`,
              details: tenantName,
            };
          case 'renewal_link_sent':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'renewal_link_sent',
              title: 'Renewal Link Sent',
              description:
                hist.event_description ||
                `Tenancy renewal link sent for property.`,
              details: tenantName,
            };
          case 'renewal_payment_received':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'renewal_payment_received',
              title: 'Renewal Payment Received',
              description:
                hist.event_description ||
                `Renewal payment received for property.`,
              details: tenantName,
            };
          case 'renewal_payment_initiated':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'renewal_payment_initiated',
              title: 'Renewal Payment Initiated',
              description:
                hist.event_description ||
                `Renewal payment initiated for property.`,
              details: tenantName,
            };
          case 'renewal_payment_cancelled':
            return {
              id: hist.id,
              date: hist.created_at,
              eventType: 'renewal_payment_cancelled',
              title: 'Renewal Payment Cancelled',
              description:
                hist.event_description ||
                `Renewal payment cancelled for property.`,
              details: tenantName,
            };
          case 'user_added_history': {
            let parsedData: any = {};
            try {
              parsedData = JSON.parse(hist.event_description || '{}');
            } catch {
              parsedData = {
                displayType: 'Custom Event',
                description: hist.event_description || '',
              };
            }
            const userAddedAmount = parsedData.amount || null;
            return {
              id: hist.id,
              date: hist.move_in_date || hist.created_at,
              eventType: 'user_added_history',
              title: `${parsedData.displayType || 'Custom Event'} — ${tenantName} — ${parsedData.description || ''}`,
              description: parsedData.description || '',
              details: null,
              amount: userAddedAmount,
              isUserAdded: true,
            };
          }
          case 'user_added_tenancy': {
            let parsedTenancy: any = {};
            try {
              parsedTenancy = JSON.parse(hist.event_description || '{}');
            } catch {
              parsedTenancy = {};
            }
            const totalAmount = parsedTenancy.totalAmount || 0;
            const rentAmount = parsedTenancy.rentAmount || 0;
            const serviceCharge = parsedTenancy.serviceChargeAmount || 0;
            const otherFees = parsedTenancy.otherFees || [];
            const startDate = hist.move_in_date
              ? new Date(hist.move_in_date).toLocaleDateString('en-GB')
              : '';
            const endDate = hist.move_out_date
              ? new Date(hist.move_out_date).toLocaleDateString('en-GB')
              : '';
            return {
              id: hist.id,
              date: hist.move_in_date || hist.created_at,
              eventType: 'user_added_tenancy',
              title: `Tenancy started`,
              description: `Tenancy period: ${startDate} – ${endDate}`,
              details: JSON.stringify({
                rentAmount,
                serviceCharge,
                otherFees,
                totalAmount,
                startDate,
                endDate,
                propertyName: parsedTenancy.propertyName || '',
                tenantName,
              }),
              amount: totalAmount,
              isUserAdded: true,
            };
          }
          case 'user_added_payment': {
            let parsedPayment: any = {};
            try {
              parsedPayment = JSON.parse(hist.event_description || '{}');
            } catch {
              parsedPayment = {};
            }
            const paymentAmount = parsedPayment.paymentAmount || 0;
            const paymentDate = parsedPayment.paymentDate
              ? new Date(parsedPayment.paymentDate).toLocaleDateString('en-GB')
              : hist.move_in_date
                ? new Date(hist.move_in_date).toLocaleDateString('en-GB')
                : '';
            return {
              id: hist.id,
              date:
                parsedPayment.paymentDate ||
                hist.move_in_date ||
                hist.created_at,
              eventType: 'user_added_payment',
              title: `Payment received`,
              description: `Payment of ₦${Number(paymentAmount).toLocaleString()} on ${paymentDate}`,
              details: JSON.stringify({
                paymentAmount,
                paymentDate,
                propertyName: parsedPayment.propertyName || '',
                tenantName,
              }),
              amount: paymentAmount,
              isUserAdded: true,
            };
          }
          default:
            return null;
        }
      })
      .filter(Boolean);

    // Add property creation event if missing
    const hasCreationEvent = history.some(
      (e) => e && e.eventType === 'property_created',
    );
    if (!hasCreationEvent) {
      history.push({
        id: property.id,
        date: property.created_at,
        eventType: 'property_created',
        title: 'Property Created',
        description: 'Property was added to the system.',
        details: null,
      });
    }

    const computedDescription = `${property.name} is a ${
      property.no_of_bedrooms === -1
        ? 'studio'
        : `${property.no_of_bedrooms}-bedroom`
    } ${property.property_type?.toLowerCase()} located at ${property.location}.`;

    const kycApplicationsFormatted =
      kycApplications.map((app) => ({
        id: app.id,
        status: app.status,
        applicantName: `${app.first_name} ${app.last_name}`,
        email: app.email,
        phoneNumber: app.phone_number,
        submissionDate: app.created_at
          ? new Date(app.created_at).toISOString()
          : new Date().toISOString(),
        employmentStatus: app.employment_status,
        monthlyIncome: app.monthly_net_income,
      })) || [];

    const hasActiveKYCLink = false;
    const kycApplicationCount = kycApplicationsFormatted.length;
    const pendingApplicationsCount = kycApplicationsFormatted.filter(
      (app) => app.status === 'pending',
    ).length;

    return {
      id: property.id,
      name: property.name,
      address: property.location,
      type: property.property_type,
      bedrooms: property.no_of_bedrooms,
      bathrooms: property.no_of_bathrooms,
      status:
        property.property_status === 'occupied'
          ? 'Occupied'
          : property.property_status === 'inactive'
            ? 'Inactive'
            : 'Vacant',
      rent: activeRent?.rental_price || null,
      serviceCharge: activeRent?.service_charge || 0,
      rentExpiryDate:
        activeRent?.expiry_date?.toISOString().split('T')[0] || null,
      pendingRenewalInvoice: pendingRenewalInvoice || null,
      rentalPrice: property.rental_price || null,
      isMarketingReady: property.is_marketing_ready || false,
      description: property.description || computedDescription,
      currentTenant,
      history,
      kycApplications: kycApplicationsFormatted,
      kycApplicationCount,
      pendingApplicationsCount,
      hasActiveKYCLink,
    };
  }

  async getRentsOfAProperty(id: string): Promise<CreatePropertyDto> {
    const propertyAndRent = await this.propertyRepository.findOne({
      where: { id },
      relations: ['rents', 'rents.tenant'],
    });
    if (!propertyAndRent?.id) {
      throw new HttpException(
        `Property with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return propertyAndRent;
  }

  async getServiceRequestOfAProperty(id: string): Promise<CreatePropertyDto> {
    const propertyAndRent = await this.propertyRepository.findOne({
      where: { id },
      relations: ['service_requests', 'service_requests.tenant'],
    });
    if (!propertyAndRent?.id) {
      throw new HttpException(
        `Property with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return propertyAndRent;
  }

  // async updatePropertyById(id: string, data: UpdatePropertyDto) {
  //   try {
  //     const activeRent = (await this.rentService.findActiveRent({
  //       property_id: id,
  //     })) as any;

  //     if (!activeRent) {
  //       return this.propertyRepository.update(id, {
  //         name: data.name,
  //         location: data.location,
  //         no_of_bedrooms: data.no_of_bedrooms,
  //       });
  //     }

  //     await this.userService.updateUserById(activeRent.tenant_id, {
  //       first_name: data.first_name,
  //       last_name: data.last_name,
  //       phone_number: data.phone_number,
  //     });
  //     await this.rentService.updateRentById(activeRent.id, {
  //       rent_start_date: data.lease_agreement_end_date,
  //       lease_agreement_end_date: data.lease_agreement_end_date,
  //       rental_price: data.rental_price,
  //       service_charge: data.service_charge,
  //       security_deposit: data.security_deposit,
  //     });
  //     return this.propertyRepository.update(id, {
  //       name: data.name,
  //       location: data.location,
  //       property_status: data.occupancy_status,
  //     });
  //   } catch (error) {
  //     throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
  //   }
  // }

  async updatePropertyById(
    id: string,
    updatePropertyDto: UpdatePropertyDto,
    requesterId: string,
  ): Promise<Property> {
    // findOneByOrFail
    const property = await this.propertyRepository.findOneByOrFail({ id });

    // Auth check: Ensure the requester owns the property
    if (property.owner_id !== requesterId) {
      throw new ForbiddenException(
        'You are not authorized to update this property',
      );
    }

    // Merge new data from DTO into existing property entity
    Object.assign(property, updatePropertyDto);
    console.log(property);

    // Save the updated entity back to the db
    const updatedProperty = await this.propertyRepository.save(property);

    // Add a history record for property update
    if (updatePropertyDto.property_status === 'inactive') {
      await this.propertyHistoryRepository.save({
        property_id: id,
        event_type: 'property_deactivated',
        event_description: 'Property is no longer active.',
      });

      try {
        await this.notificationService.create({
          date: new Date().toISOString(),
          type: NotificationType.PROPERTY_CREATED,
          description: `Property "${property.name}" has been deactivated`,
          status: 'Completed',
          property_id: id,
          user_id: requesterId,
        });
      } catch (error) {
        console.error(
          'Failed to create property_deactivated notification:',
          error,
        );
      }
    } else if (updatePropertyDto.property_status === 'vacant') {
      await this.propertyHistoryRepository.save({
        property_id: id,
        event_type: 'property_activated',
        event_description: `Property activated with marketing price of ${property.rental_price}`,
      });

      try {
        await this.notificationService.create({
          date: new Date().toISOString(),
          type: NotificationType.PROPERTY_CREATED,
          description: `Property "${property.name}" has been activated`,
          status: 'Completed',
          property_id: id,
          user_id: requesterId,
        });
      } catch (error) {
        console.error(
          'Failed to create property_activated notification:',
          error,
        );
      }
    } else if (updatePropertyDto.is_marketing_ready === true) {
      await this.propertyHistoryRepository.save({
        property_id: id,
        event_type: 'property_marketing_enabled',
        event_description: `Property marked as ready for marketing with price of ₦${(property.rental_price || 0).toLocaleString()}`,
      });

      try {
        await this.notificationService.create({
          date: new Date().toISOString(),
          type: NotificationType.PROPERTY_CREATED,
          description: `"${property.name}" is now ready for marketing — ₦${(property.rental_price || 0).toLocaleString()}`,
          status: 'Completed',
          property_id: id,
          user_id: requesterId,
        });
      } catch (error) {
        console.error(
          'Failed to create marketing_enabled notification:',
          error,
        );
      }
    } else if (updatePropertyDto.is_marketing_ready === false) {
      await this.propertyHistoryRepository.save({
        property_id: id,
        event_type: 'property_marketing_disabled',
        event_description: `"${property.name}" removed from marketing`,
      });

      try {
        await this.notificationService.create({
          date: new Date().toISOString(),
          type: NotificationType.PROPERTY_CREATED,
          description: `"${property.name}" has been removed from marketing`,
          status: 'Completed',
          property_id: id,
          user_id: requesterId,
        });
      } catch (error) {
        console.error(
          'Failed to create marketing_disabled notification:',
          error,
        );
      }
    } else {
      // Build a description of what specifically changed
      const changes: string[] = [];
      if (updatePropertyDto.name !== undefined)
        changes.push(`name to "${updatePropertyDto.name}"`);
      if (updatePropertyDto.location !== undefined)
        changes.push(`location to "${updatePropertyDto.location}"`);
      if (updatePropertyDto.rental_price !== undefined)
        changes.push(
          `rental price to ₦${updatePropertyDto.rental_price.toLocaleString()}`,
        );
      if (updatePropertyDto.service_charge !== undefined)
        changes.push(
          `service charge to ₦${updatePropertyDto.service_charge.toLocaleString()}`,
        );
      if (updatePropertyDto.security_deposit !== undefined)
        changes.push(
          `security deposit to ₦${updatePropertyDto.security_deposit.toLocaleString()}`,
        );
      if (updatePropertyDto.no_of_bedrooms !== undefined)
        changes.push(`bedrooms to ${updatePropertyDto.no_of_bedrooms}`);
      if (updatePropertyDto.property_type !== undefined)
        changes.push(`property type to "${updatePropertyDto.property_type}"`);
      if (updatePropertyDto.description !== undefined)
        changes.push('description');

      const changeDescription =
        changes.length > 0
          ? `Updated ${changes.join(', ')}`
          : 'Property details were updated.';

      await this.propertyHistoryRepository.save({
        property_id: id,
        event_type: 'property_edited',
        event_description: changeDescription,
      });

      try {
        await this.notificationService.create({
          date: new Date().toISOString(),
          type: NotificationType.PROPERTY_CREATED,
          description: `"${property.name}" — ${changeDescription}`,
          status: 'Completed',
          property_id: id,
          user_id: requesterId,
        });
      } catch (error) {
        console.error('Failed to create property_edited notification:', error);
      }
    }

    return updatedProperty;
  }

  async deletePropertyById(propertyId: string, ownerId: string): Promise<void> {
    try {
      // Ensure the property exists and belongs to the user making the request
      const property = await this.propertyRepository.findOneBy({
        id: propertyId,
        owner_id: ownerId,
      });

      if (!property) {
        // Property not found or does not belong to the owner
        throw new HttpException('Property not found', HttpStatus.NOT_FOUND);
      }

      // Cannot delete occupied properties
      if (property.property_status === PropertyStatusEnum.OCCUPIED) {
        throw new HttpException(
          'Cannot delete property that is currently occupied. Please end the tenancy first.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Cannot delete properties with history records
      const historyCount = await this.propertyHistoryRepository.count({
        where: { property_id: propertyId },
      });

      if (historyCount > 0) {
        throw new HttpException(
          'Cannot delete property with existing tenancy history. Properties that have been inhabited cannot be deleted.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Only vacant properties with no history can be deleted
      await this.propertyRepository.softDelete(propertyId);

      // Create a livefeed notification for the deletion
      try {
        await this.notificationService.create({
          date: new Date().toISOString(),
          type: NotificationType.PROPERTY_CREATED,
          description: `Property "${property.name}" has been deleted`,
          status: 'Completed',
          property_id: propertyId,
          user_id: ownerId,
        });
      } catch (error) {
        console.error('Failed to create property_deleted notification:', error);
      }
    } catch (error) {
      // Handle known HttpExceptions separately
      if (error instanceof HttpException) {
        throw error; // rethrow custom errors without wrapping
      }

      // Catch unexpected errors
      console.error('Unexpected error while deleting property:', error);
      throw new HttpException(
        'Something went wrong while deleting the property',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getAllPropertiesNoAuth(): Promise<Property[]> {
    return this.propertyRepository.find({
      order: { created_at: 'DESC' },
    });
  }

  async forceDeleteProperty(propertyId: string): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Check if property exists
      const property = await queryRunner.manager.findOne(Property, {
        where: { id: propertyId },
      });

      if (!property) {
        throw new HttpException('Property not found', HttpStatus.NOT_FOUND);
      }

      // Delete all associated records in order (respecting foreign key constraints)

      // 1. Delete auto service requests (through property_tenant_id)
      // First get all property_tenant IDs for this property
      const propertyTenants = await queryRunner.manager.find(PropertyTenant, {
        where: { property_id: propertyId },
        select: ['id'],
      });

      const propertyTenantIds = propertyTenants.map((pt) => pt.id);

      if (propertyTenantIds.length > 0) {
        await queryRunner.manager
          .createQueryBuilder()
          .delete()
          .from('auto_service_requests')
          .where('property_tenant_id IN (:...ids)', { ids: propertyTenantIds })
          .execute();
      }

      // 2. Delete scheduled move-outs
      await queryRunner.manager.delete('scheduled_move_outs', {
        property_id: propertyId,
      });

      // 3. Delete notifications
      await queryRunner.manager.delete('notification', {
        property_id: propertyId,
      });

      // 4. Delete notice agreements
      await queryRunner.manager.delete('notice_agreement', {
        property_id: propertyId,
      });

      // 5. Delete rent increases
      await queryRunner.manager.delete('rent_increases', {
        property_id: propertyId,
      });

      // 6. Delete property history
      await queryRunner.manager.delete(PropertyHistory, {
        property_id: propertyId,
      });

      // 7. Delete service requests
      await queryRunner.manager.delete('service_requests', {
        property_id: propertyId,
      });

      // 8. Delete rents
      await queryRunner.manager.delete('rents', {
        property_id: propertyId,
      });

      // 9. Delete KYC applications
      await queryRunner.manager.delete('kyc_applications', {
        property_id: propertyId,
      });

      // 10. Delete property tenants
      await queryRunner.manager.delete(PropertyTenant, {
        property_id: propertyId,
      });

      // 11. KYC links are now general per landlord, not property-specific
      // No need to delete KYC links when deleting a property

      // 12. Remove property from property groups
      const propertyGroups = await queryRunner.manager.find(PropertyGroup, {
        where: {},
      });

      for (const group of propertyGroups) {
        if (group.property_ids.includes(propertyId)) {
          group.property_ids = group.property_ids.filter(
            (id) => id !== propertyId,
          );
          await queryRunner.manager.save(PropertyGroup, group);
        }
      }

      // 13. Finally, delete the property itself (hard delete)
      await queryRunner.manager.delete(Property, { id: propertyId });

      await queryRunner.commitTransaction();

      console.log(
        `✅ Force deleted property ${propertyId} and all associated records`,
      );
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('❌ Force delete failed:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        `Failed to force delete property: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      await queryRunner.release();
    }
  }

  async getAdminDashboardStats(user_id: string) {
    const stats = await this.propertyRepository
      .createQueryBuilder('property')
      .leftJoin('property.property_tenants', 'property_tenants')
      .leftJoin('property_tenants.tenant', 'tenant')
      .leftJoin('property.service_requests', 'requests')
      .leftJoin('property.rents', 'rent')
      .where('property.owner_id = :user_id', { user_id })
      .select([
        'COUNT(DISTINCT property.id) as total_properties',
        'COUNT(DISTINCT tenant.id) as total_tenants',
        'COUNT(DISTINCT CASE WHEN rent.expiry_date <= :dueDate THEN tenant.id END) as due_tenants',
        'COUNT(DISTINCT CASE WHEN requests.status IN (:...statuses) THEN requests.id END) as unresolved_requests',
      ])
      .setParameters({
        dueDate: DateService.addDays(new Date(), 7),
        statuses: [
          ServiceRequestStatusEnum.PENDING,
          ServiceRequestStatusEnum.URGENT,
        ],
      })
      .getRawOne();

    return {
      total_properties: Number(stats.total_properties),
      total_tenants: Number(stats.total_tenants),
      due_tenants: Number(stats.due_tenants),
      unresolved_requests: Number(stats.unresolved_requests),
    };
  }

  async moveTenantIn(moveInData: MoveTenantInDto) {
    const { property_id, tenant_id, move_in_date } = moveInData;

    if (!DateService.isValidFormat_YYYY_MM_DD(move_in_date)) {
      throw new HttpException(
        'Invalid date format. Use YYYY-MM-DD',
        HttpStatus.BAD_REQUEST,
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const property = await queryRunner.manager.findOne(Property, {
        where: { id: property_id },
      });
      if (!property?.id) {
        throw new HttpException('Property not found', HttpStatus.NOT_FOUND);
      }
      const existingTenant = await queryRunner.manager.findOne(PropertyTenant, {
        where: {
          property_id,
          tenant_id,
          status: TenantStatusEnum.ACTIVE,
        },
      });

      if (existingTenant?.id) {
        throw new HttpException(
          'Tenant is already assigned to this property',
          HttpStatus.BAD_REQUEST,
        );
      }

      const moveTenantIn = await queryRunner.manager.save(PropertyTenant, {
        property_id,
        tenant_id,
        status: TenantStatusEnum.ACTIVE,
      });

      await queryRunner.manager.update(Property, property_id, {
        property_status: PropertyStatusEnum.OCCUPIED,
        is_marketing_ready: false,
      });

      await queryRunner.manager.save(PropertyHistory, {
        property_id,
        tenant_id,
        event_type: 'tenancy_started',
        move_in_date: DateService.getStartOfTheDay(move_in_date),
        monthly_rent: property?.rental_price,
        owner_comment: null,
        tenant_comment: null,
        move_out_date: null,
        move_out_reason: null,
      });

      await queryRunner.commitTransaction();
      return moveTenantIn;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw new HttpException(
        error?.message || 'an error occurred while moving tenant in',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    } finally {
      await queryRunner.release();
    }
  }

  async moveTenantOut(moveOutData: MoveTenantOutDto, requesterId?: string) {
    const { property_id, tenant_id, move_out_date } = moveOutData;
    if (!DateService.isValidFormat_YYYY_MM_DD(move_out_date)) {
      throw new HttpException(
        'Invalid date format. Use YYYY-MM-DD',
        HttpStatus.BAD_REQUEST,
      );
    }

    // If requesterId is provided (for landlords), validate ownership
    if (requesterId) {
      const property = await this.propertyRepository.findOneBy({
        id: property_id,
      });
      if (!property) {
        throw new HttpException('Property not found', HttpStatus.NOT_FOUND);
      }

      if (property.owner_id !== requesterId) {
        throw new ForbiddenException(
          'You are not authorized to end tenancy for this property',
        );
      }
    }

    // Check if the move-out date is in the future
    const moveOutDate = new Date(move_out_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    moveOutDate.setHours(0, 0, 0, 0);

    if (moveOutDate > today) {
      // Schedule the move-out for the future
      return this.scheduleMoveTenantOut(moveOutData, requesterId);
    }

    // Process immediate move-out
    return this.processMoveTenantOut(moveOutData, requesterId);
  }

  private async scheduleMoveTenantOut(
    moveOutData: MoveTenantOutDto,
    requesterId?: string,
  ) {
    const { property_id, tenant_id, move_out_date } = moveOutData;

    // Validate that tenant is currently assigned to the property
    const propertyTenant = await this.propertyTenantRepository.findOne({
      where: {
        property_id,
        tenant_id,
        status: TenantStatusEnum.ACTIVE,
      },
    });

    if (!propertyTenant?.id) {
      throw new HttpException(
        'Tenant is not currently assigned to this property',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Check if there's already a scheduled move-out for this tenant/property
    const existingScheduled = await this.scheduledMoveOutRepository.findOne({
      where: {
        property_id,
        tenant_id,
        processed: false,
      },
    });

    if (existingScheduled) {
      // Update the existing scheduled move-out
      await this.scheduledMoveOutRepository.update(existingScheduled.id, {
        effective_date: DateService.getStartOfTheDay(move_out_date),
        move_out_reason: moveOutData?.move_out_reason || null,
        owner_comment: moveOutData?.owner_comment || null,
        tenant_comment: moveOutData?.tenant_comment || null,
      });

      return {
        message: 'Move-out date updated successfully',
        scheduled: true,
        effective_date: move_out_date,
      };
    } else {
      // Create new scheduled move-out
      const scheduledMoveOut = await this.scheduledMoveOutRepository.save({
        property_id,
        tenant_id,
        effective_date: DateService.getStartOfTheDay(move_out_date),
        move_out_reason: moveOutData?.move_out_reason || null,
        owner_comment: moveOutData?.owner_comment || null,
        tenant_comment: moveOutData?.tenant_comment || null,
        processed: false,
      });

      return {
        message: 'Move-out scheduled successfully',
        scheduled: true,
        effective_date: move_out_date,
        id: scheduledMoveOut.id,
      };
    }
  }

  private async processMoveTenantOut(
    moveOutData: MoveTenantOutDto,
    requesterId?: string,
  ) {
    const { property_id, tenant_id, move_out_date } = moveOutData;

    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      // Enhanced validation: Check if tenant is currently assigned to this property
      const propertyTenant = await queryRunner.manager.findOne(PropertyTenant, {
        where: {
          property_id,
          tenant_id,
          status: TenantStatusEnum.ACTIVE,
        },
      });

      if (!propertyTenant?.id) {
        throw new HttpException(
          'Tenant is not currently assigned to this property',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Get ALL rent records for this tenant-property combination (not just active ones)
      const allRents = await queryRunner.manager.find(Rent, {
        where: {
          property_id,
          tenant_id,
        },
        order: { created_at: 'DESC' },
      });

      // Get the active rent record BEFORE deactivating (needed for PropertyHistory creation)
      const activeRent = allRents.find(
        (rent) => rent.rent_status === RentStatusEnum.ACTIVE,
      );
      const hasActiveRent = !!activeRent;

      console.log(
        `[MOVE_OUT] Processing tenant ${tenant_id} from property ${property_id}:`,
        {
          totalRentRecords: allRents.length,
          activeRentFound: hasActiveRent,
          activeRentId: activeRent?.id,
          allRentStatuses: allRents.map((r) => ({
            id: r.id,
            status: r.rent_status,
          })),
        },
      );

      // CRITICAL: Deactivate ALL active rent records for this tenant-property combination
      // This prevents the issue where multiple active rents exist
      const activeRentUpdateResult = await queryRunner.manager.update(
        Rent,
        {
          property_id,
          tenant_id,
          rent_status: RentStatusEnum.ACTIVE,
        },
        {
          rent_status: RentStatusEnum.INACTIVE,
          updated_at: new Date(), // Explicitly set updated timestamp
        },
      );

      console.log(`[MOVE_OUT] Rent deactivation result:`, {
        affectedRows: activeRentUpdateResult.affected,
        expectedRows: allRents.filter(
          (r) => r.rent_status === RentStatusEnum.ACTIVE,
        ).length,
      });

      // Verify that all rent records are now inactive
      const remainingActiveRents = await queryRunner.manager.find(Rent, {
        where: {
          property_id,
          tenant_id,
          rent_status: RentStatusEnum.ACTIVE,
        },
      });

      if (remainingActiveRents.length > 0) {
        console.error(
          `[MOVE_OUT] ERROR: ${remainingActiveRents.length} rent records still active after update:`,
          remainingActiveRents.map((r) => ({
            id: r.id,
            status: r.rent_status,
          })),
        );

        // Force deactivate any remaining active rents
        for (const rent of remainingActiveRents) {
          await queryRunner.manager.update(Rent, rent.id, {
            rent_status: RentStatusEnum.INACTIVE,
            updated_at: new Date(),
          });
          console.log(`[MOVE_OUT] Force deactivated rent record: ${rent.id}`);
        }
      }

      // Remove property-tenant relationship
      const propertyTenantDeleteResult = await queryRunner.manager.delete(
        PropertyTenant,
        {
          property_id,
          tenant_id,
        },
      );

      console.log(`[MOVE_OUT] PropertyTenant deletion result:`, {
        affectedRows: propertyTenantDeleteResult.affected,
      });

      // Update property status to vacant
      const propertyUpdateResult = await queryRunner.manager.update(
        Property,
        property_id,
        {
          property_status: PropertyStatusEnum.VACANT,
        },
      );

      console.log(`[MOVE_OUT] Property status update result:`, {
        affectedRows: propertyUpdateResult.affected,
      });

      // Note: KYC links are not automatically reactivated when tenant moves out
      // Landlord needs to generate new KYC links if they want to find new tenants

      // Try to find existing PropertyHistory record for this tenant
      let propertyHistory = await queryRunner.manager.findOne(PropertyHistory, {
        where: {
          property_id,
          tenant_id,
          move_out_date: IsNull(),
        },
        order: { created_at: 'DESC' },
      });

      // If no PropertyHistory record exists, create one based on the current tenancy
      if (!propertyHistory) {
        console.log(
          `No PropertyHistory record found for tenant ${tenant_id} in property ${property_id}. Creating one...`,
        );

        if (!hasActiveRent) {
          // No rent record exists - this is a data inconsistency
          // Create a minimal PropertyHistory record with placeholder data
          console.warn(
            `No active rent found for tenant ${tenant_id} in property ${property_id}. Creating PropertyHistory with default values.`,
          );

          propertyHistory = await queryRunner.manager.save(PropertyHistory, {
            property_id,
            tenant_id,
            move_in_date: DateService.getStartOfTheDay(new Date()),
            monthly_rent: 0, // No rent data available
            owner_comment: 'Auto-generated: No rent record found',
            tenant_comment: null,
            move_out_date: null,
            move_out_reason: null,
          });
        } else {
          // Use the activeRent we already fetched earlier
          // Create the missing PropertyHistory record
          propertyHistory = await queryRunner.manager.save(PropertyHistory, {
            property_id,
            tenant_id,
            move_in_date:
              activeRent.rent_start_date ||
              DateService.getStartOfTheDay(new Date()),
            monthly_rent: activeRent.rental_price,
            owner_comment: null,
            tenant_comment: null,
            move_out_date: null,
            move_out_reason: null,
          });
        }

        console.log('Created PropertyHistory record:', propertyHistory.id);
      }

      // Create a new history record for the move-out event
      const tenancyEndedHistory = await queryRunner.manager.save(
        PropertyHistory,
        {
          property_id,
          tenant_id,
          event_type: 'tenancy_ended',
          move_out_date: DateService.getStartOfTheDay(move_out_date),
          event_description: `Tenant moved out. Reason: ${
            moveOutData?.move_out_reason || 'Not specified'
          }`,
        },
      );

      console.log('🏁 DEBUG: Created tenancy_ended history entry:', {
        id: tenancyEndedHistory.id,
        property_id: tenancyEndedHistory.property_id,
        tenant_id: tenancyEndedHistory.tenant_id,
        event_type: tenancyEndedHistory.event_type,
        move_out_date: tenancyEndedHistory.move_out_date,
        event_description: tenancyEndedHistory.event_description,
      });

      // POST-TRANSACTION VERIFICATION: Ensure all changes were applied correctly
      const verificationResults = await this.verifyMoveOutTransaction(
        queryRunner,
        property_id,
        tenant_id,
      );

      if (!verificationResults.success) {
        console.error(`[MOVE_OUT] Verification failed:`, verificationResults);
        throw new HttpException(
          `Move-out verification failed: ${verificationResults.errors.join(', ')}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      console.log(`[MOVE_OUT] Verification successful:`, verificationResults);

      await queryRunner.commitTransaction();

      // FINAL VERIFICATION: Double-check after commit using a fresh connection
      const finalVerification = await this.verifyMoveOutComplete(
        property_id,
        tenant_id,
      );
      if (!finalVerification.success) {
        console.error(
          `[MOVE_OUT] Final verification failed:`,
          finalVerification,
        );
        // Log the issue but don't fail the operation since transaction is already committed
        // This will be caught by the scheduled consistency check
      }

      // Get property and tenant information for the event
      try {
        const property = await this.propertyRepository.findOne({
          where: { id: property_id },
          relations: ['owner'],
        });

        const tenant = await this.usersRepository.findOne({
          where: { id: tenant_id },
        });

        if (property && tenant) {
          // Emit tenancy ended event for live feed
          this.eventEmitter.emit('tenancy.ended', {
            property_id: property_id,
            property_name: property.name,
            tenant_id: tenant_id,
            tenant_name: `${tenant.first_name} ${tenant.last_name}`,
            user_id: property.owner_id,
            move_out_date: move_out_date,
          });
        }
      } catch (eventError) {
        // Log but don't fail the operation if event emission fails
        console.error('Failed to emit tenancy.ended event:', eventError);
      }

      return {
        message: 'Tenant moved out successfully',
        scheduled: false,
        effective_date: move_out_date,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw new HttpException(
        error?.message || 'an error occurred while moving tenant out',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    } finally {
      await queryRunner.release();
    }
  }

  async processScheduledMoveOuts() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find all scheduled move-outs that are due today or overdue
    const scheduledMoveOuts = await this.scheduledMoveOutRepository.find({
      where: {
        processed: false,
      },
    });

    const dueScheduledMoveOuts = scheduledMoveOuts.filter((scheduled) => {
      const effectiveDate = new Date(scheduled.effective_date);
      effectiveDate.setHours(0, 0, 0, 0);
      return effectiveDate <= today;
    });

    console.log(
      `Processing ${dueScheduledMoveOuts.length} scheduled move-outs`,
    );

    for (const scheduled of dueScheduledMoveOuts) {
      try {
        // Process the move-out
        await this.processMoveTenantOut({
          property_id: scheduled.property_id,
          tenant_id: scheduled.tenant_id,
          move_out_date: scheduled.effective_date.toISOString().split('T')[0],
          move_out_reason: scheduled.move_out_reason || undefined,
          owner_comment: scheduled.owner_comment || undefined,
          tenant_comment: scheduled.tenant_comment || undefined,
        });

        // Mark as processed
        await this.scheduledMoveOutRepository.update(scheduled.id, {
          processed: true,
          processed_at: new Date(),
        });

        console.log(
          `Processed scheduled move-out for tenant ${scheduled.tenant_id} from property ${scheduled.property_id}`,
        );
      } catch (error) {
        console.error(
          `Failed to process scheduled move-out ${scheduled.id}:`,
          error,
        );
        // Continue processing other scheduled move-outs even if one fails
      }
    }

    return {
      processed: dueScheduledMoveOuts.length,
      total: scheduledMoveOuts.length,
    };
  }

  async getScheduledMoveOuts(ownerId?: string) {
    const queryBuilder = this.scheduledMoveOutRepository
      .createQueryBuilder('smo')
      .leftJoinAndSelect('smo.property_id', 'property')
      .leftJoinAndSelect('smo.tenant_id', 'tenant')
      .where('smo.processed = :processed', { processed: false });

    if (ownerId) {
      queryBuilder.andWhere('property.owner_id = :ownerId', { ownerId });
    }

    return queryBuilder.getMany();
  }

  async cancelScheduledMoveOut(scheduleId: string, ownerId?: string) {
    const scheduled = await this.scheduledMoveOutRepository.findOne({
      where: { id: scheduleId, processed: false },
      relations: ['property'],
    });

    if (!scheduled) {
      throw new HttpException(
        'Scheduled move-out not found or already processed',
        HttpStatus.NOT_FOUND,
      );
    }

    // If ownerId is provided, validate ownership
    if (ownerId) {
      const property = await this.propertyRepository.findOneBy({
        id: scheduled.property_id,
      });
      if (!property || property.owner_id !== ownerId) {
        throw new ForbiddenException(
          'You are not authorized to cancel this scheduled move-out',
        );
      }
    }

    await this.scheduledMoveOutRepository.delete(scheduleId);
    return { message: 'Scheduled move-out cancelled successfully' };
  }

  async createPropertyGroup(data: CreatePropertyGroupDto, owner_id: string) {
    const properties = await this.propertyRepository.find({
      where: {
        id: In(data.property_ids),
        owner_id,
      },
    });

    if (properties.length !== data.property_ids.length) {
      throw new HttpException(
        'Some properties do not exist or do not belong to you',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.propertyGroupRepository.save({
      name: data.name,
      property_ids: data.property_ids,
      owner_id,
    });
  }

  async getPropertyGroupById(id: string, owner_id: string) {
    const propertyGroup = await this.propertyGroupRepository.findOne({
      where: { id, owner_id },
    });

    if (!propertyGroup) {
      throw new HttpException('Property group not found', HttpStatus.NOT_FOUND);
    }

    const properties = await this.propertyRepository.find({
      where: { id: In(propertyGroup.property_ids) },
    });

    return {
      ...propertyGroup,
      properties,
    };
  }

  async getAllPropertyGroups(owner_id: string) {
    const propertyGroups = await this.propertyGroupRepository.find({
      where: { owner_id },
      order: { created_at: 'DESC' },
    });

    const allPropertyIds = [
      ...new Set(propertyGroups.flatMap((group) => group.property_ids)),
    ];

    const properties = await this.propertyRepository.find({
      where: { id: In(allPropertyIds) },
    });

    const propertyMap = new Map(
      properties.map((property) => [property.id, property]),
    );

    const groupsWithProperties = propertyGroups.map((group) => ({
      ...group,
      properties: group.property_ids
        .map((id) => propertyMap.get(id))
        .filter(Boolean),
    }));

    return {
      property_groups: groupsWithProperties,
      total: propertyGroups.length,
    };
  }

  @PerformanceMonitor.MonitorPerformance(5000) // Alert if takes more than 5 seconds
  async syncPropertyStatuses() {
    // Method to fix data inconsistencies - sync property status with actual tenancy state
    // Use query builder for better performance
    const properties = await this.propertyRepository
      .createQueryBuilder('property')
      .leftJoinAndSelect(
        'property.rents',
        'rent',
        'rent.rent_status = :activeStatus',
        { activeStatus: RentStatusEnum.ACTIVE },
      )
      .where('property.property_status != :inactiveStatus', {
        inactiveStatus: PropertyStatusEnum.INACTIVE,
      })
      .getMany();

    let statusUpdates = 0;
    let historyRecordsCreated = 0;

    // Batch operations for better performance
    const propertyIdsToUpdate: { id: string; status: PropertyStatusEnum }[] =
      [];
    const historyRecordsToCreate: any[] = [];

    for (const property of properties) {
      const hasActiveRent = property.rents && property.rents.length > 0;
      const correctStatus = hasActiveRent
        ? PropertyStatusEnum.OCCUPIED
        : PropertyStatusEnum.VACANT;

      if (property.property_status !== correctStatus) {
        console.log(
          `Fixing property ${property.name}: ${property.property_status} -> ${correctStatus}`,
        );
        propertyIdsToUpdate.push({ id: property.id, status: correctStatus });
        statusUpdates++;
      }

      // Check for missing history records for active rents
      if (hasActiveRent) {
        for (const rent of property.rents) {
          // Check if history record exists (batch query would be better but this is simpler for now)
          const existingHistory = await this.propertyHistoryRepository.findOne({
            where: {
              property_id: property.id,
              tenant_id: rent.tenant_id,
              move_out_date: IsNull(),
            },
          });

          if (!existingHistory) {
            console.log(
              `Creating missing PropertyHistory record for tenant ${rent.tenant_id} in property ${property.name}`,
            );

            historyRecordsToCreate.push({
              property_id: property.id,
              tenant_id: rent.tenant_id,
              event_type: 'tenancy_record',
              move_in_date:
                rent.rent_start_date ||
                DateService.getStartOfTheDay(new Date()),
              monthly_rent: rent.rental_price,
              owner_comment: 'Auto-created during sync',
              tenant_comment: null,
              move_out_date: null,
              move_out_reason: null,
            });

            historyRecordsCreated++;
          }
        }
      }
    }

    // Batch update operations using query builder to avoid cascading to relations
    if (propertyIdsToUpdate.length > 0) {
      for (const { id, status } of propertyIdsToUpdate) {
        await this.propertyRepository.update(id, { property_status: status });
      }
    }

    if (historyRecordsToCreate.length > 0) {
      await this.propertyHistoryRepository.save(historyRecordsToCreate);
    }

    return {
      message: 'Property statuses synchronized successfully',
      statusUpdates,
      historyRecordsCreated,
    };
  }

  async assignTenant(id: string, data: AssignTenantDto) {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const property = await queryRunner.manager.findOne(Property, {
        where: { id },
      });

      if (!property?.id) {
        throw new HttpException(
          `Property with id: ${id} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      // Only allow tenant assignment to vacant properties
      if (property.property_status === PropertyStatusEnum.OCCUPIED) {
        throw new HttpException(
          'Property is already occupied. Cannot attach another tenant.',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (property.property_status === PropertyStatusEnum.INACTIVE) {
        throw new HttpException(
          'Cannot assign tenant to inactive property. Please reactivate the property first.',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (property.property_status !== PropertyStatusEnum.VACANT) {
        throw new HttpException(
          'Can only attach tenant to vacant properties.',
          HttpStatus.BAD_REQUEST,
        );
      }

      const tenant = await this.userService.getAccountById(data.tenant_id);
      if (!tenant) throw new NotFoundException('Tenant not found');

      // Calculate next rent due date (expiry_date)
      const rentStartDate = new Date(data.rent_start_date);
      const rentFrequency = data.payment_frequency || 'Monthly';
      const expiryDate = this.calculateNextRentDate(
        rentStartDate,
        rentFrequency,
      );

      const rent = await queryRunner.manager.save(Rent, {
        tenant_id: data.tenant_id,
        rent_start_date: data.rent_start_date,
        property_id: property.id,
        amount_paid: 0,
        rental_price: data.rental_price,
        security_deposit: data.security_deposit,
        service_charge: data.service_charge,
        payment_frequency: rentFrequency,
        payment_status: RentPaymentStatusEnum.PENDING,
        rent_status: RentStatusEnum.ACTIVE,
        expiry_date: expiryDate,
      });

      // Record the first period charge in the tenant balance ledger
      await this.tenantBalancesService.applyChange(
        data.tenant_id,
        property.owner_id,
        -(data.rental_price + (data.service_charge || 0)),
        {
          type: TenantBalanceLedgerType.INITIAL_BALANCE,
          description: 'Tenancy started',
          propertyId: property.id,
          relatedEntityType: 'rent',
          relatedEntityId: rent.id,
        },
      );

      await Promise.all([
        queryRunner.manager.save(PropertyTenant, {
          property_id: property.id,
          tenant_id: data.tenant_id,
          status: TenantStatusEnum.ACTIVE,
        }),
        queryRunner.manager.update(Property, property.id, {
          property_status: PropertyStatusEnum.OCCUPIED,
          is_marketing_ready: false,
        }),
        queryRunner.manager.save(PropertyHistory, {
          property_id: property.id,
          tenant_id: data.tenant_id,
          move_in_date: DateService.getStartOfTheDay(new Date()),
          monthly_rent: data.rental_price,
          owner_comment: null,
          tenant_comment: null,
          move_out_date: null,
          move_out_reason: null,
        }),
        // Note: KYC links are now general per landlord, not property-specific
        // No need to deactivate KYC links when a single property becomes occupied
      ]);

      await queryRunner.commitTransaction();

      return {
        message: 'Tenant Added Successfully',
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('Transaction rolled back due to:', error);
      throw new HttpException(
        error?.message ||
          'An error occurred while assigning Tenant To property',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Calculate next rent due date based on start date and frequency
   * This matches the logic used in tenant-attachment.service.ts
   */
  private calculateNextRentDate(startDate: Date, frequency: string): Date {
    const nextDate = new Date(startDate);
    const dueDay = startDate.getDate();

    // Add frequency duration to get to the next period
    switch (frequency) {
      case 'Monthly':
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      case 'Quarterly':
        nextDate.setMonth(nextDate.getMonth() + 3);
        break;
      case 'Bi-Annually':
        nextDate.setMonth(nextDate.getMonth() + 6);
        break;
      case 'Annually':
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        break;
      default:
        nextDate.setMonth(nextDate.getMonth() + 1);
    }

    // Set the specific due day
    // Handle cases where the due day doesn't exist in the target month
    const targetMonth = nextDate.getMonth();
    nextDate.setDate(dueDay);

    // If setting the day pushed us to the next month, backtrack to the last day of the previous month
    if (nextDate.getMonth() !== targetMonth) {
      nextDate.setDate(0);
    }

    // Subtract 1 day to get the day BEFORE the next cycle starts
    nextDate.setDate(nextDate.getDate() - 1);

    return nextDate;
  }

  /**
   * Note: KYC links are now general per landlord, not property-specific
   * This method is no longer needed but kept for backward compatibility
   */
  private async deactivateKYCLinksForProperty(
    queryRunner: any,
    propertyId: string,
  ): Promise<void> {
    // No longer needed - KYC links are general per landlord
    console.log(
      `KYC links are now general per landlord, not deactivating for property ${propertyId}`,
    );
  }

  /**
   * Fix tenant data leakage issue by analyzing and reporting data consistency
   * This method provides information about the fix that has been applied
   */
  async fixTenantDataLeakage(landlordId?: string): Promise<{
    message: string;
    fixed: boolean;
    details: any;
  }> {
    console.log('🔧 Analyzing tenant data leakage fix...', { landlordId });

    try {
      // Get tenant KYC records (filtered by landlord if provided)
      let kycQuery = this.tenantKycRepository
        .createQueryBuilder('kyc')
        .leftJoinAndSelect('kyc.user', 'user');

      if (landlordId) {
        kycQuery = kycQuery.where('kyc.admin_id = :landlordId', { landlordId });
      }

      const allTenantKyc = await kycQuery.getMany();

      // Group by user_id to find users with multiple KYC records
      const userKycMap = new Map<string, TenantKyc[]>();
      allTenantKyc.forEach((kyc) => {
        if (kyc.user_id) {
          if (!userKycMap.has(kyc.user_id)) {
            userKycMap.set(kyc.user_id, []);
          }
          userKycMap.get(kyc.user_id)!.push(kyc);
        }
      });

      // Find users with multiple KYC records across different landlords
      const duplicateUsers = Array.from(userKycMap.entries()).filter(
        ([_, records]) => records.length > 1,
      );

      let crossPropertyUsers = 0;
      for (const [userId, records] of duplicateUsers) {
        const uniqueAdminIds = new Set(records.map((r) => r.admin_id));
        if (uniqueAdminIds.size > 1) {
          crossPropertyUsers++;
        }
      }

      const analysis = {
        totalTenantKycRecords: allTenantKyc.length,
        usersWithMultipleRecords: duplicateUsers.length,
        usersAcrossMultipleLandlords: crossPropertyUsers,
        fixApplied: true,
        fixDescription: [
          'Database queries have been updated to filter tenant_kyc records by property owner (admin_id)',
          'getPropertyDetails() now uses: tenantKyc.admin_id = property.owner_id',
          'getPropertyById() now uses: tenantKyc.admin_id = property.owner_id',
          'This prevents tenant data from other properties from being displayed',
        ],
        impact:
          crossPropertyUsers > 0
            ? `Fixed potential data leakage for ${crossPropertyUsers} users who have KYC records across multiple landlords`
            : 'No cross-landlord data leakage detected',
      };

      console.log('✅ Analysis complete:', analysis);

      return {
        message:
          'Tenant data leakage analysis completed. Database queries have been fixed.',
        fixed: true,
        details: analysis,
      };
    } catch (error) {
      console.error('❌ Analysis failed:', error);
      return {
        message: `Analysis failed: ${error.message}`,
        fixed: false,
        details: { error: error.message },
      };
    }
  }

  /**
   * Quick check to verify tenant data fix is working for a landlord
   */
  async checkTenantDataFix(landlordId: string): Promise<{
    message: string;
    isFixed: boolean;
    details: any;
  }> {
    console.log('🔍 Quick check for tenant data fix...', { landlordId });

    try {
      // Get a sample of properties with tenants for this landlord
      const properties = await this.propertyRepository
        .createQueryBuilder('property')
        .leftJoinAndSelect(
          'property.property_tenants',
          'propertyTenant',
          'propertyTenant.status = :tenantStatus',
          { tenantStatus: 'active' },
        )
        .leftJoinAndSelect('propertyTenant.tenant', 'tenant')
        .leftJoinAndSelect('tenant.user', 'tenantUser')
        .leftJoinAndSelect(
          'tenantUser.tenant_kycs',
          'tenantKyc',
          'tenantKyc.admin_id = property.owner_id',
        )
        .where('property.owner_id = :landlordId', { landlordId })
        .limit(10) // Check first 10 properties
        .getMany();

      const occupiedProperties = properties.filter(
        (p) => p.property_tenants && p.property_tenants.length > 0,
      );

      let correctlyFilteredCount = 0;
      let totalTenantsChecked = 0;
      const sampleResults: any[] = [];

      for (const property of occupiedProperties) {
        for (const propertyTenant of property.property_tenants) {
          totalTenantsChecked++;
          const tenant = propertyTenant.tenant;

          if (tenant && tenant.user) {
            // The fix should ensure that tenant_kycs is either empty or belongs to this landlord
            const tenantKyc = tenant.user.tenant_kycs?.[0];

            if (!tenantKyc || tenantKyc.admin_id === landlordId) {
              correctlyFilteredCount++;
              sampleResults.push({
                propertyId: property.id,
                propertyName: property.name,
                tenantName: `${tenant.user.first_name} ${tenant.user.last_name}`,
                kycFiltered: tenantKyc
                  ? 'Correctly filtered to this landlord'
                  : 'No KYC data (expected)',
                status: '✅ Correct',
              });
            } else {
              sampleResults.push({
                propertyId: property.id,
                propertyName: property.name,
                tenantName: `${tenant.user.first_name} ${tenant.user.last_name}`,
                kycFiltered: `❌ KYC belongs to different landlord: ${tenantKyc.admin_id}`,
                status: '❌ Issue detected',
              });
            }
          }
        }
      }

      const isFixed = correctlyFilteredCount === totalTenantsChecked;

      return {
        message: isFixed
          ? '✅ Tenant data fix is working correctly!'
          : '❌ Issues detected - tenant data may still be leaking',
        isFixed,
        details: {
          landlordId,
          propertiesChecked: properties.length,
          occupiedProperties: occupiedProperties.length,
          totalTenantsChecked,
          correctlyFilteredCount,
          fixEffectiveness:
            totalTenantsChecked > 0
              ? `${Math.round((correctlyFilteredCount / totalTenantsChecked) * 100)}%`
              : 'N/A',
          sampleResults: sampleResults.slice(0, 5), // Show first 5 results
          recommendations: isFixed
            ? [
                'The fix is working correctly',
                'Clear browser cache if you still see issues',
              ]
            : [
                'Database queries may need additional fixes',
                'Contact technical support',
              ],
        },
      };
    } catch (error) {
      console.error('❌ Check failed:', error);
      return {
        message: `Check failed: ${error.message}`,
        isFixed: false,
        details: { error: error.message },
      };
    }
  }

  /**
   * Deep diagnostic to find the exact source of tenant data leakage
   */
  async diagnoseTenantDataLeakage(landlordId: string): Promise<{
    message: string;
    issues: any[];
    details: any;
  }> {
    console.log('🔍 Deep diagnostic for tenant data leakage...', {
      landlordId,
    });

    try {
      const issues: any[] = [];

      // 1. Check for duplicate tenant assignments (same tenant on multiple properties)
      const duplicateAssignments = await this.propertyTenantRepository
        .createQueryBuilder('pt')
        .leftJoinAndSelect('pt.property', 'property')
        .leftJoinAndSelect('pt.tenant', 'tenant')
        .leftJoinAndSelect('tenant.user', 'user')
        .where('pt.status = :status', { status: 'active' })
        .andWhere('property.owner_id = :landlordId', { landlordId })
        .getMany();

      // Group by tenant to find duplicates
      const tenantAssignments = new Map();
      duplicateAssignments.forEach((assignment) => {
        const tenantId = assignment.tenant.id;
        if (!tenantAssignments.has(tenantId)) {
          tenantAssignments.set(tenantId, []);
        }
        tenantAssignments.get(tenantId).push(assignment);
      });

      // Find tenants assigned to multiple properties
      const duplicateTenants = Array.from(tenantAssignments.entries()).filter(
        ([_, assignments]) => assignments.length > 1,
      );

      duplicateTenants.forEach(([tenantId, assignments]) => {
        const tenantName = `${assignments[0].tenant.user.first_name} ${assignments[0].tenant.user.last_name}`;
        const propertyNames = assignments.map((a) => a.property.name);

        issues.push({
          type: 'DUPLICATE_TENANT_ASSIGNMENT',
          severity: 'HIGH',
          tenantId,
          tenantName,
          assignedToProperties: propertyNames,
          propertyIds: assignments.map((a) => a.property.id),
          message: `Tenant "${tenantName}" is assigned to multiple properties: ${propertyNames.join(', ')}`,
        });
      });

      // 2. Check for orphaned rent records
      const orphanedRents = await this.dataSource.query(
        `
        SELECT r.*, p.name as property_name, u.first_name, u.last_name
        FROM rents r
        LEFT JOIN properties p ON r.property_id = p.id
        LEFT JOIN accounts a ON r.tenant_id = a.id
        LEFT JOIN users u ON a."userId" = u.id
        WHERE r.rent_status = 'active' 
        AND p.owner_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM property_tenants pt 
          WHERE pt.property_id = r.property_id 
          AND pt.tenant_id = r.tenant_id 
          AND pt.status = 'active'
        )
      `,
        [landlordId],
      );

      orphanedRents.forEach((rent) => {
        issues.push({
          type: 'ORPHANED_RENT_RECORD',
          severity: 'MEDIUM',
          rentId: rent.id,
          propertyId: rent.property_id,
          propertyName: rent.property_name,
          tenantName: `${rent.first_name} ${rent.last_name}`,
          message: `Active rent record exists without corresponding property-tenant assignment`,
        });
      });

      // 3. Test the actual getAllProperties method that's causing issues
      const allPropertiesResult = await this.getAllProperties({
        owner_id: landlordId,
        page: 1,
        size: 50, // Check more properties
      });

      const propertiesWithTenants = allPropertiesResult.properties.filter(
        (p) =>
          p.rents &&
          p.rents.length > 0 &&
          p.rents.some((r) => r.rent_status === 'active'),
      );

      // 4. Check for tenant_kyc records that might be causing confusion
      const problematicKycRecords = await this.dataSource.query(
        `
        SELECT tk.*, u.first_name, u.last_name, u.email, u.phone_number,
               p.id as property_id, p.name as property_name
        FROM tenant_kyc tk
        LEFT JOIN users u ON tk.user_id = u.id
        LEFT JOIN properties p ON tk.admin_id = p.owner_id
        WHERE tk.admin_id != $1
        AND u.id IN (
          SELECT DISTINCT u2.id 
          FROM users u2
          JOIN accounts a ON u2.id = a."userId"
          JOIN property_tenants pt ON a.id = pt.tenant_id
          JOIN properties p2 ON pt.property_id = p2.id
          WHERE p2.owner_id = $1 AND pt.status = 'active'
        )
      `,
        [landlordId],
      );

      problematicKycRecords.forEach((record) => {
        issues.push({
          type: 'CROSS_LANDLORD_KYC_RECORD',
          severity: 'HIGH',
          tenantName: `${record.first_name} ${record.last_name}`,
          kycAdminId: record.admin_id,
          currentLandlordId: landlordId,
          message: `Tenant has KYC record with different landlord (${record.admin_id}) but is assigned to your property`,
        });
      });

      return {
        message: `Found ${issues.length} potential issues causing tenant data leakage`,
        issues,
        details: {
          landlordId,
          totalPropertiesChecked: allPropertiesResult.properties.length,
          propertiesWithTenants: propertiesWithTenants.length,
          duplicateTenantsFound: duplicateTenants.length,
          orphanedRentsFound: orphanedRents.length,
          crossLandlordKycRecords: problematicKycRecords.length,
          samplePropertiesWithTenants: propertiesWithTenants
            .slice(0, 5)
            .map((p) => ({
              id: p.id,
              name: p.name,
              activeRents: p.rents
                .filter((r) => r.rent_status === 'active')
                .map((r) => ({
                  tenantName: `${r.tenant.user.first_name} ${r.tenant.user.last_name}`,
                  tenantId: r.tenant.id,
                  hasFilteredKyc: !!r.tenant.user.tenant_kycs?.[0],
                  kycAdminId: r.tenant.user.tenant_kycs?.[0]?.admin_id,
                })),
            })),
        },
      };
    } catch (error) {
      console.error('❌ Diagnostic failed:', error);
      return {
        message: `Diagnostic failed: ${error.message}`,
        issues: [],
        details: { error: error.message },
      };
    }
  }

  /**
   * Check if a tenant with the given phone number already exists for this landlord
   * Requirements: 8.1, 8.2
   */
  async checkExistingTenant(
    landlordId: string,
    normalizedPhone: string,
  ): Promise<{ exists: boolean; propertyName?: string }> {
    try {
      // Normalize the phone number regardless of format sent by caller
      const phone = this.utilService.normalizePhoneNumber(normalizedPhone);

      // Find any active tenant with this phone number for this landlord
      const existingTenant = await this.propertyTenantRepository
        .createQueryBuilder('pt')
        .leftJoinAndSelect('pt.property', 'property')
        .leftJoinAndSelect('pt.tenant', 'tenant')
        .leftJoinAndSelect('tenant.user', 'user')
        .where('pt.status = :status', { status: TenantStatusEnum.ACTIVE })
        .andWhere('property.owner_id = :landlordId', { landlordId })
        .andWhere('user.phone_number = :phone', { phone })
        .getOne();

      if (existingTenant) {
        return {
          exists: true,
          propertyName: existingTenant.property.name,
        };
      }

      return { exists: false };
    } catch (error) {
      console.error('Error checking existing tenant:', {
        error: error instanceof Error ? error.message : String(error),
        landlordId,
        phone: normalizedPhone,
        timestamp: new Date().toISOString(),
      });

      // Return false on error to not block property creation
      return { exists: false };
    }
  }

  /**
   * Clean up duplicate tenant assignments for a specific landlord
   */
  async cleanupDuplicateTenantAssignments(landlordId: string): Promise<{
    message: string;
    success: boolean;
    details: any;
  }> {
    console.log('🧹 Cleaning up duplicate tenant assignments...', {
      landlordId,
    });

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Find tenants with multiple active assignments
      const duplicateAssignments = await queryRunner.manager.query(
        `
        SELECT 
          u.id as user_id,
          u.first_name,
          u.last_name,
          a.id as account_id,
          COUNT(pt.property_id) as property_count,
          ARRAY_AGG(pt.property_id) as property_ids,
          ARRAY_AGG(p.name) as property_names
        FROM property_tenants pt
        JOIN accounts a ON pt.tenant_id = a.id
        JOIN users u ON a."userId" = u.id
        JOIN properties p ON pt.property_id = p.id
        WHERE pt.status = 'active' 
        AND p.owner_id = $1
        GROUP BY u.id, u.first_name, u.last_name, a.id
        HAVING COUNT(pt.property_id) > 1
      `,
        [landlordId],
      );

      let cleanedUpTenants = 0;
      let propertiesFreed = 0;
      const cleanupDetails: any[] = [];

      for (const duplicate of duplicateAssignments) {
        const tenantName = `${duplicate.first_name} ${duplicate.last_name}`;
        const propertyIds = duplicate.property_ids;
        const propertyNames = duplicate.property_names;

        console.log(
          `Cleaning up duplicate assignments for ${tenantName}:`,
          propertyNames,
        );

        // Keep the most recent assignment, deactivate others
        const assignments = await queryRunner.manager.query(
          `
          SELECT pt.id, pt.property_id, p.name, pt.created_at
          FROM property_tenants pt
          JOIN properties p ON pt.property_id = p.id
          WHERE pt.tenant_id = $1 
          AND pt.status = 'active'
          AND p.owner_id = $2
          ORDER BY pt.created_at DESC
        `,
          [duplicate.account_id, landlordId],
        );

        if (assignments.length > 1) {
          // Keep the most recent, deactivate the rest
          const [mostRecent, ...oldAssignments] = assignments;

          for (const oldAssignment of oldAssignments) {
            // Deactivate property-tenant relationship
            await queryRunner.manager.update(
              'property_tenants',
              { id: oldAssignment.id },
              { status: 'inactive' },
            );

            // Deactivate corresponding rent records
            await queryRunner.manager.update(
              'rents',
              {
                tenant_id: duplicate.account_id,
                property_id: oldAssignment.property_id,
                rent_status: 'active',
              },
              { rent_status: 'inactive' },
            );

            // Set property back to vacant
            await queryRunner.manager.update(
              'properties',
              { id: oldAssignment.property_id },
              { property_status: 'vacant' },
            );

            propertiesFreed++;
            console.log(`Freed property: ${oldAssignment.name}`);
          }

          // Ensure the kept property is marked as occupied
          await queryRunner.manager.update(
            'properties',
            { id: mostRecent.property_id },
            { property_status: 'occupied' },
          );

          cleanupDetails.push({
            tenantName,
            keptProperty: mostRecent.name,
            freedProperties: oldAssignments.map((a) => a.name),
            totalAssignments: assignments.length,
            cleanedUp: oldAssignments.length,
          });

          cleanedUpTenants++;
        }
      }

      await queryRunner.commitTransaction();

      const message = `Cleanup completed: ${cleanedUpTenants} tenants with duplicate assignments fixed, ${propertiesFreed} properties freed`;
      console.log('✅ Cleanup completed:', message);

      return {
        message,
        success: true,
        details: {
          landlordId,
          cleanedUpTenants,
          propertiesFreed,
          cleanupDetails,
        },
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('❌ Cleanup failed:', error);
      return {
        message: `Cleanup failed: ${error.message}`,
        success: false,
        details: { error: error.message },
      };
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Fix orphaned rent records (rents without valid tenant data)
   */
  async fixOrphanedRentRecords(landlordId: string): Promise<{
    message: string;
    success: boolean;
    details: any;
  }> {
    console.log('🔧 Fixing orphaned rent records...', { landlordId });

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Find rent records with missing or invalid tenant data
      const orphanedRents = await queryRunner.manager.query(
        `
        SELECT 
          r.id as rent_id,
          r.property_id,
          r.tenant_id,
          r.rental_price,
          p.name as property_name,
          a.id as account_id,
          u.id as user_id,
          u.first_name,
          u.last_name
        FROM rents r
        JOIN properties p ON r.property_id = p.id
        LEFT JOIN accounts a ON r.tenant_id = a.id
        LEFT JOIN users u ON a."userId" = u.id
        WHERE r.rent_status = 'active'
        AND p.owner_id = $1
        AND (a.id IS NULL OR u.id IS NULL OR u.first_name IS NULL)
      `,
        [landlordId],
      );

      let fixedRents = 0;
      let propertiesFreed = 0;
      const fixDetails: any[] = [];

      for (const orphanedRent of orphanedRents) {
        console.log(
          `Fixing orphaned rent for property: ${orphanedRent.property_name}`,
        );

        // Deactivate the orphaned rent record
        await queryRunner.manager.update(
          'rents',
          { id: orphanedRent.rent_id },
          { rent_status: 'inactive' },
        );

        // Set property back to vacant
        await queryRunner.manager.update(
          'properties',
          { id: orphanedRent.property_id },
          { property_status: 'vacant' },
        );

        // Remove any property-tenant assignments for this orphaned rent
        await queryRunner.manager.update(
          'property_tenants',
          {
            property_id: orphanedRent.property_id,
            tenant_id: orphanedRent.tenant_id,
            status: 'active',
          },
          { status: 'inactive' },
        );

        fixDetails.push({
          propertyName: orphanedRent.property_name,
          rentId: orphanedRent.rent_id,
          tenantId: orphanedRent.tenant_id,
          issue: orphanedRent.account_id
            ? 'Missing user data'
            : 'Missing account',
          action: 'Deactivated rent and set property to vacant',
        });

        fixedRents++;
        propertiesFreed++;
      }

      await queryRunner.commitTransaction();

      const message = `Fixed ${fixedRents} orphaned rent records, freed ${propertiesFreed} properties`;
      console.log('✅ Orphaned rent cleanup completed:', message);

      return {
        message,
        success: true,
        details: {
          landlordId,
          fixedRents,
          propertiesFreed,
          fixDetails,
        },
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('❌ Orphaned rent cleanup failed:', error);
      return {
        message: `Cleanup failed: ${error.message}`,
        success: false,
        details: { error: error.message },
      };
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Check and fix rent data consistency issues
   * This method identifies and fixes cases where:
   * 1. Rent records are active but no PropertyTenant relationship exists
   * 2. PropertyTenant relationship exists but no active rent record
   * 3. Multiple active rent records exist for the same tenant-property
   */
  async checkAndFixRentConsistency(adminId?: string): Promise<{
    message: string;
    issues: Array<{
      type: string;
      rentId?: string;
      propertyId?: string;
      tenantId?: string;
      propertyName?: string;
      count?: number;
      rentIds?: string[];
    }>;
    fixed: number;
    details: {
      orphanedActiveRents: number;
      duplicateActiveRents: number;
      tenantsWithoutActiveRent: number;
    };
  }> {
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const issues: Array<{
        type: string;
        rentId?: string;
        propertyId?: string;
        tenantId?: string;
        propertyName?: string;
        count?: number;
        rentIds?: string[];
      }> = [];
      let fixedCount = 0;

      // Issue 1: Active rents without PropertyTenant relationship
      const orphanedActiveRents = await queryRunner.manager
        .createQueryBuilder(Rent, 'rent')
        .leftJoin(
          PropertyTenant,
          'pt',
          'pt.property_id = rent.property_id AND pt.tenant_id = rent.tenant_id AND pt.status = :activeStatus',
          { activeStatus: TenantStatusEnum.ACTIVE },
        )
        .leftJoin(Property, 'p', 'p.id = rent.property_id')
        .where('rent.rent_status = :activeRent', {
          activeRent: RentStatusEnum.ACTIVE,
        })
        .andWhere('pt.id IS NULL')
        .andWhere(
          adminId ? 'p.owner_id = :adminId' : '1=1',
          adminId ? { adminId } : {},
        )
        .select(['rent.id', 'rent.property_id', 'rent.tenant_id', 'p.name'])
        .getRawMany();

      for (const orphanedRent of orphanedActiveRents) {
        issues.push({
          type: 'orphaned_active_rent',
          rentId: orphanedRent.rent_id,
          propertyId: orphanedRent.rent_property_id,
          tenantId: orphanedRent.rent_tenant_id,
          propertyName: orphanedRent.p_name,
        });

        // Fix: Deactivate orphaned rent records
        await queryRunner.manager.update(Rent, orphanedRent.rent_id, {
          rent_status: RentStatusEnum.INACTIVE,
          updated_at: new Date(),
        });
        fixedCount++;
      }

      // Issue 2: Multiple active rents for same tenant-property
      const duplicateActiveRents = await queryRunner.manager
        .createQueryBuilder(Rent, 'rent')
        .leftJoin(Property, 'p', 'p.id = rent.property_id')
        .where('rent.rent_status = :activeRent', {
          activeRent: RentStatusEnum.ACTIVE,
        })
        .andWhere(
          adminId ? 'p.owner_id = :adminId' : '1=1',
          adminId ? { adminId } : {},
        )
        .groupBy('rent.property_id, rent.tenant_id')
        .having('COUNT(*) > 1')
        .select(['rent.property_id', 'rent.tenant_id', 'COUNT(*) as count'])
        .getRawMany();

      for (const duplicate of duplicateActiveRents) {
        const allActiveRents = await queryRunner.manager.find(Rent, {
          where: {
            property_id: duplicate.rent_property_id,
            tenant_id: duplicate.rent_tenant_id,
            rent_status: RentStatusEnum.ACTIVE,
          },
          order: { created_at: 'DESC' },
        });

        issues.push({
          type: 'multiple_active_rents',
          propertyId: duplicate.rent_property_id,
          tenantId: duplicate.rent_tenant_id,
          count: duplicate.count,
          rentIds: allActiveRents.map((r) => r.id),
        });

        // Fix: Keep only the most recent rent, deactivate others
        const [keepRent, ...deactivateRents] = allActiveRents;
        for (const rent of deactivateRents) {
          await queryRunner.manager.update(Rent, rent.id, {
            rent_status: RentStatusEnum.INACTIVE,
            updated_at: new Date(),
          });
          fixedCount++;
        }
      }

      // Issue 3: PropertyTenant relationships without active rent records
      const tenantsWithoutActiveRent = await queryRunner.manager
        .createQueryBuilder(PropertyTenant, 'pt')
        .leftJoin(
          Rent,
          'rent',
          'rent.property_id = pt.property_id AND rent.tenant_id = pt.tenant_id AND rent.rent_status = :activeRent',
          { activeRent: RentStatusEnum.ACTIVE },
        )
        .leftJoin(Property, 'p', 'p.id = pt.property_id')
        .where('pt.status = :activeStatus', {
          activeStatus: TenantStatusEnum.ACTIVE,
        })
        .andWhere('rent.id IS NULL')
        .andWhere(
          adminId ? 'p.owner_id = :adminId' : '1=1',
          adminId ? { adminId } : {},
        )
        .select(['pt.property_id', 'pt.tenant_id', 'p.name'])
        .getRawMany();

      for (const tenantWithoutRent of tenantsWithoutActiveRent) {
        issues.push({
          type: 'tenant_without_active_rent',
          propertyId: tenantWithoutRent.pt_property_id,
          tenantId: tenantWithoutRent.pt_tenant_id,
          propertyName: tenantWithoutRent.p_name,
        });

        // Fix: Remove the PropertyTenant relationship since there's no active rent
        await queryRunner.manager.delete(PropertyTenant, {
          property_id: tenantWithoutRent.pt_property_id,
          tenant_id: tenantWithoutRent.pt_tenant_id,
        });
        fixedCount++;
      }

      await queryRunner.commitTransaction();

      return {
        message: `Rent consistency check completed. Found ${issues.length} issues, fixed ${fixedCount}.`,
        issues,
        fixed: fixedCount,
        details: {
          orphanedActiveRents: orphanedActiveRents.length,
          duplicateActiveRents: duplicateActiveRents.length,
          tenantsWithoutActiveRent: tenantsWithoutActiveRent.length,
        },
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('[RENT_CONSISTENCY_CHECK] Error:', error);
      throw new HttpException(
        'Failed to check rent consistency',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Verify that move-out transaction was successful (within transaction)
   */
  private async verifyMoveOutTransaction(
    queryRunner: any,
    propertyId: string,
    tenantId: string,
  ): Promise<{
    success: boolean;
    errors: string[];
    details: {
      activeRentsFound?: number;
      activePropertyTenantsFound?: number;
      propertyStatus?: string;
      error?: string;
    };
  }> {
    const errors: string[] = [];
    const details: {
      activeRentsFound?: number;
      activePropertyTenantsFound?: number;
      propertyStatus?: string;
      error?: string;
    } = {};

    try {
      // Check 1: No active rent records should exist
      const activeRents = await queryRunner.manager.find(Rent, {
        where: {
          property_id: propertyId,
          tenant_id: tenantId,
          rent_status: RentStatusEnum.ACTIVE,
        },
      });

      details.activeRentsFound = activeRents.length;
      if (activeRents.length > 0) {
        errors.push(`${activeRents.length} active rent records still exist`);
      }

      // Check 2: No active PropertyTenant relationship should exist
      const activePropertyTenants = await queryRunner.manager.find(
        PropertyTenant,
        {
          where: {
            property_id: propertyId,
            tenant_id: tenantId,
            status: TenantStatusEnum.ACTIVE,
          },
        },
      );

      details.activePropertyTenantsFound = activePropertyTenants.length;
      if (activePropertyTenants.length > 0) {
        errors.push(
          `${activePropertyTenants.length} active PropertyTenant relationships still exist`,
        );
      }

      // Check 3: Property should be vacant
      const property = await queryRunner.manager.findOne(Property, {
        where: { id: propertyId },
      });

      details.propertyStatus = property?.property_status;
      if (property?.property_status !== PropertyStatusEnum.VACANT) {
        errors.push(
          `Property status is ${property?.property_status}, expected VACANT`,
        );
      }

      return {
        success: errors.length === 0,
        errors,
        details,
      };
    } catch (error) {
      return {
        success: false,
        errors: [`Verification error: ${error.message}`],
        details: { error: error.message },
      };
    }
  }

  /**
   * Final verification after transaction commit (using fresh connection)
   */
  private async verifyMoveOutComplete(
    propertyId: string,
    tenantId: string,
  ): Promise<{
    success: boolean;
    errors: string[];
    details: {
      activeRentsFound?: number;
      activePropertyTenantsFound?: number;
      error?: string;
    };
  }> {
    const errors: string[] = [];
    const details: {
      activeRentsFound?: number;
      activePropertyTenantsFound?: number;
      error?: string;
    } = {};

    try {
      // Check 1: No active rent records should exist
      const activeRents = await this.rentRepository.find({
        where: {
          property_id: propertyId,
          tenant_id: tenantId,
          rent_status: RentStatusEnum.ACTIVE,
        },
      });

      details.activeRentsFound = activeRents.length;
      if (activeRents.length > 0) {
        errors.push(
          `${activeRents.length} active rent records still exist after commit`,
        );
      }

      // Check 2: No active PropertyTenant relationship should exist
      const activePropertyTenants = await this.propertyTenantRepository.find({
        where: {
          property_id: propertyId,
          tenant_id: tenantId,
          status: TenantStatusEnum.ACTIVE,
        },
      });

      details.activePropertyTenantsFound = activePropertyTenants.length;
      if (activePropertyTenants.length > 0) {
        errors.push(
          `${activePropertyTenants.length} active PropertyTenant relationships still exist after commit`,
        );
      }

      return {
        success: errors.length === 0,
        errors,
        details,
      };
    } catch (error) {
      return {
        success: false,
        errors: [`Final verification error: ${error.message}`],
        details: { error: error.message },
      };
    }
  }

  /**
   * Fix specific rent record issue
   * Use this to fix individual problematic rent records
   */
  async fixSpecificRentRecord(
    rentId: string,
    adminId?: string,
  ): Promise<{
    message: string;
    fixed: boolean;
    details: {
      rentId: string;
      currentStatus: string;
      propertyId: string;
      tenantId: string;
      propertyName: string;
      propertyStatus: string;
      hasPropertyTenantRelation: boolean;
      action?: string;
    };
  }> {
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      // Get the rent record with property info
      const rentRecord = await queryRunner.manager
        .createQueryBuilder(Rent, 'rent')
        .leftJoin(Property, 'p', 'p.id = rent.property_id')
        .leftJoin(
          PropertyTenant,
          'pt',
          'pt.property_id = rent.property_id AND pt.tenant_id = rent.tenant_id AND pt.status = :activeStatus',
          { activeStatus: TenantStatusEnum.ACTIVE },
        )
        .where('rent.id = :rentId', { rentId })
        .andWhere(
          adminId ? 'p.owner_id = :adminId' : '1=1',
          adminId ? { adminId } : {},
        )
        .select([
          'rent.id',
          'rent.rent_status',
          'rent.property_id',
          'rent.tenant_id',
          'p.name',
          'p.property_status',
          'pt.id as property_tenant_id',
        ])
        .getRawOne();

      if (!rentRecord) {
        throw new HttpException(
          'Rent record not found or access denied',
          HttpStatus.NOT_FOUND,
        );
      }

      const details: {
        rentId: string;
        currentStatus: string;
        propertyId: string;
        tenantId: string;
        propertyName: string;
        propertyStatus: string;
        hasPropertyTenantRelation: boolean;
        action?: string;
      } = {
        rentId: rentRecord.rent_id,
        currentStatus: rentRecord.rent_rent_status,
        propertyId: rentRecord.rent_property_id,
        tenantId: rentRecord.rent_tenant_id,
        propertyName: rentRecord.p_name,
        propertyStatus: rentRecord.p_property_status,
        hasPropertyTenantRelation: !!rentRecord.property_tenant_id,
      };

      let fixed = false;

      // If rent is active but no PropertyTenant relationship exists, deactivate the rent
      if (
        rentRecord.rent_rent_status === RentStatusEnum.ACTIVE &&
        !rentRecord.property_tenant_id
      ) {
        await queryRunner.manager.update(Rent, rentId, {
          rent_status: RentStatusEnum.INACTIVE,
          updated_at: new Date(),
        });
        fixed = true;
        details.action = 'Deactivated orphaned rent record';
      }

      await queryRunner.commitTransaction();

      return {
        message: fixed
          ? 'Rent record fixed successfully'
          : 'No issues found with this rent record',
        fixed,
        details,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('[FIX_SPECIFIC_RENT] Error:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
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
import { rejectOtherPendingApplications } from './reject-other-applications';
import { Rent } from '../rents/entities/rent.entity';
import { Account } from '../users/entities/account.entity';
import { Users } from '../users/entities/user.entity';
import { TenantKyc } from '../tenant-kyc/entities/tenant-kyc.entity';
import { OfferLetter } from '../offer-letters/entities/offer-letter.entity';
import { RentFrequency } from './dto/attach-tenant.dto';
import {
  PropertyStatusEnum,
  TenantStatusEnum,
} from '../properties/dto/create-property.dto';
import {
  RentStatusEnum,
  RentPaymentStatusEnum,
} from '../rents/dto/create-rent.dto';
import { DateService } from '../utils/date.helper';
import { calculateRentExpiryDate } from '../common/utils/rent-date.util';
import { RolesEnum } from '../base.entity';
import { WhatsappBotService } from '../whatsapp-bot/whatsapp-bot.service';
import { UtilService } from '../utils/utility-service';
import { ReceiptsService } from '../receipts/receipts.service';
import { TenantBalancesService } from '../tenant-balances/tenant-balances.service';
import { TenantBalanceLedgerType } from '../tenant-balances/entities/tenant-balance-ledger.entity';
import { PropertyHistoryService } from '../property-history/property-history.service';
import {
  offerLetterToFees,
  sumRecurring,
  sumOneTime,
} from '../common/billing/fees';

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
    private readonly receiptsService: ReceiptsService,
    private readonly tenantBalancesService: TenantBalancesService,
    private readonly propertyHistoryService: PropertyHistoryService,
  ) {}

  /**
   * Attach tenant from offer letter (for payment system)
   * This method is called when a tenant completes 100% payment on an offer letter
   * Requirements: US-6 (First Full Payment Wins)
   */
  async attachTenantFromOffer(
    manager: any,
    offerLetter: OfferLetter,
  ): Promise<void> {
    console.log('Attaching tenant from offer letter:', {
      offerLetterId: offerLetter.id,
      propertyId: offerLetter.property_id,
      kycApplicationId: offerLetter.kyc_application_id,
    });

    // Load the KYC application with relations
    const application = await manager.findOne(KYCApplication, {
      where: { id: offerLetter.kyc_application_id },
      relations: ['property'],
    });

    if (!application) {
      throw new NotFoundException(
        `KYC application ${offerLetter.kyc_application_id} not found`,
      );
    }

    console.log('Found KYC application:', {
      id: application.id,
      first_name: application.first_name,
      last_name: application.last_name,
      email: application.email,
      phone_number: application.phone_number,
    });

    // Create or get tenant account
    const tenantAccount = await this.createOrGetTenantAccount(
      application,
      manager,
    );

    console.log('Tenant account ready:', {
      accountId: tenantAccount.id,
      userId: tenantAccount.userId,
    });

    // Parse dates from offer letter
    const rentStartDate = new Date(offerLetter.tenancy_start_date);

    // Map rent frequency from offer letter format to RentFrequency enum
    const rentFrequency = this.mapOfferLetterFrequencyToRentFrequency(
      offerLetter.rent_frequency,
    );

    // Calculate next rent due date
    const nextRentDueDate = calculateRentExpiryDate(
      rentStartDate,
      rentFrequency,
    );

    console.log('Rent schedule calculated:', {
      startDate: rentStartDate.toISOString(),
      frequency: rentFrequency,
      nextDueDate: nextRentDueDate.toISOString(),
    });

    // Billing v2: snapshot the full fee breakdown from the offer letter so
    // every downstream money event (rent row, ledger, renewal) sees the same
    // per-fee recurring/one-time split the landlord configured at offer time.
    const fees = offerLetterToFees(offerLetter);
    const recurringFees = fees.filter((f) => f.recurring);
    const oneTimeFees = fees.filter((f) => !f.recurring);
    const recurringPeriodCharge = sumRecurring(fees);
    const oneTimeCharge = sumOneTime(fees);
    const totalCollected = recurringPeriodCharge + oneTimeCharge;

    // Create rent record — copy every fee + recurring flag + otherFees so
    // renewal cron and property-history can reconstruct the fee set later.
    const rent = manager.create(Rent, {
      tenant_id: tenantAccount.id,
      property_id: offerLetter.property_id,
      rent_start_date: rentStartDate,
      rental_price: Number(offerLetter.rent_amount),
      security_deposit: Number(offerLetter.caution_deposit || 0),
      security_deposit_recurring: !!offerLetter.caution_deposit_recurring,
      service_charge: Number(offerLetter.service_charge || 0),
      service_charge_recurring: offerLetter.service_charge_recurring !== false,
      legal_fee:
        offerLetter.legal_fee != null ? Number(offerLetter.legal_fee) : null,
      legal_fee_recurring: !!offerLetter.legal_fee_recurring,
      agency_fee:
        offerLetter.agency_fee != null ? Number(offerLetter.agency_fee) : null,
      agency_fee_recurring: !!offerLetter.agency_fee_recurring,
      other_fees: offerLetter.other_fees ?? [],
      payment_frequency: this.mapRentFrequencyToPaymentFrequency(rentFrequency),
      rent_status: RentStatusEnum.ACTIVE,
      payment_status: RentPaymentStatusEnum.PENDING,
      amount_paid: 0,
      expiry_date: nextRentDueDate,
    });

    await manager.save(rent);

    console.log('Rent record created:', {
      rentId: rent.id,
      rentalPrice: rent.rental_price,
      securityDeposit: rent.security_deposit,
      serviceCharge: rent.service_charge,
      recurringPeriodCharge,
      oneTimeCharge,
    });

    // Record each fee as a separate ledger entry so charges map 1:1 to fee fields.
    for (const fee of recurringFees) {
      await this.tenantBalancesService.applyChange(
        tenantAccount.id,
        offerLetter.landlord_id,
        -fee.amount,
        {
          type: TenantBalanceLedgerType.INITIAL_BALANCE,
          description: `Tenancy started — ${fee.label}`,
          propertyId: offerLetter.property_id,
          relatedEntityType: 'rent',
          relatedEntityId: rent.id,
          metadata: {
            fee_kind: fee.kind,
            ...(fee.externalId ? { externalId: fee.externalId } : {}),
          },
        },
        undefined,
        manager,
      );
    }

    // Record the one-time move-in fees (caution/legal/agency/one-time otherFees)
    // — previously these were collected by Paystack but left no audit trail.
    for (const fee of oneTimeFees) {
      await this.tenantBalancesService.applyChange(
        tenantAccount.id,
        offerLetter.landlord_id,
        -fee.amount,
        {
          type: TenantBalanceLedgerType.ONE_TIME_FEES,
          description: `Move-in fee — ${fee.label}`,
          propertyId: offerLetter.property_id,
          relatedEntityType: 'rent',
          relatedEntityId: rent.id,
          metadata: {
            fee_kind: fee.kind,
            ...(fee.externalId ? { externalId: fee.externalId } : {}),
          },
        },
        undefined,
        manager,
      );
    }

    // Record the Paystack payment — the offer letter was paid in full, so credit
    // the wallet for everything we just charged. Net effect on wallet balance: 0.
    if (totalCollected > 0) {
      await this.tenantBalancesService.applyChange(
        tenantAccount.id,
        offerLetter.landlord_id,
        totalCollected,
        {
          type: TenantBalanceLedgerType.OB_PAYMENT,
          description: 'Offer letter payment received',
          propertyId: offerLetter.property_id,
          relatedEntityType: 'rent',
          relatedEntityId: rent.id,
          metadata: {
            batch_id: 'billing-v2',
            recurring_portion: recurringPeriodCharge,
            one_time_portion: oneTimeCharge,
          },
        },
        undefined,
        manager,
      );
    }

    // Update rent record to reflect payment
    rent.amount_paid = Number(offerLetter.rent_amount);
    rent.payment_status = RentPaymentStatusEnum.PAID;
    await manager.save(rent);

    // Create or reactivate the property-tenant relationship. The end-tenancy
    // flow soft-deactivates (status = INACTIVE) instead of deleting, so reuse a
    // leftover INACTIVE row rather than inserting a duplicate (no unique
    // constraint on property_id + tenant_id).
    let propertyTenant = await manager.findOne(PropertyTenant, {
      where: {
        property_id: offerLetter.property_id,
        tenant_id: tenantAccount.id,
      },
    });

    if (propertyTenant) {
      propertyTenant.status = TenantStatusEnum.ACTIVE;
    } else {
      propertyTenant = manager.create(PropertyTenant, {
        property_id: offerLetter.property_id,
        tenant_id: tenantAccount.id,
        status: TenantStatusEnum.ACTIVE,
      });
    }

    await manager.save(propertyTenant);

    console.log('Property-tenant relationship created:', {
      propertyTenantId: propertyTenant.id,
    });

    // Create property history record
    const propertyHistory = manager.create(PropertyHistory, {
      property_id: offerLetter.property_id,
      tenant_id: tenantAccount.id,
      event_type: 'tenancy_started',
      move_in_date: DateService.getStartOfTheDay(rentStartDate),
      monthly_rent: Number(offerLetter.rent_amount),
      owner_comment: `Tenant attached via offer letter payment. Rent: ₦${Number(offerLetter.rent_amount).toLocaleString()}, Frequency: ${offerLetter.rent_frequency}, Next due: ${nextRentDueDate.toLocaleDateString()}`,
      tenant_comment: null,
      move_out_date: null,
      move_out_reason: null,
    });

    await manager.save(propertyHistory);

    console.log('Property history record created:', {
      propertyHistoryId: propertyHistory.id,
    });

    // Replay applicant-staged history (Add History entries the landlord
    // recorded against the applicant pre-attach). Runs INSIDE the existing
    // attach tx — a clash throw rolls the entire attach back. Must run
    // BEFORE the backfill block below, so the backfill's `tenant_id IS NULL`
    // clause naturally skips the rows replay just re-tagged.
    await this.propertyHistoryService.replayStagedApplicantHistory(
      application.id,
      tenantAccount.id,
      offerLetter.landlord_id,
      offerLetter.property_id,
      manager,
    );

    // Create property history event for KYC application approval
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

    const applicantName = `${application.first_name} ${application.last_name}`;
    const kycApprovalHistory = manager.create(PropertyHistory, {
      property_id: offerLetter.property_id,
      tenant_id: tenantAccount.id,
      event_type: 'kyc_application_approved',
      event_description: `KYC application approved for ${applicantName} — ${formattedDate} at ${formattedTime}`,
      related_entity_id: application.id,
      related_entity_type: 'kyc_application',
    });

    await manager.save(kycApprovalHistory);

    // Update application status to APPROVED and link to tenant
    await manager.update(KYCApplication, application.id, {
      status: ApplicationStatus.APPROVED,
      tenant_id: tenantAccount.id,
    });

    console.log('KYC application updated to APPROVED');

    // Backfill tenant_id on applicant-phase property history records
    // These events (KYC submitted, offer letter sent/accepted, invoice generated/sent, etc.)
    // were created before the tenant account existed, so they have tenant_id = NULL
    try {
      const backfillResult = await manager
        .createQueryBuilder()
        .update(PropertyHistory)
        .set({ tenant_id: tenantAccount.id })
        .where('property_id = :propertyId', {
          propertyId: offerLetter.property_id,
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

    // Reject all other pending applications for this property
    await this.rejectOtherApplications(
      offerLetter.property_id,
      application.id,
      manager,
    );

    console.log('Other applications rejected');

    console.log('Tenant attachment from offer letter completed successfully');
  }

  /**
   * Map offer letter rent frequency string to RentFrequency enum
   */
  private mapOfferLetterFrequencyToRentFrequency(
    frequency: string,
  ): RentFrequency {
    const normalized = frequency.toLowerCase().replace(/\s+/g, '-');
    switch (normalized) {
      case 'monthly':
        return RentFrequency.MONTHLY;
      case 'quarterly':
        return RentFrequency.QUARTERLY;
      case 'bi-annually':
      case 'bi-annual':
        return RentFrequency.BI_ANNUALLY;
      case 'annually':
      case 'annual':
        return RentFrequency.ANNUALLY;
      default:
        console.warn(
          `Unknown rent frequency: ${frequency}, defaulting to MONTHLY`,
        );
        return RentFrequency.MONTHLY;
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
    // Delegates to the shared helper so every attachment path rejects
    // competitors with identical semantics (see reject-other-applications.ts).
    await rejectOtherPendingApplications(
      manager,
      propertyId,
      excludeApplicationId,
    );
  }


  /**
   * Create or get tenant account from KYC application data
   * FIXED: Always update existing accounts with latest KYC data
   * FIXED: Normalize phone number before searching to match database format
   * Requirements: 5.1, 5.2
   */
  private async createOrGetTenantAccount(
    application: KYCApplication,
    manager: any,
  ): Promise<Account> {
    let tenantAccount: Account | null = null;
    let existingUser: Users | null = null;

    // Normalize phone number to match database format (e.g., 07062639647 -> 2347062639647)
    const normalizedPhone = application.phone_number
      ? this.utilService.normalizePhoneNumber(application.phone_number)
      : null;

    console.log('Searching for existing user with:', {
      email: application.email,
      originalPhone: application.phone_number,
      normalizedPhone: normalizedPhone,
    });

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
    if (!tenantAccount && normalizedPhone) {
      existingUser = await manager.findOne(Users, {
        where: { phone_number: normalizedPhone },
      });

      if (existingUser) {
        console.log(
          `Found existing user by phone: ${normalizedPhone} (original: ${application.phone_number})`,
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
            roles: [RolesEnum.TENANT],
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
      let emailToUse = existingUser.email; // Default to existing email

      if (application.email && application.email.trim() !== '') {
        // Only update email if it's different and not already taken by another user
        if (application.email !== existingUser.email) {
          const emailConflict = await manager.findOne(Users, {
            where: { email: application.email },
          });

          if (!emailConflict) {
            emailToUse = application.email;
          } else if (emailConflict.id !== existingUser.id) {
            console.warn(
              `Cannot update email to ${application.email} - already taken by user ${emailConflict.id}. Keeping existing email ${existingUser.email}`,
            );
          }
        }
      }

      // Update Users table with latest KYC data
      await manager.update(Users, existingUser.id, {
        first_name: application.first_name,
        last_name: application.last_name,
        email: emailToUse,
        phone_number: normalizedPhone || application.phone_number,
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
        phone_number: normalizedPhone || application.phone_number,
        originalPhone: application.phone_number,
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
        : `tenant_${normalizedPhone || application.phone_number}@placeholder.lizt.app`;

    const newUser = manager.create(Users, {
      first_name: application.first_name,
      last_name: application.last_name,
      email: emailToUse,
      phone_number: normalizedPhone || application.phone_number,
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
      phone_number: normalizedPhone || application.phone_number,
      originalPhone: application.phone_number,
      isPlaceholderEmail: !application.email || application.email.trim() === '',
    });

    const savedUser = await manager.save(newUser);
    console.log('User created successfully:', savedUser.id);

    tenantAccount = manager.create(Account, {
      email: emailToUse,
      userId: savedUser.id,
      roles: [RolesEnum.TENANT],
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

    // Use the application email if it looks like one; otherwise fall back to
    // a phone-based placeholder so downstream @IsEmail checks (e.g. Paystack
    // payment init) don't reject the row. Mirrors the placeholder format used
    // when creating a new Users row above.
    const emailToUse =
      application.email &&
      application.email.trim() !== '' &&
      application.email.includes('@')
        ? application.email
        : `tenant_${application.phone_number}@placeholder.lizt.app`;

    // Prepare all KYC data from application - matching current KYC form fields
    const tenantKycData = {
      // Personal Information
      first_name: application.first_name,
      last_name: application.last_name,
      email: emailToUse,
      phone_number: application.phone_number,
      date_of_birth: application.date_of_birth || new Date('1990-01-01'),
      gender: application.gender || 'other',
      nationality: application.nationality || 'Nigerian',
      state_of_origin: application.state_of_origin || '',
      marital_status: application.marital_status || 'single',
      religion: application.religion || '',
      current_residence: application.contact_address || '',
      spouse_name_and_contact: '', // Not collected in current form

      // Employment Information
      employment_status: application.employment_status || 'employed',
      occupation:
        application.occupation || application.nature_of_business || '',
      job_title: application.job_title || '',
      employer_name:
        application.employer_name || application.business_name || '',
      work_address:
        application.work_address || application.business_address || '',
      work_phone_number: application.work_phone_number || '',
      monthly_net_income: application.monthly_net_income || '0',

      // Next of Kin
      next_of_kin_full_name: application.next_of_kin_full_name || '',
      next_of_kin_address: application.next_of_kin_address || '',
      next_of_kin_relationship: application.next_of_kin_relationship || '',
      next_of_kin_phone_number: application.next_of_kin_phone_number || '',
      next_of_kin_email: application.next_of_kin_email || '',

      // Referral Agent
      referral_agent_full_name: application.referral_agent_full_name || '',
      referral_agent_phone_number:
        application.referral_agent_phone_number || '',

      // Contact address (required column)
      contact_address: application.contact_address || '',
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

      const tenantKyc = manager.create(TenantKyc, {
        ...tenantKycData,
        user_id: userId,
        admin_id: application.property.owner_id,
      });

      await manager.save(tenantKyc);
    }
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
      case RentFrequency.CUSTOM:
        return 'Custom';
      default:
        return 'Monthly';
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
                move_in_date: oldRent.rent_start_date,
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

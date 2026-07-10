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
import {
  ArrayContains,
  DataSource,
  EntityManager,
  In,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { rentToFees } from 'src/common/billing/fees';

import { Users } from '../entities/user.entity';
import { Account } from '../entities/account.entity';
import { Rent } from 'src/rents/entities/rent.entity';
import { Property } from 'src/properties/entities/property.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { buildTimelineEvents } from 'src/property-history/property-history-timeline.builder';
import { PropertyHistoryService } from 'src/property-history/property-history.service';
import { PROPERTY_LEVEL_EVENT_TYPES } from 'src/property-history/property-history.constants';
import {
  KYCApplication,
  ApplicationStatus,
} from 'src/kyc-links/entities/kyc-application.entity';
import { transformApplicationForFrontend } from 'src/kyc-links/kyc-application.transform';
import { rejectOtherPendingApplications } from 'src/kyc-links/reject-other-applications';
import {
  TenantKyc,
  Gender,
  MaritalStatus,
  EmploymentStatus,
} from 'src/tenant-kyc/entities/tenant-kyc.entity';
import {
  OfferLetter,
  OfferLetterStatus,
} from 'src/offer-letters/entities/offer-letter.entity';
import { Payment, PaymentStatus } from 'src/payments/entities/payment.entity';
import { TenantDetailDto } from '../dto/tenant-detail.dto';
import {
  RenewalInvoice,
  RenewalLetterStatus,
  RenewalPaymentStatus,
} from 'src/tenancies/entities/renewal-invoice.entity';
import {
  TenancyInvoiceRow,
  TenancyInvoicesResponse,
  TenancyPaymentPlan,
} from '../dto/tenancy-invoices.dto';

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
import { isPlaceholderEmail } from 'src/utils/placeholder-email';
import { AccountCacheService } from 'src/auth/account-cache.service';
import { WhatsappBotService } from 'src/whatsapp-bot/whatsapp-bot.service';
import { config } from 'src/config';
import { buildUserFilter, buildUserFilterQB } from 'src/filters/query-filter';
import { AttachResult } from 'src/common/interfaces';
import { TenantBalancesService } from 'src/tenant-balances/tenant-balances.service';
import { ManagementScopeService } from 'src/common/scope/management-scope.service';
import { AttachTenantFromKycDto } from '../dto/attach-tenant-from-kyc.dto';
import {
  TenantBalanceLedger,
  TenantBalanceLedgerType,
} from 'src/tenant-balances/entities/tenant-balance-ledger.entity';
import { TenantBalance } from 'src/tenant-balances/entities/tenant-balance.entity';
import { AdHocInvoiceLineItem } from 'src/ad-hoc-invoices/entities/ad-hoc-invoice-line-item.entity';
import {
  AdHocInvoice,
  AdHocInvoiceStatus,
} from 'src/ad-hoc-invoices/entities/ad-hoc-invoice.entity';
import { Invoice, InvoiceStatus } from 'src/invoices/entities/invoice.entity';
import {
  PaymentPlan,
  PaymentPlanScope,
  PaymentPlanStatus,
} from 'src/payment-plans/entities/payment-plan.entity';
import { sumOverdueInvoiceFeeInstallments } from 'src/common/billing/plan-classification';
import { PaymentPlanRequest } from 'src/payment-plans/entities/payment-plan-request.entity';

// ── Managed tenancies (admin Tenancies screen) ─────────────────────────────
export type ManagedTenancySortColumn =
  | 'tenant'
  | 'property'
  | 'rent'
  | 'outstanding'
  | 'endDate'
  | 'daysLeft';

export interface ManagedTenancyRow {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantPhone: string | null;
  propertyId: string;
  propertyName: string;
  propertyAddress: string;
  landlordId: string;
  landlordName: string;
  rentAmount: number | null;
  paymentFrequency: string | null;
  startDate: Date | null;
  endDate: Date | null;
  outstandingBalance: number;
  creditBalance: number;
}

export interface ManagedTenanciesPage {
  tenancies: ManagedTenancyRow[];
  pagination: {
    totalRows: number;
    perPage: number;
    currentPage: number;
    totalPages: number;
    hasNextPage: boolean;
  };
}

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
 * A positive ad-hoc-invoice wallet ledger leg is a REVERSAL (cancellation or
 * edit-down) — not a tenant payment — when it is tagged `metadata.reversal`,
 * OR, for historical rows written before that tag existed, when its description
 * matches the reversal wording. Reversals net against their charge in the
 * balance breakdown and must NOT appear as money received; genuine ad-hoc
 * payments (untagged, non-matching description) surface as payment rows.
 *
 * Exported for unit testing. Kept deliberately specific so a genuine payment
 * description ("Payment received", "Manual payment of …") never matches.
 */
export function isAdHocReversalLeg(e: {
  metadata?: unknown;
  description?: string | null;
}): boolean {
  if ((e.metadata as { reversal?: boolean } | null)?.reversal === true) {
    return true;
  }
  const desc = typeof e.description === 'string' ? e.description : '';
  return /cancelled.*revers/i.test(desc) || /edited.*reduc/i.test(desc);
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
    @InjectRepository(AdHocInvoiceLineItem)
    private readonly adHocInvoiceLineItemRepository: Repository<AdHocInvoiceLineItem>,
    private readonly dataSource: DataSource,
    private readonly utilService: UtilService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => WhatsappBotService))
    private readonly whatsappBotService: WhatsappBotService,
    private readonly tenantBalancesService: TenantBalancesService,
    private readonly propertyHistoryService: PropertyHistoryService,
    private readonly accountCacheService: AccountCacheService,
    private readonly scopeService: ManagementScopeService,
  ) {}

  /**
   * Resolve the Users row for an incoming tenant identity — by phone first,
   * then by real email — creating it only when the person is genuinely new.
   * One person = one Users row, even when they hold several roles; the
   * `users` table has hard unique indexes on both phone_number and email, so
   * blindly inserting for a known phone/email would crash.
   */
  private async resolveTenantUser(
    manager: EntityManager,
    params: {
      phone: string; // already normalized
      email?: string | null;
      createFields: Partial<Users>; // used only when creating a new row
    },
  ): Promise<Users> {
    const email = params.email?.trim().toLowerCase() || null;

    let user = await manager.getRepository(Users).findOne({
      where: { phone_number: params.phone },
    });

    if (!user && email && !isPlaceholderEmail(email)) {
      user = await manager.getRepository(Users).findOne({ where: { email } });
      // Same real email already bound to a different phone → two different
      // people (or stale data) — refuse rather than silently hijack the row.
      if (user && user.phone_number && user.phone_number !== params.phone) {
        throw new ConflictException(
          `Email ${email} is already linked to a different phone number.`,
        );
      }
    }

    if (!user) {
      user = await manager.getRepository(Users).save({
        ...params.createFields,
        phone_number: params.phone,
        email: email ?? params.createFields.email,
        is_verified: true,
      });
    }

    return user;
  }

  /**
   * Find-or-append pattern for the TENANT role: a person who already exists
   * as landlord/FM/etc. keeps their single Account and gains the TENANT role
   * instead of the write failing on the unique email index. Mirrors the
   * reconciliation in createLandlord / assignCollaboratorToTeam /
   * createManagedLandlord.
   *
   * Never touches the password of an existing account — their current
   * credentials keep working for every role; multi-role login shows the
   * role picker.
   */
  private async resolveTenantAccount(
    manager: EntityManager,
    user: Users,
    opts: {
      email?: string | null;
      creatorId?: string;
      /** used only when creating a brand-new account */
      passwordHash?: string;
      profileName?: string;
    },
  ): Promise<Account> {
    const accountRepo = manager.getRepository(Account);
    const email = opts.email?.trim().toLowerCase() || null;
    const incomingIsPlaceholder = !email || isPlaceholderEmail(email);

    // 1. Prefer an account of this user that already carries TENANT.
    let account = await accountRepo.findOne({
      where: { userId: user.id, roles: ArrayContains([RolesEnum.TENANT]) },
    });

    // 2. Else any account holding this real email (landlord/FM/admin/etc.).
    if (!account && email && !incomingIsPlaceholder) {
      account = await accountRepo.findOne({ where: { email } });
      if (account && account.userId && account.userId !== user.id) {
        // Real email already on an account anchored to a different person.
        throw new ConflictException(
          `Email ${email} is already linked to a different account.`,
        );
      }
    }

    // 3. Else any account already linked to this user row.
    if (!account) {
      account = await accountRepo.findOne({ where: { userId: user.id } });
    }

    if (account) {
      // Email reconciliation (same rules as team.service):
      //   placeholder → real: upgrade; real vs different real: conflict.
      if (email && account.email !== email) {
        const existingIsPlaceholder = isPlaceholderEmail(account.email);
        if (existingIsPlaceholder && !incomingIsPlaceholder) {
          account.email = email;
        } else if (!existingIsPlaceholder && !incomingIsPlaceholder) {
          throw new ConflictException(
            `Phone ${user.phone_number} is already linked to an account with a different email (${account.email}).`,
          );
        }
      }

      if (!account.userId) account.user = user;
      if (!account.roles?.includes(RolesEnum.TENANT)) {
        account.roles = [...(account.roles ?? []), RolesEnum.TENANT];
      }
      account.creator_id = account.creator_id ?? opts.creatorId;
      account.is_verified = true;
      account = await accountRepo.save(account);
      // JwtAuthGuard hydrates req.user from a cached Account — a stale entry
      // would keep denying the new role until TTL.
      await this.accountCacheService.invalidate(account.id);
      return account;
    }

    // Prefer a real email over an incoming synthetic one; the placeholder is
    // only a last resort so the NOT NULL column is satisfied.
    const accountEmail =
      (!incomingIsPlaceholder && email) || user.email || email;
    if (!accountEmail) {
      throw new HttpException(
        'Email is required to create tenant account',
        HttpStatus.BAD_REQUEST,
      );
    }

    return await accountRepo.save(
      accountRepo.create({
        user,
        email: accountEmail,
        password: opts.passwordHash,
        is_verified: true,
        profile_name:
          opts.profileName ??
          `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim(),
        roles: [RolesEnum.TENANT],
        creator_id: opts.creatorId,
      }),
    );
  }

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
        roles: ArrayContains([RolesEnum.LANDLORD]),
      },
      relations: ['user'],
    })) as Account & { user: Users };

    if (!admin) {
      throw new HttpException('admin account not found', HttpStatus.NOT_FOUND);
    }

    return await this.dataSource.transaction(async (manager) => {
      try {
        const property = await manager.getRepository(Property).findOne({
          where: { id: property_id },
        });

        if (!property) {
          throw new HttpException('Property not found', HttpStatus.NOT_FOUND);
        }

        // The caller must own or manage the property. The wallet ledger is
        // keyed on the property's OWNER (landlord views group balances by
        // property.owner_id), so charge to the owner — not the caller — or
        // the opening balance lands in a scope no view ever reads.
        if (
          property.owner_id !== user_id &&
          !(await this.scopeService.managesLandlord(user_id, property.owner_id))
        ) {
          throw new ForbiddenException(
            'You are not authorized to add tenants to this property',
          );
        }
        const ledgerLandlordId = property.owner_id;

        // Tenant-facing messages must show the PROPERTY OWNER's name (e.g.
        // "Panda Homes"), not the caller's — a managing admin is branded
        // "Property Kraft" and must never leak into the tenant's welcome.
        const ownerAccount =
          ledgerLandlordId === user_id
            ? admin
            : await manager.getRepository(Account).findOne({
                where: { id: ledgerLandlordId },
                relations: ['user'],
              });
        const ownerDisplayName =
          ownerAccount?.profile_name ||
          this.utilService.formatPersonName(
            ownerAccount?.user?.first_name,
            ownerAccount?.user?.last_name,
          ) ||
          'Your landlord';

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
        const normalizedPhone =
          this.utilService.normalizePhoneNumber(phone_number);

        // 1-2. Find-or-create the person. An existing landlord/FM/tenant with
        // this phone or email is reused — the TENANT role is appended to
        // their account instead of failing on the unique indexes.
        const tenantUser = await this.resolveTenantUser(manager, {
          phone: normalizedPhone,
          email,
          createFields: {
            first_name: this.utilService.toSentenceCase(first_name),
            last_name: this.utilService.toSentenceCase(last_name),
          },
        });

        // 3. Find-or-create the account; password is only set for brand-new
        // accounts (existing credentials keep working for all roles).
        const { hash: generatedPasswordHash } =
          await this.utilService.generatePassword();

        const userAccount = await this.resolveTenantAccount(
          manager,
          tenantUser,
          {
            email,
            creatorId: user_id,
            passwordHash: generatedPasswordHash,
            profileName: `${tenantUser.first_name} ${tenantUser.last_name}`,
          },
        );

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
              ledgerLandlordId,
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
          tenant_name: this.utilService.formatPersonName(first_name, last_name),
          landlord_name: ownerDisplayName,
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
            name:
              admin.profile_name ||
              this.utilService.formatPersonName(
                admin.user?.first_name,
                admin.user?.last_name,
              ) ||
              'Admin',
            user: this.utilService.formatPersonName(
              tenantUser.first_name,
              tenantUser.last_name,
            ),
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
        // 1. Verify tenant exists. Resolve to the TENANT-role account if a
        // different role was supplied — common when the same human is both
        // a tenant and a team_member / facility_manager under the same
        // landlord, and the picker on the frontend hands over the wrong
        // account id. Without this guard, property_tenants/rents would
        // anchor on a non-tenant account and the WhatsApp tenant menu +
        // wallet lookups (both keyed on tenant-role accounts) would skip
        // the attachment entirely.
        const suppliedAccount = await manager.getRepository(Account).findOne({
          where: { id: tenantId },
          relations: ['user'],
        });

        if (!suppliedAccount) {
          throw new NotFoundException('Tenant not found');
        }

        let tenantAccount = suppliedAccount;
        if (!suppliedAccount.roles?.includes(RolesEnum.TENANT)) {
          if (!suppliedAccount.user) {
            // Defensive: a role-mismatched account without a loaded user
            // can't be promoted. Fail loudly rather than silently writing
            // the wrong tenant_id.
            throw new HttpException(
              'Supplied account is not a tenant and has no associated user to resolve from.',
              HttpStatus.BAD_REQUEST,
            );
          }
          const tenantRoleAccount = await manager
            .getRepository(Account)
            .findOne({
              where: {
                userId: suppliedAccount.user.id,
                roles: ArrayContains([RolesEnum.TENANT]),
              },
              relations: ['user'],
            });
          if (!tenantRoleAccount) {
            throw new HttpException(
              `The supplied account roles [${suppliedAccount.roles?.join(',')}] do not include tenant, and the user has no tenant-role account. Create the tenant first before attaching them to a property.`,
              HttpStatus.BAD_REQUEST,
            );
          }
          this.logger.warn(
            `[attachTenantToProperty] Promoted supplied account ${suppliedAccount.id} (roles=[${suppliedAccount.roles?.join(',')}]) → tenant account ${tenantRoleAccount.id} (userId ${suppliedAccount.user.id})`,
          );
          tenantAccount = tenantRoleAccount;
        }
        // Mutate the param so every downstream write (rent, property_tenant,
        // ledger, property_history, livefeed event) anchors on the tenant
        // account — never the supplied non-tenant id.
        tenantId = tenantAccount.id;

        // 2. Verify property exists and belongs to this landlord
        const property = await manager.getRepository(Property).findOne({
          where: { id: propertyId },
        });

        if (!property) {
          throw new NotFoundException('Property not found');
        }

        if (
          property.owner_id !== landlordId &&
          !(await this.scopeService.managesLandlord(
            landlordId,
            property.owner_id,
          ))
        ) {
          throw new ForbiddenException(
            'You are not authorized to attach tenants to this property',
          );
        }
        // The requester may be a managing admin acting for the landlord.
        // Re-anchor on the property's owner so every downstream write keyed on
        // landlordId (the tenant-wallet ledger counterparty, the landlord
        // account resolved for the tenant's WhatsApp) stays on the LANDLORD —
        // mirrors the tenantId re-anchor above.
        landlordId = property.owner_id;

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

        // 9b. Direct attach (no KYC application) — the property is now taken,
        // so reject any competing PENDING applications for it.
        await rejectOtherPendingApplications(manager, propertyId);

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

          const tenantName = this.utilService.formatPersonName(
            tenantAccount.user.first_name,
            tenantAccount.user.last_name,
          );

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
          const fallbackTenantName = this.utilService.formatPersonName(
            tenantAccount.user.first_name,
            tenantAccount.user.last_name,
          );
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
      case RentFrequency.CUSTOM:
        return 'Custom';
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
        roles: ArrayContains([RolesEnum.LANDLORD]),
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
        const property = await manager.getRepository(Property).findOne({
          where: { id: property_id },
        });

        if (!property) {
          throw new HttpException('Property not found', HttpStatus.NOT_FOUND);
        }

        // The caller must own or manage the property. Charge the opening
        // balance to the property's OWNER — landlord views group balances by
        // property.owner_id, so a charge keyed to the caller is invisible.
        if (
          property.owner_id !== user_id &&
          !(await this.scopeService.managesLandlord(user_id, property.owner_id))
        ) {
          throw new ForbiddenException(
            'You are not authorized to add tenants to this property',
          );
        }
        const ledgerLandlordId = property.owner_id;

        // Tenant-facing messages must show the PROPERTY OWNER's name (e.g.
        // "Panda Homes"), not the caller's — a managing admin is branded
        // "Property Kraft" and must never leak into the tenant's welcome.
        const ownerAccount =
          ledgerLandlordId === user_id
            ? admin
            : await manager.getRepository(Account).findOne({
                where: { id: ledgerLandlordId },
                relations: ['user'],
              });
        const ownerDisplayName =
          ownerAccount?.profile_name ||
          this.utilService.formatPersonName(
            ownerAccount?.user?.first_name,
            ownerAccount?.user?.last_name,
          ) ||
          'Your landlord';

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

        // 1-2. Find-or-create the person. An existing landlord/FM/tenant with
        // this phone or email is reused — the TENANT role is appended to
        // their account instead of failing on the unique indexes.
        const tenantUser = await this.resolveTenantUser(manager, {
          phone: this.utilService.normalizePhoneNumber(phone_number),
          email,
          createFields: {
            first_name: this.utilService.toSentenceCase(first_name),
            last_name: this.utilService.toSentenceCase(last_name),
            date_of_birth,
            gender,
            state_of_origin,
            lga,
            nationality,
            employment_status,
            marital_status,
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
          },
        });

        // 3. Find-or-create the account; password is only set for brand-new
        // accounts (existing credentials keep working for all roles).
        const { hash: generatedPasswordHash } =
          await this.utilService.generatePassword();

        const userAccount = await this.resolveTenantAccount(
          manager,
          tenantUser,
          {
            email,
            creatorId: user_id,
            passwordHash: generatedPasswordHash,
            profileName: `${tenantUser.first_name} ${tenantUser.last_name}`,
          },
        );

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
            ledgerLandlordId,
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
            ledgerLandlordId,
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
          this.utilService.formatPersonName(
            tenantUser.first_name,
            tenantUser.last_name,
          ),
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
          tenant_name: this.utilService.formatPersonName(first_name, last_name),
          landlord_name: ownerDisplayName,
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
            name:
              admin.profile_name ||
              this.utilService.formatPersonName(
                admin.user?.first_name,
                admin.user?.last_name,
              ) ||
              'Admin',
            user: this.utilService.formatPersonName(
              tenantUser.first_name,
              tenantUser.last_name,
            ),
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
    const result = await this.handleTenantFromKyc(
      landlordId,
      tenantKycDto,
      kycApplication,
    );

    // 4. Update KYC application status to approved and set tenant_id
    await this.kycApplicationRepository.update(dto.kycApplicationId, {
      status: ApplicationStatus.APPROVED,
      tenant_id: result.tenantAccount.id,
    });

    // 5. Backfill tenant_id on applicant-phase property history records.
    // These events were created before the tenant account existed, so they
    // have tenant_id = NULL. Two scopes, claimed separately:
    //   1. THIS application's journey rows (form viewed, submitted, staged
    //      entries replay left untouched) — matched by application id, across
    //      any property, because an applicant can be attached to a different
    //      property than the one they applied for.
    //   2. Tenant-relevant pre-attach rows on the attach property (offer
    //      letter, invoice, payment events) that carry no application id.
    // Never claimed: other applications' rows (they belong to applicants who
    // may be attached later — stealing them starves their replay), anonymous
    // kyc_link form views (not attributable to one applicant), and
    // property-level events (property/marketing changes are not tenant
    // events).
    try {
      const propertyHistoryRepo =
        this.dataSource.getRepository(PropertyHistory);
      const journeyResult = await propertyHistoryRepo
        .createQueryBuilder()
        .update(PropertyHistory)
        .set({ tenant_id: result.tenantAccount.id })
        .where("related_entity_type = 'kyc_application'")
        .andWhere('related_entity_id = :applicationId', {
          applicationId: dto.kycApplicationId,
        })
        .andWhere('tenant_id IS NULL')
        .execute();

      const propertyResult = await propertyHistoryRepo
        .createQueryBuilder()
        .update(PropertyHistory)
        .set({ tenant_id: result.tenantAccount.id })
        .where('property_id = :propertyId', {
          propertyId: dto.propertyId,
        })
        .andWhere('tenant_id IS NULL')
        .andWhere(
          "(related_entity_type IS NULL OR related_entity_type NOT IN ('kyc_application', 'kyc_link'))",
        )
        .andWhere('event_type NOT IN (:...propertyLevelEvents)', {
          propertyLevelEvents: PROPERTY_LEVEL_EVENT_TYPES,
        })
        .execute();

      console.log(
        `Backfilled tenant_id on ${journeyResult.affected} application journey rows and ${propertyResult.affected} pre-attach property rows`,
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
    kycApplication: KYCApplication,
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

      // Storage is canonical: every write goes through normalizePhoneNumber and
      // the users_phone_number_canonical CHECK guarantees the digits-only E.164
      // form (NG -> 234...), so a single canonical lookup matches any country.
      // (The old multi-format fan-out only existed to catch legacy NG rows that
      // pre-dated the constraint; with country-aware normalization it would also
      // degenerate for foreign numbers.)
      const phoneVariations = [normalizedPhone];

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

            // Re-query the canonical form that would have been saved.
            const phoneVariants = [normalizedPhone];

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

      // 3b. The requester may be a managing admin acting for the landlord.
      // Verify they own or manage the property, then re-anchor on the
      // property's owner so every downstream write keyed on landlordId
      // (tenant_kyc snapshot, wallet ledger, staged-history replay) lands
      // under the LANDLORD — mirrors attachTenantToProperty. Without this,
      // an admin-performed attach files the opening charge under the admin
      // account, a scope no landlord view ever reads, so the tenant shows
      // ₦0 outstanding.
      if (
        property.owner_id !== landlordId &&
        !(await this.scopeService.managesLandlord(
          landlordId,
          property.owner_id,
        ))
      ) {
        throw new ForbiddenException(
          'You are not authorized to attach tenants to this property',
        );
      }
      landlordId = property.owner_id;

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

      // 5. Find-or-create the tenant account. If this person already has an
      // account under another role (landlord/FM/...), TENANT is appended to
      // it instead of inserting a second account that would collide with the
      // unique email index.
      const tenantAccount = await this.resolveTenantAccount(
        manager,
        tenantUser,
        {
          email: email || tenantUser.email,
          creatorId: landlordId,
        },
      );

      // 5b. Upsert per-landlord tenant_kyc snapshot from the application data.
      // Keyed by (admin_id, phone_number) — the table's unique index — so
      // re-runs and Path-C placeholder rows on the same phone are overwritten
      // atomically rather than colliding. Done inside the transaction so the
      // attach is all-or-nothing.
      //
      // Why every column is in the orUpdate list: we want the latest KYC
      // submission to be authoritative. A Path-C placeholder may have '-'
      // stubs everywhere, and a prior Path-A/B attach may have stale fields
      // from an earlier submission — both should be replaced wholesale.
      await manager
        .createQueryBuilder()
        .insert()
        .into(TenantKyc)
        .values({
          user_id: tenantUser.id,
          admin_id: landlordId,
          phone_number: normalizedPhone,
          first_name: kycApplication.first_name ?? first_name,
          last_name: kycApplication.last_name ?? last_name,
          email:
            kycApplication.email &&
            kycApplication.email.trim() !== '' &&
            kycApplication.email.includes('@')
              ? kycApplication.email
              : `tenant_${normalizedPhone}@placeholder.lizt.app`,
          date_of_birth: kycApplication.date_of_birth ?? new Date('1900-01-01'),
          gender: (kycApplication.gender as Gender) ?? Gender.MALE,
          nationality: kycApplication.nationality ?? '-',
          state_of_origin: kycApplication.state_of_origin ?? '-',
          marital_status:
            (kycApplication.marital_status as MaritalStatus) ??
            MaritalStatus.SINGLE,
          religion: kycApplication.religion ?? '-',
          current_residence: kycApplication.contact_address ?? '-',
          contact_address: kycApplication.contact_address ?? '-',
          employment_status:
            (kycApplication.employment_status as EmploymentStatus) ??
            EmploymentStatus.EMPLOYED,
          occupation:
            kycApplication.occupation ??
            kycApplication.nature_of_business ??
            '-',
          job_title: kycApplication.job_title ?? undefined,
          employer_name:
            kycApplication.employer_name ??
            kycApplication.business_name ??
            undefined,
          work_address:
            kycApplication.work_address ??
            kycApplication.business_address ??
            undefined,
          work_phone_number: kycApplication.work_phone_number ?? undefined,
          length_of_employment:
            kycApplication.length_of_employment ?? undefined,
          monthly_net_income: kycApplication.monthly_net_income ?? '0',
          nature_of_business: kycApplication.nature_of_business ?? undefined,
          business_name: kycApplication.business_name ?? undefined,
          business_address: kycApplication.business_address ?? undefined,
          business_duration: kycApplication.business_duration ?? undefined,
          next_of_kin_full_name: kycApplication.next_of_kin_full_name ?? '-',
          next_of_kin_address: kycApplication.next_of_kin_address ?? '-',
          next_of_kin_relationship:
            kycApplication.next_of_kin_relationship ?? '-',
          next_of_kin_phone_number:
            kycApplication.next_of_kin_phone_number ?? '-',
          next_of_kin_email: kycApplication.next_of_kin_email ?? '-',
          referral_agent_full_name:
            kycApplication.referral_agent_full_name ?? undefined,
          referral_agent_phone_number:
            kycApplication.referral_agent_phone_number ?? undefined,
        })
        .orUpdate(
          [
            'user_id',
            'first_name',
            'last_name',
            'email',
            'date_of_birth',
            'gender',
            'nationality',
            'state_of_origin',
            'marital_status',
            'religion',
            'current_residence',
            'contact_address',
            'employment_status',
            'occupation',
            'job_title',
            'employer_name',
            'work_address',
            'work_phone_number',
            'length_of_employment',
            'monthly_net_income',
            'nature_of_business',
            'business_name',
            'business_address',
            'business_duration',
            'next_of_kin_full_name',
            'next_of_kin_address',
            'next_of_kin_relationship',
            'next_of_kin_phone_number',
            'next_of_kin_email',
            'referral_agent_full_name',
            'referral_agent_phone_number',
          ],
          ['admin_id', 'phone_number'],
        )
        .execute();

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

      // Direct-attach has no Paystack leg — the landlord is recording existing
      // state, not collecting payment. Record each charge as its own ledger
      // entry so the balance breakdown shows itemised line items.
      for (const fee of fees) {
        if (fee.amount <= 0) continue;
        await this.tenantBalancesService.applyChange(
          tenantAccount.id,
          landlordId,
          -fee.amount,
          {
            type: fee.recurring
              ? TenantBalanceLedgerType.INITIAL_BALANCE
              : TenantBalanceLedgerType.ONE_TIME_FEES,
            description: fee.label,
            propertyId: property_id,
            relatedEntityType: 'rent',
            relatedEntityId: rent.id,
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

      // 8b. Reject competing PENDING applications for this now-taken property,
      // sparing the one being approved. The caller marks THIS application
      // APPROVED after the tx, so it is still PENDING here — exclude it by id.
      await rejectOtherPendingApplications(
        manager,
        property_id,
        kycApplication?.id,
      );

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

      // 9b. Replay applicant-staged history (Add History entries the
      // landlord recorded against the KYC applicant pre-attach). Must run
      // INSIDE the tx — a clash throw rolls back the entire attach.
      await this.propertyHistoryService.replayStagedApplicantHistory(
        kycApplication.id,
        tenantAccount.id,
        landlordId,
        property_id,
        manager,
      );

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

        const tenantName = this.utilService.formatPersonName(
          tenantUser.first_name,
          tenantUser.last_name,
        );

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
        const fallbackTenantName = this.utilService.formatPersonName(
          tenantUser.first_name,
          tenantUser.last_name,
        );
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

    const qb = this.usersRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.property_tenants', 'property_tenants')
      .leftJoinAndSelect('property_tenants.property', 'property')
      .leftJoinAndSelect('user.rents', 'rents')
      // Filter to users who hold a TENANT role on any of their accounts.
      .where(
        'EXISTS (SELECT 1 FROM accounts a WHERE a."userId" = user.id AND :tenantRole = ANY(a.roles))',
        { tenantRole: RolesEnum.TENANT },
      );

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
  async getManagedTenants(
    landlordIds: string[],
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

    // Admin/PM scope: tenants created by any of the managed landlords.
    if (!landlordIds.length) {
      return {
        users: [],
        pagination: {
          totalRows: 0,
          perPage: size,
          currentPage: page,
          totalPages: 0,
          hasNextPage: false,
        },
      };
    }

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
      .where('accounts.creator_id IN (:...landlordIds)', { landlordIds });

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
   * Flat list of ACTIVE tenancies across the managed landlords — one row per
   * active property_tenant link that also has an ACTIVE rent (the rent holds
   * the tenancy terms; a link without one is not an ongoing tenancy), with
   * the landlord's display name and the outstanding balance a landlord view
   * would show: wallet OB for the tenant-landlord pair plus the
   * property's overdue carved invoice-fee plan installments (the headline
   * figure computeTenantBalance derives; display-only, nothing is written).
   *
   * The wallet is one signed ledger per tenant-landlord pair, so if a tenant
   * holds several properties under the SAME landlord the pair's wallet OB
   * repeats on each of those rows — same compromise the per-tenant screens
   * make; there is no per-property attribution of wallet debt.
   */
  async getManagedTenancies(
    landlordIds: string[],
    opts: {
      page?: number;
      size?: number;
      sortCol?: ManagedTenancySortColumn;
      sortDir?: 'asc' | 'desc';
    } = {},
  ): Promise<ManagedTenanciesPage> {
    const page = Math.max(1, opts.page ?? 1);
    const size = Math.max(1, opts.size ?? 10);
    // Default order mirrors the Tenancies screen: soonest expiry first.
    const sortCol: ManagedTenancySortColumn = opts.sortCol ?? 'daysLeft';
    const sortDir: 'asc' | 'desc' = opts.sortDir ?? 'asc';

    const emptyPage: ManagedTenanciesPage = {
      tenancies: [],
      pagination: {
        totalRows: 0,
        perPage: size,
        currentPage: page,
        totalPages: 0,
        hasNextPage: false,
      },
    };
    if (!landlordIds.length) return emptyPage;

    const links = await this.propertyTenantRepository
      .createQueryBuilder('pt')
      .innerJoin('pt.property', 'property')
      .addSelect([
        'property.id',
        'property.name',
        'property.location',
        'property.owner_id',
      ])
      .innerJoin('pt.tenant', 'tenant')
      .addSelect(['tenant.id', 'tenant.profile_name'])
      .leftJoin('tenant.user', 'tenantUser')
      .addSelect([
        'tenantUser.id',
        'tenantUser.first_name',
        'tenantUser.last_name',
        'tenantUser.phone_number',
      ])
      // The tenant's ACTIVE rent on this property holds the tenancy terms.
      // INNER join: an active property_tenant link without an active rent is
      // not an ongoing tenancy (stale attach / data edge) — only rows with a
      // live rent qualify as "active tenancies".
      .innerJoin(
        'property.rents',
        'rent',
        'rent.tenant_id = pt.tenant_id AND rent.rent_status = :activeRent AND rent.deleted_at IS NULL',
        { activeRent: RentStatusEnum.ACTIVE },
      )
      .addSelect([
        'rent.id',
        'rent.rental_price',
        'rent.payment_frequency',
        'rent.rent_start_date',
        'rent.expiry_date',
      ])
      .where('pt.status = :activeTenant', {
        activeTenant: TenantStatusEnum.ACTIVE,
      })
      .andWhere('pt.deleted_at IS NULL')
      .andWhere('property.owner_id IN (:...landlordIds)', { landlordIds })
      .getMany();

    if (!links.length) return emptyPage;

    const tenantIds = Array.from(new Set(links.map((l) => l.tenant_id)));
    const ownerIds = Array.from(new Set(links.map((l) => l.property.owner_id)));

    const [nameMap, balances, activePlans] = await Promise.all([
      this.resolveLandlordNames(ownerIds),
      this.dataSource.getRepository(TenantBalance).find({
        where: { tenant_id: In(tenantIds), landlord_id: In(ownerIds) },
      }),
      this.dataSource.getRepository(PaymentPlan).find({
        where: { tenant_id: In(tenantIds), status: PaymentPlanStatus.ACTIVE },
        relations: ['installments', 'property'],
      }),
    ]);

    const walletByPair = new Map<string, number>();
    for (const b of balances) {
      walletByPair.set(
        `${b.tenant_id}|${b.landlord_id}`,
        parseFloat(b.balance as unknown as string) || 0,
      );
    }

    const plansByTenant = new Map<string, PaymentPlan[]>();
    for (const plan of activePlans) {
      const list = plansByTenant.get(plan.tenant_id);
      if (list) list.push(plan);
      else plansByTenant.set(plan.tenant_id, [plan]);
    }
    // sumOverdueInvoiceFeeInstallments walks a tenant's plans once per
    // landlord; cache per pair so multi-property tenants don't recompute.
    const overdueByPair = new Map<string, Record<string, number>>();
    const overdueForPair = (tenantId: string, landlordId: string) => {
      const key = `${tenantId}|${landlordId}`;
      let byProperty = overdueByPair.get(key);
      if (!byProperty) {
        byProperty = sumOverdueInvoiceFeeInstallments(
          plansByTenant.get(tenantId) ?? [],
          landlordId,
        ).byProperty;
        overdueByPair.set(key, byProperty);
      }
      return byProperty;
    };

    const rows: ManagedTenancyRow[] = links.map((pt) => {
      const ownerId = pt.property.owner_id;
      // Defensive: multiple active rent rows for the pair is a data edge —
      // surface the one ending last.
      const rent =
        (pt.property.rents ?? [])
          .slice()
          .sort(
            (a, b) =>
              new Date(b.expiry_date ?? 0).getTime() -
              new Date(a.expiry_date ?? 0).getTime(),
          )[0] ?? null;
      const wallet = walletByPair.get(`${pt.tenant_id}|${ownerId}`) ?? 0;
      const overdueOnProperty =
        overdueForPair(pt.tenant_id, ownerId)[pt.property_id] ?? 0;
      const tenantName =
        `${pt.tenant?.user?.first_name ?? ''} ${
          pt.tenant?.user?.last_name ?? ''
        }`.trim() ||
        pt.tenant?.profile_name?.trim() ||
        'Tenant';

      return {
        id: pt.id,
        tenantId: pt.tenant_id,
        tenantName,
        tenantPhone: pt.tenant?.user?.phone_number ?? null,
        propertyId: pt.property_id,
        propertyName: pt.property?.name ?? '',
        propertyAddress: pt.property?.location ?? '',
        landlordId: ownerId,
        landlordName: nameMap[ownerId] ?? 'Landlord',
        rentAmount:
          rent?.rental_price != null ? Number(rent.rental_price) : null,
        paymentFrequency: rent?.payment_frequency ?? null,
        startDate: rent?.rent_start_date ?? null,
        endDate: rent?.expiry_date ?? null,
        outstandingBalance: (wallet < 0 ? -wallet : 0) + overdueOnProperty,
        // Positive wallet = credit (mirrors computeTenantBalance's
        // totalCreditBalance). Same per-pair caveat as the wallet OB above.
        creditBalance: wallet > 0 ? wallet : 0,
      };
    });

    // Sort on the server so streamed pages carry a single global order — the
    // client appends pages without ever re-sorting (no visible reshuffle).
    // Sorting must run in-memory: outstandingBalance/creditBalance are derived
    // from wallet + overdue plan installments, not columns we can ORDER BY.
    // endDate nulls sink last regardless of direction (tenancies without a
    // live rent have no expiry to rank by).
    const NULL_TIME = Number.MAX_SAFE_INTEGER;
    const time = (d: Date | null) => (d ? new Date(d).getTime() : NULL_TIME);
    rows.sort((a, b) => {
      let diff = 0;
      switch (sortCol) {
        case 'tenant':
          diff = a.tenantName.localeCompare(b.tenantName);
          break;
        case 'property':
          diff = a.propertyName.localeCompare(b.propertyName);
          break;
        case 'rent':
          diff = (a.rentAmount ?? 0) - (b.rentAmount ?? 0);
          break;
        case 'outstanding':
          diff = a.outstandingBalance - b.outstandingBalance;
          break;
        case 'endDate':
        case 'daysLeft':
          // daysLeft is monotonic with endDate; both rank by expiry.
          diff = time(a.endDate) - time(b.endDate);
          break;
      }
      if (diff !== 0) return sortDir === 'asc' ? diff : -diff;
      // Stable tiebreak so equal keys keep a deterministic cross-page order.
      return a.id.localeCompare(b.id);
    });

    const totalRows = rows.length;
    const totalPages = Math.ceil(totalRows / size);
    const start = (page - 1) * size;
    return {
      tenancies: rows.slice(start, start + size),
      pagination: {
        totalRows,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  /**
   * Every invoice for one tenancy — the admin Invoices page.
   *
   * Unifies the three invoice tables into one display list:
   *  - renewal_invoices: landlord-token rows only (sent letters / cron
   *    invoices). Drafts, tenant-token OB scaffolding and superseded
   *    versions are excluded — they either aren't billed yet or would
   *    double-display debt that lives elsewhere.
   *  - ad_hoc_invoices (with line items)
   *  - standalone invoices (new-tenancy/offer flow, with line items)
   *
   * Plus the tenancy's payment plans (non-cancelled, with installments) so
   * rows whose debt an active plan owns can badge it; those rows never show
   * `overdue` — the plan's installment statuses carry the urgency.
   */
  async getTenancyInvoices(
    propertyTenantId: string,
    landlordIds: string[],
  ): Promise<TenancyInvoicesResponse> {
    const pt = await this.propertyTenantRepository.findOne({
      where: { id: propertyTenantId },
      relations: { property: true, tenant: { user: true } },
    });
    // 404 (not 403) when out of scope — don't confirm the id exists.
    if (!pt?.property || !landlordIds.includes(pt.property.owner_id)) {
      throw new NotFoundException('Tenancy not found');
    }
    const ownerId = pt.property.owner_id;

    const [renewalRows, adHocRows, newTenancyRows, planRows, nameMap] =
      await Promise.all([
        this.dataSource.getRepository(RenewalInvoice).find({
          where: {
            property_tenant_id: pt.id,
            token_type: 'landlord',
            superseded_by_id: IsNull(),
          },
          order: { start_date: 'DESC' },
        }),
        this.dataSource.getRepository(AdHocInvoice).find({
          where: { property_tenant_id: pt.id },
          relations: { line_items: true },
          order: { due_date: 'DESC' },
        }),
        // The standalone table has no property_tenant_id; (tenant, property)
        // is the tightest join. Offer-flow rows whose tenant_id was never
        // backfilled (null) can't be attributed to a tenancy — skipped.
        this.dataSource.getRepository(Invoice).find({
          where: { tenant_id: pt.tenant_id, property_id: pt.property_id },
          // offer_letter carries the public token for the new-tenancy invoice
          // page (/offer-letters/invoice/:token).
          relations: { line_items: true, offer_letter: true },
          order: { invoice_date: 'DESC' },
        }),
        this.dataSource.getRepository(PaymentPlan).find({
          where: {
            property_tenant_id: pt.id,
            status: Not(PaymentPlanStatus.CANCELLED),
          },
          relations: { installments: true },
          order: { created_at: 'DESC' },
        }),
        this.resolveLandlordNames([ownerId]),
      ]);

    const num = (v: unknown): number =>
      v == null ? 0 : parseFloat(v.toString()) || 0;
    const iso = (v: Date | string | null | undefined): string | null =>
      v == null ? null : typeof v === 'string' ? v : v.toISOString();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isPast = (v: Date | string | null | undefined): boolean => {
      if (!v) return false;
      const d = new Date(v);
      d.setHours(0, 0, 0, 0);
      return d.getTime() < today.getTime();
    };

    const activePlans = planRows.filter(
      (p) => p.status === PaymentPlanStatus.ACTIVE,
    );
    const activePlanIds = new Set(activePlans.map((p) => p.id));
    const plansByRenewalInvoice = new Map<string, PaymentPlan[]>();
    for (const plan of activePlans) {
      if (!plan.renewal_invoice_id) continue;
      const list = plansByRenewalInvoice.get(plan.renewal_invoice_id) ?? [];
      list.push(plan);
      plansByRenewalInvoice.set(plan.renewal_invoice_id, list);
    }

    const invoices: TenancyInvoiceRow[] = [];

    for (const inv of renewalRows) {
      // Declined/lapsed letters aren't payable ("no money is expected") —
      // an UNPAID one would render as a phantom overdue row.
      if (
        inv.letter_status === RenewalLetterStatus.DECLINED &&
        inv.payment_status !== RenewalPaymentStatus.PAID &&
        inv.payment_status !== RenewalPaymentStatus.PARTIAL
      ) {
        continue;
      }

      const plans = plansByRenewalInvoice.get(inv.id) ?? [];
      // A TENANCY-scope plan owns the whole invoice; CHARGE carves already
      // removed their fee from the invoice totals, so the remainder can
      // still legitimately go overdue.
      const wholeInvoicePlanned = plans.some(
        (p) => p.scope === PaymentPlanScope.TENANCY,
      );

      let status: TenancyInvoiceRow['status'];
      if (inv.payment_status === RenewalPaymentStatus.PAID) status = 'paid';
      else if (inv.payment_status === RenewalPaymentStatus.PARTIAL)
        status = 'partial';
      else if (isPast(inv.start_date) && !wholeInvoicePlanned)
        status = 'overdue';
      else status = 'upcoming';

      const lines = (inv.fee_breakdown ?? []).map((f) => ({
        name: f.label,
        amount: num(f.amount),
      }));
      if (!lines.length) {
        // Legacy rows predate fee_breakdown — rebuild from the typed columns.
        const cols: Array<[string, number]> = [
          ['Rent', num(inv.rent_amount)],
          ['Service Charge', num(inv.service_charge)],
          ['Legal Fee', num(inv.legal_fee)],
          ['Agency Fee', num(inv.agency_fee)],
          ['Caution Deposit', num(inv.caution_deposit)],
          ['Other Charges', num(inv.other_charges)],
        ];
        for (const [name, amount] of cols)
          if (amount > 0) lines.push({ name, amount });
        for (const f of inv.other_fees ?? [])
          if (num(f.amount) > 0)
            lines.push({ name: f.name, amount: num(f.amount) });
      }
      // The wallet fold (prior debt or credit) is in total_amount but never
      // in fee_breakdown — surface the difference so lines sum to the total.
      const lineSum = lines.reduce((s, l) => s + l.amount, 0);
      const foldDiff = num(inv.total_amount) - lineSum;
      if (Math.abs(foldDiff) >= 0.01) {
        lines.push({
          name: foldDiff > 0 ? 'Previous Balance' : 'Credit Applied',
          amount: foldDiff,
        });
      }

      invoices.push({
        id: inv.id,
        source: 'renewal',
        description: 'Rent Invoice',
        invoiceNumber: null,
        dueDate: iso(inv.start_date),
        periodStart: iso(inv.start_date),
        periodEnd: iso(inv.end_date),
        status,
        totalAmount: num(inv.total_amount),
        amountPaid: num(inv.amount_paid),
        lines,
        token: inv.token,
        publicToken: null,
        receiptToken: inv.receipt_token || null,
        paidAt: iso(inv.paid_at),
        createdAt: iso(inv.created_at) ?? new Date().toISOString(),
        paymentPlanIds: plans.map((p) => p.id),
      });
    }

    for (const inv of adHocRows) {
      if (inv.status === AdHocInvoiceStatus.CANCELLED) continue;

      const coveredByActivePlan =
        !!inv.covered_by_plan_id && activePlanIds.has(inv.covered_by_plan_id);
      let status: TenancyInvoiceRow['status'];
      if (inv.status === AdHocInvoiceStatus.PAID) status = 'paid';
      else if (inv.status === AdHocInvoiceStatus.PARTIAL) status = 'partial';
      // Mirrors AdHocInvoicesService.computeStatus: OVERDUE is derived at
      // read time and suppressed while a plan owns the debt.
      else if (isPast(inv.due_date) && !coveredByActivePlan) status = 'overdue';
      else status = 'upcoming';

      const items = (inv.line_items ?? [])
        .slice()
        .sort((a, b) => a.sequence - b.sequence);

      invoices.push({
        id: inv.id,
        source: 'ad_hoc',
        description:
          items.length === 1
            ? items[0].description
            : items.length > 1
              ? `${items[0].description} + ${items.length - 1} more`
              : 'Ad-hoc Invoice',
        invoiceNumber: inv.invoice_number,
        dueDate: iso(inv.due_date),
        periodStart: null,
        periodEnd: null,
        status,
        totalAmount: num(inv.total_amount),
        amountPaid: num(inv.amount_paid),
        lines: items.map((li) => ({
          name: li.description,
          amount: num(li.amount),
        })),
        token: null,
        publicToken: inv.public_token,
        receiptToken: inv.receipt_token || null,
        paidAt: iso(inv.paid_at),
        createdAt: iso(inv.created_at) ?? new Date().toISOString(),
        paymentPlanIds: coveredByActivePlan ? [inv.covered_by_plan_id!] : [],
      });
    }

    for (const inv of newTenancyRows) {
      if (inv.status === InvoiceStatus.CANCELLED) continue;

      let status: TenancyInvoiceRow['status'];
      if (inv.status === InvoiceStatus.PAID) status = 'paid';
      else if (inv.status === InvoiceStatus.PARTIALLY_PAID) status = 'partial';
      // No due-date column here; trust the stored status rather than
      // deriving OVERDUE from invoice_date (that's the creation date).
      else if (inv.status === InvoiceStatus.OVERDUE) status = 'overdue';
      else status = 'upcoming';

      invoices.push({
        id: inv.id,
        source: 'new_tenancy',
        description: 'New Tenancy Invoice',
        invoiceNumber: inv.invoice_number,
        dueDate: iso(inv.invoice_date),
        periodStart: null,
        periodEnd: null,
        status,
        totalAmount: num(inv.total_amount),
        amountPaid: num(inv.amount_paid),
        lines: (inv.line_items ?? []).map((li) => ({
          name: li.description,
          amount: num(li.amount),
        })),
        // Offer-letter token → new-tenancy invoice page (/offer-letters/invoice/:token).
        token: inv.offer_letter?.token ?? null,
        publicToken: null,
        receiptToken: null,
        paidAt: null,
        createdAt: iso(inv.created_at) ?? new Date().toISOString(),
        paymentPlanIds: [],
      });
    }

    invoices.sort((a, b) => {
      const ta = a.dueDate ? new Date(a.dueDate).getTime() : 0;
      const tb = b.dueDate ? new Date(b.dueDate).getTime() : 0;
      return tb - ta;
    });

    const adHocIds = new Set(adHocRows.map((r) => r.id));
    const renewalIds = new Set(renewalRows.map((r) => r.id));
    const paymentPlans: TenancyPaymentPlan[] = planRows.map((plan) => {
      // Which unified row does this plan fund? OB/wallet-backed plans fund
      // ledger debt, not a listed invoice — they get no link.
      let linkedInvoiceId: string | null = null;
      let linkedInvoiceSource: TenancyPaymentPlan['linkedInvoiceSource'] = null;
      if (plan.renewal_invoice_id && renewalIds.has(plan.renewal_invoice_id)) {
        linkedInvoiceId = plan.renewal_invoice_id;
        linkedInvoiceSource = 'renewal';
      } else if (
        plan.ad_hoc_invoice_id &&
        adHocIds.has(plan.ad_hoc_invoice_id)
      ) {
        linkedInvoiceId = plan.ad_hoc_invoice_id;
        linkedInvoiceSource = 'ad_hoc';
      }

      return {
        id: plan.id,
        scope: plan.scope,
        sourceType: plan.source_type,
        planType: plan.plan_type,
        status: plan.status,
        chargeName: plan.charge_name,
        totalAmount: num(plan.total_amount),
        createdAt: iso(plan.created_at) ?? new Date().toISOString(),
        linkedInvoiceId,
        linkedInvoiceSource,
        installments: (plan.installments ?? [])
          .slice()
          .sort((a, b) => a.sequence - b.sequence)
          .map((inst) => ({
            id: inst.id,
            sequence: inst.sequence,
            amount: num(inst.amount),
            amountPaid: num(inst.amount_paid),
            dueDate: iso(inst.due_date) ?? '',
            status: inst.status,
            paidAt: iso(inst.paid_at),
            paymentMethod: inst.payment_method ?? null,
            receiptToken: inst.receipt_token || null,
          })),
      };
    });

    const tenantName =
      `${pt.tenant?.user?.first_name ?? ''} ${
        pt.tenant?.user?.last_name ?? ''
      }`.trim() ||
      pt.tenant?.profile_name?.trim() ||
      'Tenant';

    return {
      tenancy: {
        id: pt.id,
        tenantId: pt.tenant_id,
        tenantName,
        tenantPhone: pt.tenant?.user?.phone_number ?? null,
        propertyId: pt.property_id,
        propertyName: pt.property?.name ?? '',
        propertyAddress: pt.property?.location ?? '',
        landlordId: ownerId,
        landlordName: nameMap[ownerId] ?? 'Landlord',
      },
      invoices,
      paymentPlans,
    };
  }

  /**
   * The DISTINCT managed landlords (subset of `landlordIds`) this tenant
   * rents/rented from. A tenant can be under several landlords; the admin's
   * tenant view is grouped per landlord. Empty => out of scope (404).
   */
  private async resolveTenantLandlordsInScope(
    tenantId: string,
    landlordIds: string[],
  ): Promise<string[]> {
    if (!landlordIds.length) return [];
    const manager = this.accountRepository.manager;
    const [current, past] = await Promise.all([
      manager
        .createQueryBuilder(PropertyTenant, 'pt')
        .innerJoin('pt.property', 'p')
        .select('DISTINCT p.owner_id', 'owner_id')
        .where('pt.tenant_id = :tenantId', { tenantId })
        .andWhere('p.owner_id IN (:...landlordIds)', { landlordIds })
        .getRawMany<{ owner_id: string }>(),
      manager
        .createQueryBuilder(PropertyHistory, 'ph')
        .innerJoin('ph.property', 'p')
        .select('DISTINCT p.owner_id', 'owner_id')
        .where('ph.tenant_id = :tenantId', { tenantId })
        .andWhere('p.owner_id IN (:...landlordIds)', { landlordIds })
        .getRawMany<{ owner_id: string }>(),
    ]);
    return Array.from(new Set([...current, ...past].map((r) => r.owner_id)));
  }

  /**
   * Display names for a set of landlord accounts (profile_name, else first+last).
   */
  private async resolveLandlordNames(
    landlordIds: string[],
  ): Promise<Record<string, string>> {
    if (!landlordIds.length) return {};
    const accounts = await this.accountRepository.find({
      where: { id: In(landlordIds) },
      relations: { user: true },
    });
    const map: Record<string, string> = {};
    for (const a of accounts) {
      map[a.id] =
        a.profile_name?.trim() ||
        `${a.user?.first_name ?? ''} ${a.user?.last_name ?? ''}`.trim() ||
        'Landlord';
    }
    return map;
  }

  /**
   * Get one tenant (under one of the admin's managed landlords) with full detail.
   */
  async getManagedTenant(
    tenantId: string,
    landlordIds: string[],
  ): Promise<{
    landlords: TenantDetailDto[];
    summary: { totalOutstandingBalance: number; totalCreditBalance: number };
  }> {
    // A tenant can be under several managed landlords; return one full detail
    // group per landlord plus an overall balance summary. 404 if under none.
    const tenantLandlordIds = await this.resolveTenantLandlordsInScope(
      tenantId,
      landlordIds,
    );
    if (!tenantLandlordIds.length) {
      throw new HttpException(
        `Tenant with id: ${tenantId} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    const nameMap = await this.resolveLandlordNames(tenantLandlordIds);
    const landlords = await Promise.all(
      tenantLandlordIds.map(async (lid) => {
        const detail = await this.buildTenantDetailForLandlord(tenantId, lid);
        detail.landlordId = lid;
        detail.landlordName = nameMap[lid] ?? 'Landlord';
        return detail;
      }),
    );
    const summary = {
      totalOutstandingBalance: landlords.reduce(
        (s, d) => s + (d.totalOutstandingBalance ?? 0),
        0,
      ),
      totalCreditBalance: landlords.reduce(
        (s, d) => s + (d.totalCreditBalance ?? 0),
        0,
      ),
    };
    return { landlords, summary };
  }

  /**
   * Build the full tenant detail scoped to ONE landlord — the per-group unit of
   * the admin tenant view above.
   */
  private async buildTenantDetailForLandlord(
    tenantId: string,
    landlordId: string,
  ): Promise<TenantDetailDto> {
    // The tenant's latest KYC application and the id/property_id list of all
    // their KYC applications don't depend on the account query — fire them now
    // so they run concurrently with (and hide under) the heavy account query
    // below, instead of adding two sequential round-trips after it.
    //
    // KYC is scoped by landlord (property.owner_id), not the tenant's currently
    // active property: a tenant can submit KYC for one property but be attached
    // to another (or be a past tenant with no active rent at all). Landlord
    // scope alone keeps cross-landlord submissions out while preserving this
    // tenant's own application within this landlord.
    const kycApplicationPromise = this.kycApplicationRepository
      .createQueryBuilder('app')
      .innerJoinAndSelect('app.property', 'property')
      .leftJoinAndSelect('app.offer_letters', 'app_offer_letters')
      .where('app.tenant_id = :tenantId', { tenantId })
      .andWhere('property.owner_id = :landlordId', { landlordId })
      .orderBy('app.created_at', 'DESC')
      .getOne();
    const kycApplicationsPromise = this.kycApplicationRepository.find({
      where: { tenant_id: tenantId },
      select: ['id', 'property_id'],
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
        'tenant_kyc.admin_id = :landlordId',
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
      .leftJoin('account.maintenance_requests', 'maintenance_requests')
      .addSelect([
        'maintenance_requests.id',
        'maintenance_requests.description',
        'maintenance_requests.status',
        'maintenance_requests.date_reported',
        'maintenance_requests.created_at',
      ])
      .leftJoin('maintenance_requests.property', 'sr_property')
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
        'property_histories.receipt_token',
        'property_histories.receipt_number',
        'property_histories.metadata',
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
          .andWhere('p.owner_id = :landlordId')
          .getQuery();

        const pastTenancySubQuery = qb
          .subQuery()
          .select('1')
          .from(PropertyHistory, 'ph')
          .innerJoin('ph.property', 'p')
          .where('ph.tenant_id = account.id')
          .andWhere('p.owner_id = :landlordId')
          .getQuery();

        return `(EXISTS ${currentTenancySubQuery} OR EXISTS ${pastTenancySubQuery})`;
      })
      .setParameters({ tenantId, landlordId })
      .getOne();

    console.log('🔍 DEBUG: Tenant query result:', {
      tenantId,
      landlordId,
      found: !!tenantAccount?.id,
      propertyHistoriesCount: tenantAccount?.property_histories?.length || 0,
      rentsCount: tenantAccount?.rents?.length || 0,
      maintenanceRequestsCount:
        tenantAccount?.maintenance_requests?.length || 0,
    });

    if (!tenantAccount?.id) {
      console.log('❌ DEBUG: Tenant not found for landlord:', {
        tenantId,
        landlordId,
        timestamp: new Date().toISOString(),
      });
      throw new HttpException(
        `Tenant with id: ${tenantId} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    // Resolve the KYC lookups fired before the account query above.
    const kycApplication = await kycApplicationPromise;
    const kycApplications = await kycApplicationsPromise;
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

    // Applicant-phase histories and offer letters both depend only on the KYC
    // id lists above and are independent of each other — fetch them concurrently.
    // Fetch history events for the property that already belong to this tenant,
    // plus not-yet-backfilled (tenant_id IS NULL) rows ONLY when they are tied
    // to one of THIS tenant's KYC applications — unclaimed rows on the same
    // property can belong to other applicants (their journey events and staged
    // payments) or be tenant-neutral property events, and must not leak into
    // this tenant's timeline or balance breakdown.
    const [applicantPhaseHistories, offerLetters] = await Promise.all([
      kycPropertyIds.length > 0
        ? this.dataSource
            .getRepository(PropertyHistory)
            .createQueryBuilder('ph')
            .leftJoinAndSelect('ph.property', 'property')
            .where('ph.property_id IN (:...propertyIds)', {
              propertyIds: kycPropertyIds,
            })
            .andWhere(
              `(ph.tenant_id = :tenantId OR (
                 ph.tenant_id IS NULL
                 AND ph.related_entity_type = 'kyc_application'
                 AND ph.related_entity_id IN (:...kycApplicationIds)
               ))`,
              { tenantId, kycApplicationIds },
            )
            .orderBy('ph.created_at', 'ASC')
            .getMany()
        : Promise.resolve([] as PropertyHistory[]),
      kycApplicationIds.length > 0
        ? this.offerLetterRepository
            .createQueryBuilder('offer')
            .leftJoinAndSelect('offer.property', 'property')
            .where('offer.kyc_application_id IN (:...kycIds)', {
              kycIds: kycApplicationIds,
            })
            .andWhere('offer.landlord_id = :landlordId', { landlordId })
            .orderBy('offer.created_at', 'DESC')
            .getMany()
        : Promise.resolve([] as OfferLetter[]),
    ]);

    // Merge applicant-phase histories into the tenant account's property_histories,
    // deduplicating by id so events that were already backfilled don't appear twice.
    if (applicantPhaseHistories.length > 0) {
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
      landlordId,
      offerLetters,
      payments,
    );
  }

  /**
   * Standalone outstanding-balance lookup for a tenant. Returns only the
   * balance-related fields of the tenant detail so the frontend can keep these
   * always-fresh (no cache) while the heavier tenant payload is cached.
   *
   * Loads only the account data computeTenantBalance needs (rents + property,
   * property_histories), reusing the same landlord-scoping (current OR past
   * tenancy) and 404 behaviour as getSingleTenantOfAnAdmin.
   */
  async getTenantBalance(
    tenantId: string,
    landlordIds: string[],
  ): Promise<{
    byLandlord: Array<{
      landlordId: string;
      landlordName: string;
      totalOutstandingBalance: number;
      totalCreditBalance: number;
      outstandingBalanceBreakdown: TenantDetailDto['outstandingBalanceBreakdown'];
      paymentTransactions: TenantDetailDto['paymentTransactions'];
    }>;
    summary: { totalOutstandingBalance: number; totalCreditBalance: number };
  }> {
    const tenantLandlordIds = await this.resolveTenantLandlordsInScope(
      tenantId,
      landlordIds,
    );
    if (!tenantLandlordIds.length) {
      throw new HttpException(
        `Tenant with id: ${tenantId} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    // Load the tenant account once (rents + property owner + histories); the
    // per-landlord split happens below. Scope is already proven by the resolve.
    const tenantAccount = await this.accountRepository
      .createQueryBuilder('account')
      .leftJoin('account.rents', 'rents')
      .addSelect([
        'rents.id',
        'rents.property_id',
        'rents.tenant_id',
        'rents.expiry_date',
        'rents.rent_start_date',
        'rents.rent_status',
      ])
      .leftJoin('rents.property', 'property')
      .addSelect(['property.id', 'property.name', 'property.owner_id'])
      .leftJoin('account.property_histories', 'property_histories')
      .addSelect([
        'property_histories.id',
        'property_histories.event_type',
        'property_histories.event_description',
        'property_histories.move_in_date',
        'property_histories.created_at',
      ])
      .leftJoin('property_histories.property', 'past_property')
      .addSelect(['past_property.id', 'past_property.owner_id'])
      .where('account.id = :tenantId', { tenantId })
      .getOne();

    if (!tenantAccount?.id) {
      throw new HttpException(
        `Tenant with id: ${tenantId} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    const nameMap = await this.resolveLandlordNames(tenantLandlordIds);
    const byLandlord = await Promise.all(
      tenantLandlordIds.map(async (lid) => {
        const rents =
          tenantAccount.rents?.filter((r) => r.property?.owner_id === lid) ||
          [];
        const balance = await this.computeTenantBalance(
          tenantAccount,
          lid,
          rents,
        );
        return {
          landlordId: lid,
          landlordName: nameMap[lid] ?? 'Landlord',
          ...balance,
        };
      }),
    );
    const summary = {
      totalOutstandingBalance: byLandlord.reduce(
        (s, b) => s + b.totalOutstandingBalance,
        0,
      ),
      totalCreditBalance: byLandlord.reduce(
        (s, b) => s + b.totalCreditBalance,
        0,
      ),
    };
    return { byLandlord, summary };
  }

  /**
   * Get tenant and property info for a tenant
   */
  async getTenantAndPropertyInfo(tenant_id: string): Promise<Account> {
    const tenant = await this.accountRepository.findOne({
      where: {
        id: tenant_id,
        roles: ArrayContains([RolesEnum.TENANT]),
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
   * Compute a tenant's outstanding/credit balance, the per-property breakdown,
   * and the manual/ledger payment-transaction list — the always-fresh portion of
   * the tenant detail. Extracted out of formatTenantData so the standalone
   * balance endpoint can reuse it without recomputing the whole tenant payload.
   *
   * `rents` must be the landlordId-filtered rent list (passed in so it stays
   * identical to the value formatTenantData uses elsewhere in its response).
   */
  private async computeTenantBalance(
    account: Account,
    landlordId: string | undefined,
    rents: Rent[],
  ): Promise<{
    totalOutstandingBalance: number;
    totalCreditBalance: number;
    outstandingBalanceBreakdown: TenantDetailDto['outstandingBalanceBreakdown'];
    paymentTransactions: TenantDetailDto['paymentTransactions'];
  }> {
    // Fetch wallet balance and ledger (requires landlordId as landlordId)
    let walletBalance = 0;
    let ledgerEntries: TenantBalanceLedger[] = [];
    let overduePlanByProperty: Record<string, number> = {};
    let overduePlanInstallments = 0;
    if (landlordId) {
      // getBalance, getLedger and the active-plans lookup are independent reads —
      // run them concurrently instead of as three back-to-back Neon round-trips.
      // Carved invoice-fee charge plans never debit the wallet, so their overdue
      // installments are invisible in the wallet-derived balance. Surface them
      // on the landlord view once past due. Ad-hoc / OB plan debt is already
      // real wallet OB, so the shared helper excludes it (no double-count).
      const [walletBalanceResult, ledgerResult, activePlans] =
        await Promise.all([
          this.tenantBalancesService.getBalance(account.id, landlordId),
          this.tenantBalancesService.getLedger(account.id, landlordId),
          this.dataSource.getRepository(PaymentPlan).find({
            where: { tenant_id: account.id, status: PaymentPlanStatus.ACTIVE },
            relations: ['installments', 'property'],
          }),
        ]);
      walletBalance = walletBalanceResult;
      ledgerEntries = ledgerResult;
      const overdue = sumOverdueInvoiceFeeInstallments(activePlans, landlordId);
      overduePlanByProperty = overdue.byProperty;
      overduePlanInstallments = overdue.total;
    }
    // Derive display values from unified balance. Overdue carved-plan
    // installments are folded into the outstanding figure (display-only — no
    // ledger row is written).
    const totalOutstandingBalance =
      (walletBalance < 0 ? -walletBalance : 0) + overduePlanInstallments;
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
    //   - related_entity_type = 'rent_edit': reversal entries created when a landlord
    //     edits tenancy charges via the edit tenancy modal.
    //   - metadata.superseded = true: original charge entries that have been replaced
    //     by an edit — the replacement entries are the authoritative charges.
    // Note: MIGRATION entries are included — they represent real rent charges carried
    // forward at ledger setup time.
    const obEntriesByProperty = new Map<string, TenantBalanceLedger[]>();
    ledgerEntries
      .filter(
        (e) =>
          Number(e.balance_change) < 0 &&
          e.type !== TenantBalanceLedgerType.CREDIT_APPLIED &&
          e.related_entity_type !== 'property_history' &&
          e.related_entity_type !== 'rent_edit' &&
          !(e.metadata as any)?.superseded &&
          // Phantom-credit reversal legs (written by the Phase-1 repair script)
          // cancel a now-removed wallet credit and net to zero with it, so they
          // must not surface as standalone charges.
          !(e.metadata as any)?.phantom_credit_reversal,
      )
      .forEach((e) => {
        const key = e.property_id || 'global';
        if (!obEntriesByProperty.has(key)) obEntriesByProperty.set(key, []);
        obEntriesByProperty.get(key)!.push(e);
      });

    // Ad-hoc invoices are charged and later reversed (cancel / edit-down) on the
    // wallet ledger. Net every leg of an invoice by its id so a cancelled
    // invoice nets to zero (no row) and an edited one shows its current amount
    // exactly once — instead of rendering the (mutable) line-item set once per
    // surviving charge leg (the old double-count bug). Genuine payments
    // (positive, NOT reversal-tagged) are excluded here and surfaced as payment
    // rows in paymentTransactions below. `owed` is the negative of the net.
    const adHocOwedByInvoice = new Map<string, number>();
    for (const e of ledgerEntries) {
      if (e.related_entity_type !== 'ad_hoc_invoice' || !e.related_entity_id) {
        continue;
      }
      const bc = Number(e.balance_change);
      const isGenuinePayment = bc > 0 && !isAdHocReversalLeg(e);
      if (isGenuinePayment) continue;
      adHocOwedByInvoice.set(
        e.related_entity_id,
        (adHocOwedByInvoice.get(e.related_entity_id) ?? 0) + bc,
      );
    }

    // For ad-hoc invoice charges, fetch the line items so the breakdown can
    // surface each fee by name instead of one opaque "Invoice AHI-…" row.
    const adHocInvoiceIds = Array.from(
      new Set(
        Array.from(obEntriesByProperty.values())
          .flat()
          .filter(
            (e) =>
              e.related_entity_type === 'ad_hoc_invoice' && e.related_entity_id,
          )
          .map((e) => e.related_entity_id as string),
      ),
    );
    const adHocLineItemsByInvoiceId = new Map<string, AdHocInvoiceLineItem[]>();
    if (adHocInvoiceIds.length > 0) {
      const items = await this.adHocInvoiceLineItemRepository.find({
        where: { invoice_id: In(adHocInvoiceIds) },
        order: { sequence: 'ASC' },
      });
      items.forEach((li) => {
        const arr = adHocLineItemsByInvoiceId.get(li.invoice_id) || [];
        arr.push(li);
        adHocLineItemsByInvoiceId.set(li.invoice_id, arr);
      });
    }

    const outstandingBalanceBreakdown = Array.from(
      obEntriesByProperty.entries(),
    ).map(([propId, entries]) => {
      const propRent = rents.find((r) => r.property_id === propId);

      // Collapse multiple charge legs of one ad-hoc invoice into a single
      // netted row.
      const seenAdHoc = new Set<string>();

      const transactions = entries
        .flatMap((e) => {
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

          // Ad-hoc invoices: emit ONE netted row per invoice (charges minus
          // reversals), using line-item names only when they still sum to the
          // net. A fully cancelled/netted invoice produces no row.
          if (
            e.related_entity_type === 'ad_hoc_invoice' &&
            e.related_entity_id
          ) {
            const invoiceId = e.related_entity_id;
            if (seenAdHoc.has(invoiceId)) return [];
            seenAdHoc.add(invoiceId);

            const owed = -(adHocOwedByInvoice.get(invoiceId) ?? 0);
            // Drop only true-zero / sub-naira reversal residue — a real ₦1
            // invoice (owed === 1) must still render.
            if (owed < 0.5) return []; // fully cancelled / netted away

            const lineItems = adHocLineItemsByInvoiceId.get(invoiceId);
            const lineItemSum = (lineItems ?? []).reduce(
              (s, li) => s + Number(li.amount),
              0,
            );
            if (
              lineItems &&
              lineItems.length > 0 &&
              Math.abs(lineItemSum - owed) <= 1
            ) {
              return lineItems.map((li) => ({
                id: `${e.id}-${li.id}`,
                type: li.description,
                amount: Number(li.amount),
                date: transactionDate,
              }));
            }
            return [
              {
                id: e.id,
                type: periodDescription,
                amount: owed,
                date: transactionDate,
              },
            ];
          }

          return [
            {
              id: e.id,
              type: periodDescription,
              amount: -Number(e.balance_change), // charges are negative balance_change; expose as positive
              date: transactionDate,
            },
          ];
        })
        .sort((a, b) => b.date.getTime() - a.date.getTime());

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
        // Sum the emitted (netted) rows so the per-property subtotal matches
        // what is displayed, not the raw charge legs.
        outstandingAmount: transactions.reduce((sum, t) => sum + t.amount, 0),
        tenancyStartDate: propRent?.rent_start_date
          ? new Date(propRent.rent_start_date)
          : null,
        tenancyEndDate: propRent?.expiry_date
          ? new Date(propRent.expiry_date)
          : null,
        transactions,
      };
    });

    // Fold overdue carved-plan installments into the per-property breakdown so
    // the landlord sees them as outstanding (they have no wallet ledger row, so
    // they wouldn't otherwise appear). Tenant-facing builders are untouched.
    for (const [propId, amount] of Object.entries(overduePlanByProperty)) {
      if (amount <= 0.5) continue;
      const row = {
        id: `overdue-plan-${propId}`,
        type: 'Overdue payment-plan installments',
        amount,
        date: new Date(),
      };
      const existing = outstandingBalanceBreakdown.find(
        (b) => b.propertyId === propId,
      );
      if (existing) {
        existing.transactions.unshift(row);
        existing.outstandingAmount += amount;
      } else {
        const propRent = rents.find((r) => r.property_id === propId);
        outstandingBalanceBreakdown.push({
          rentId: propRent?.id || propId,
          propertyName: propRent?.property?.name || 'Unknown Property',
          propertyId: propId,
          outstandingAmount: amount,
          tenancyStartDate: propRent?.rent_start_date
            ? new Date(propRent.rent_start_date)
            : null,
          tenancyEndDate: propRent?.expiry_date
            ? new Date(propRent.expiry_date)
            : null,
          transactions: [row],
        });
      }
    }

    const paymentTransactions = [
      // Manual payments — property history is the authority for which payments
      // currently exist and at what amount. Edited payments update in place so
      // we never see stale pre-edit amounts. Deleted payments remove the record.
      ...(account.property_histories || [])
        .filter((h) => {
          if (h.event_type !== 'user_added_payment') return false;
          if (landlordId && h.property?.owner_id !== landlordId) return false;
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

      // Renewal-invoice payments, payment-plan installment payments and
      // GENUINE ad-hoc payments — no property history entry is created for
      // these, so we read them from the ledger.
      // Ad-hoc cancellation / edit-down REVERSALS (metadata.reversal) are not
      // payments: they are netted against their charge in the breakdown above
      // and must not appear here as money received.
      ...ledgerEntries
        .filter(
          (e) =>
            Number(e.balance_change) > 0 &&
            (e.related_entity_type === 'renewal_invoice' ||
              e.related_entity_type === 'payment_plan_installment' ||
              (e.related_entity_type === 'ad_hoc_invoice' &&
                !isAdHocReversalLeg(e))),
        )
        .map((e) => ({
          id: e.id,
          type: e.description || 'Payment received',
          amount: -Number(e.balance_change), // payments are positive balance_change; show as negative (money out for tenant)
          date: new Date(e.created_at!),
        })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime());

    return {
      totalOutstandingBalance,
      totalCreditBalance,
      outstandingBalanceBreakdown,
      paymentTransactions,
    };
  }

  /**
   * Format tenant data for response
   */
  private async formatTenantData(
    account: Account,
    kycApplication?: KYCApplication | null,
    landlordId?: string,
    offerLetters?: OfferLetter[],
    payments?: Payment[],
  ): Promise<TenantDetailDto> {
    const user = account.user;
    const kyc = (user as Users & { kyc?: Record<string, string> }).kyc ?? {};
    const tenantKyc = (user as Users & { tenant_kycs?: TenantKycRecord[] })
      .tenant_kycs?.[0];

    // Filter data by landlordId if provided
    const rents = landlordId
      ? account.rents?.filter((r) => r.property?.owner_id === landlordId) || []
      : account.rents || [];

    // Outstanding balance, credit, the per-property breakdown and the
    // manual/ledger payment-transaction list are derived together. Same helper
    // backs the standalone always-fresh GET …/balance endpoint.
    const {
      totalOutstandingBalance,
      totalCreditBalance,
      outstandingBalanceBreakdown,
      paymentTransactions,
    } = await this.computeTenantBalance(account, landlordId, rents);

    const maintenanceRequests = landlordId
      ? account.maintenance_requests?.filter(
          (sr) => sr.property?.owner_id === landlordId,
        ) || []
      : account.maintenance_requests || [];

    const propertyHistories = landlordId
      ? account.property_histories?.filter(
          (ph) => ph.property?.owner_id === landlordId,
        ) || []
      : account.property_histories || [];

    const noticeAgreements = landlordId
      ? account.notice_agreements?.filter(
          (na) => na.property?.owner_id === landlordId,
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
      maintenanceRequests,
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

    // The pending invoices, Documents-tab renewal invoices, ad-hoc invoices,
    // payment plans and payment-plan requests below are all independent reads.
    // Fire them concurrently up front (one round-trip wave instead of five
    // back-to-back) and await each at its existing use-site, leaving every
    // in-memory transformation untouched.
    const ownerScope = landlordId ? { property: { owner_id: landlordId } } : {};

    const pendingInvoicesPromise =
      activeRentPropertyIds.length > 0
        ? this.dataSource.getRepository(RenewalInvoice).find({
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
          })
        : Promise.resolve([] as RenewalInvoice[]);

    const allRenewalInvoicesPromise = this.dataSource
      .getRepository(RenewalInvoice)
      .find({
        where: [
          {
            tenant_id: account.id,
            token_type: In(['landlord', 'draft']),
            ...ownerScope,
          },
          {
            tenant_id: account.id,
            token_type: 'tenant',
            receipt_token: Not(IsNull()),
            ...ownerScope,
          },
        ],
        relations: ['property'],
        order: { created_at: 'DESC' },
        select: [
          'id',
          'token',
          'token_type',
          'receipt_token',
          'property_id',
          'rent_amount',
          'total_amount',
          'payment_status',
          'approval_status',
          'letter_status',
          'letter_sent_at',
          'created_at',
          'paid_at',
          'start_date',
          'end_date',
        ],
      });

    const adHocInvoiceRowsPromise = this.dataSource
      .getRepository(AdHocInvoice)
      .find({
        where: {
          tenant_id: account.id,
          ...(landlordId ? { landlord_id: landlordId } : {}),
        },
        relations: ['property'],
        order: { created_at: 'DESC' },
      });

    const paymentPlanRowsPromise = this.dataSource
      .getRepository(PaymentPlan)
      .find({
        where: {
          tenant_id: account.id,
          ...(landlordId ? { property: { owner_id: landlordId } } : {}),
        },
        relations: ['property', 'installments'],
        order: { created_at: 'DESC' },
      });

    const paymentPlanRequestRowsPromise = this.dataSource
      .getRepository(PaymentPlanRequest)
      .find({
        where: {
          tenant_id: account.id,
          ...(landlordId ? { property: { owner_id: landlordId } } : {}),
        },
        relations: ['property'],
        order: { created_at: 'DESC' },
      });

    const pendingInvoices = await pendingInvoicesPromise;
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

    // Pending invoice for the primary active rent (used by single-tenancy view)
    const activePendingInvoice = activeRent
      ? (pendingInvoiceMap.get(activeRent.property_id) ?? null)
      : null;

    // Fetch renewal invoices for the Documents tab.
    // Default: landlord/draft rows (the documents the landlord authored).
    // Also: tenant-token rows that have a receipt_token, i.e., have at
    // least one real Paystack payment landed (full or partial). Empty
    // tenant-token rows are still excluded — those are OB pay-link /
    // payment-plan-request scaffolding the bot creates, not documents.
    const allRenewalInvoices = await allRenewalInvoicesPromise;

    const renewalInvoiceSummaries = allRenewalInvoices.map((inv) => ({
      id: inv.id,
      token: inv.token,
      // tokenType + letter_* surfaced so the landlord Documents tab can
      // render a discoverable "Renewal Letter" row alongside the existing
      // "Renewal Invoice" row, and skip tenant-token (OB-pay) rows that
      // would 404 on the /renewal-letters/:token page.
      tokenType: inv.token_type,
      receiptToken: inv.receipt_token || null,
      propertyName: inv.property?.name || 'Property',
      totalAmount: parseFloat((inv.total_amount ?? 0).toString()),
      paymentStatus: inv.payment_status,
      approvalStatus: inv.approval_status ?? null,
      letterStatus: inv.letter_status ?? null,
      letterSentAt: inv.letter_sent_at
        ? typeof inv.letter_sent_at === 'string'
          ? inv.letter_sent_at
          : inv.letter_sent_at.toISOString()
        : null,
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

    // Fetch ad-hoc invoices for this tenant (filtered by landlord when provided)
    const adHocInvoiceRows = await adHocInvoiceRowsPromise;

    const adHocInvoices = adHocInvoiceRows.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      publicToken: inv.public_token,
      receiptToken: inv.receipt_token || null,
      propertyName: inv.property?.name || 'Property',
      totalAmount: parseFloat((inv.total_amount ?? 0).toString()),
      status: inv.status,
      dueDate: inv.due_date
        ? typeof inv.due_date === 'string'
          ? inv.due_date
          : inv.due_date.toISOString()
        : '',
      createdAt: inv.created_at
        ? new Date(inv.created_at).toISOString()
        : new Date().toISOString(),
      paidAt: inv.paid_at
        ? typeof inv.paid_at === 'string'
          ? inv.paid_at
          : inv.paid_at.toISOString()
        : null,
    }));

    // Fetch payment plans (with installments) for this tenant
    const paymentPlanRows = await paymentPlanRowsPromise;

    const paymentPlans = paymentPlanRows.map((plan) => ({
      id: plan.id,
      propertyTenantId: plan.property_tenant_id,
      propertyId: plan.property_id,
      propertyName: plan.property?.name || 'Property',
      chargeName: plan.charge_name,
      scope: plan.scope,
      planType: plan.plan_type,
      status: plan.status,
      totalAmount: parseFloat((plan.total_amount ?? 0).toString()),
      createdAt: plan.created_at
        ? new Date(plan.created_at).toISOString()
        : new Date().toISOString(),
      installments: (plan.installments || [])
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map((inst) => ({
          id: inst.id,
          sequence: inst.sequence,
          amount: parseFloat((inst.amount ?? 0).toString()),
          dueDate: inst.due_date
            ? typeof inst.due_date === 'string'
              ? inst.due_date
              : inst.due_date.toISOString()
            : '',
          status: inst.status,
          paidAt: inst.paid_at
            ? typeof inst.paid_at === 'string'
              ? inst.paid_at
              : inst.paid_at.toISOString()
            : null,
          receiptToken: inst.receipt_token || null,
        })),
    }));

    // Fetch payment plan requests for this tenant
    const paymentPlanRequestRows = await paymentPlanRequestRowsPromise;

    const paymentPlanRequests = paymentPlanRequestRows.map((req) => ({
      id: req.id,
      propertyTenantId: req.property_tenant_id,
      propertyId: req.property_id,
      propertyName: req.property?.name || 'Property',
      totalAmount: parseFloat((req.total_amount ?? 0).toString()),
      status: req.status,
      preferredSchedule: req.preferred_schedule,
      createdAt: req.created_at
        ? new Date(req.created_at).toISOString()
        : new Date().toISOString(),
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
      numberOfCarsOwned: kycApplication?.parking_needs ?? null,
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
      maintenanceIssues: (account.maintenance_requests || []).map((sr) => ({
        id: sr.id,
        title: sr.issue_category,
        description: sr.description,
        status: sr.status || '——',
        reportedDate: new Date(sr.date_reported).toISOString(),
        resolvedDate: sr.resolution_date
          ? new Date(sr.resolution_date).toISOString()
          : null,
        priority: sr.is_urgent ? 'High' : 'Medium',
        images: (sr.issue_media || []).map((m) => m.url),
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

      // Outstanding Balance Info (computed by computeTenantBalance above)
      totalOutstandingBalance,
      totalCreditBalance,
      outstandingBalanceBreakdown,
      paymentTransactions,

      history: history,
      renewalInvoices: renewalInvoiceSummaries,
      adHocInvoices,
      paymentPlans,
      paymentPlanRequests,
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

      // Embed the full KYC application (same shape as GET /api/kyc-applications/:id)
      // so the frontend doesn't have to walk all applications or refetch by id.
      kycApplicationId: kycApplication?.id ?? null,
      kycApplication: kycApplication
        ? transformApplicationForFrontend(kycApplication)
        : null,
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
   * Helper to get maintenance request update description
   */
  private getMaintenanceRequestUpdateDescription(status: string): string {
    switch (status.toLowerCase()) {
      case 'resolved':
        return 'Issue fixed and marked as resolved.';
      case 'closed':
        return 'Tenant confirmed issue is fully resolved.';
      case 'reopened':
        return 'Tenant reopened the request: issue not fully resolved.';
      default:
        return 'Maintenance request updated.';
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

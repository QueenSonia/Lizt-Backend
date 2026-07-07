import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CreateAdminDto,
  CreateCustomerRepDto,
  CreateLandlordDto,
  CreateManagedLandlordDto,
  CreateTenantDto,
  CreateTenantKycDto,
  CreateUserDto,
  IUser,
  LoginDto,
  UpdateManagedLandlordDto,
  UserFilter,
} from './dto/create-user.dto';
import {
  AttachTenantToPropertyDto,
  RentFrequency,
} from './dto/attach-tenant-to-property.dto';
import { AttachTenantFromKycDto } from './dto/attach-tenant-from-kyc.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from './entities/user.entity';
import {
  ArrayContains,
  DataSource,
  In,
  Not,
  QueryRunner,
  Repository,
} from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AuthService } from 'src/auth/auth.service';
import { RolesEnum } from 'src/base.entity';
import { UtilService } from 'src/utils/utility-service';
import {
  clientSignUpEmailTemplate,
  clientSignUpWhatsappTemplate,
  EmailSubject,
} from 'src/utils/email-template';
import { buildUserFilter, buildUserFilterQB } from 'src/filters/query-filter';
import { Response } from 'express';
import moment from 'moment';
import { config } from 'src/config';
import {
  RentPaymentStatusEnum,
  RentStatusEnum,
} from 'src/rents/dto/create-rent.dto';
import { Rent } from 'src/rents/entities/rent.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { Property } from 'src/properties/entities/property.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import {
  PropertyStatusEnum,
  TenantStatusEnum,
} from 'src/properties/dto/create-property.dto';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { DateService } from 'src/utils/date.helper';
import { FileUploadService } from 'src/utils/cloudinary';
import { KYC } from './entities/kyc.entity';
import { CreateKycDto } from './dto/create-kyc.dto';
import { UpdateKycDto } from './dto/update-kyc.dto';
import bcrypt from 'bcryptjs/umd/types';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Account, LandlordType } from './entities/account.entity';
import { AnyAaaaRecord } from 'node:dns';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Team } from './entities/team.entity';
import { TeamMember } from './entities/team-member.entity';
import { WhatsappBotService } from 'src/whatsapp-bot/whatsapp-bot.service';
import { CacheService } from 'src/lib/cache';
import { Waitlist } from './entities/waitlist.entity';
import { TenantDetailDto } from 'src/users/dto/tenant-detail.dto';
import { time } from 'node:console';
import { TeamMemberDto } from 'src/users/dto/team-member.dto';
import {
  KYCApplication,
  ApplicationStatus,
} from 'src/kyc-links/entities/kyc-application.entity';
import { AccountCacheService } from 'src/auth/account-cache.service';
import { TenantManagementService } from './tenant-management';
import { TeamService, TeamMemberInput } from './team';
import { PasswordService } from './password';
import { isPlaceholderEmail } from 'src/utils/placeholder-email';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetRepository: Repository<PasswordResetToken>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
    @InjectRepository(Rent)
    private readonly rentRepository: Repository<Rent>,
    private readonly fileUploadService: FileUploadService,
    @InjectRepository(KYC)
    private readonly kycRepository: Repository<KYC>,
    private readonly eventEmitter: EventEmitter2,
    @InjectRepository(Account)
    private accountRepository: Repository<Account>,
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepository: Repository<TeamMember>,
    private readonly whatsappBotService: WhatsappBotService,
    @InjectRepository(Waitlist)
    private readonly waitlistRepository: Repository<Waitlist>,
    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepository: Repository<KYCApplication>,
    private readonly cache: CacheService,
    private readonly accountCacheService: AccountCacheService,
    private readonly tenantManagementService: TenantManagementService,
    private readonly teamService: TeamService,
    private readonly passwordService: PasswordService,

    private readonly utilService: UtilService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Add a new tenant with basic information
   * Delegates to TenantManagementService
   */
  async addTenant(user_id: string, dto: CreateTenantDto) {
    return this.tenantManagementService.addTenant(user_id, dto);
  }

  /**
   * Attach an existing tenant to a property
   * This allows tenants to be attached to multiple properties
   */
  /**
   * Attach an existing tenant to a property
   * Delegates to TenantManagementService
   */
  async attachTenantToProperty(
    tenantId: string,
    dto: AttachTenantToPropertyDto,
    landlordId: string,
  ): Promise<{
    success: boolean;
    message: string;
    tenantId: string;
    propertyId: string;
  }> {
    return this.tenantManagementService.attachTenantToProperty(
      tenantId,
      dto,
      landlordId,
    );
  }

  /**
   * Add a new tenant with KYC information
   * Delegates to TenantManagementService
   */
  async addTenantKyc(user_id: string, dto: CreateTenantKycDto) {
    return this.tenantManagementService.addTenantKyc(user_id, dto);
  }

  /**
   * Attach tenant from KYC application
   * Delegates to TenantManagementService
   */
  async attachTenantFromKyc(
    landlordId: string,
    dto: AttachTenantFromKycDto,
  ) {
    return this.tenantManagementService.attachTenantFromKyc(landlordId, dto);
  }

  async createUser(data: CreateUserDto, creatorId: string): Promise<Account> {
    const { email, phone_number } = data;
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const userRole = data?.role
        ? RolesEnum[data.role.toUpperCase()]
        : RolesEnum.TENANT;

      // Check if user already exists
      let user = await queryRunner.manager.findOne(Users, { where: { email } });

      if (!user) {
        user = await queryRunner.manager.save(Users, {
          email,
          phone_number,
          first_name: data.first_name,
          last_name: data.last_name,
          creator_id: userRole === RolesEnum.TENANT ? creatorId : null,
          gender: data.gender,
          marital_status: data.marital_status,
          employment_status: data.employment_status,
          date_of_birth: data.date_of_birth,
          state_of_origin: data.state_of_origin,
          lga: data.lga,
          nationality: data.nationality,
          rent_start_date: data.rent_start_date,
          property_id: data.property_id,
          rental_price: data.rental_price,
          security_deposit: data.security_deposit,
          service_charge: data.service_charge,
          // password: data.password,

          employer_name: data.employer_name,
          job_title: data.job_title,
          employer_address: data.employer_address,
          monthly_income: data.monthly_income,
          work_email: data.work_email,

          business_name: data.business_name,
          nature_of_business: data.nature_of_business,
          business_address: data.business_address,
          business_monthly_income: data.business_monthly_income,
          business_website: data.business_website,

          spouse_full_name: data.spouse_full_name,
          spouse_phone_number: data.spouse_phone_number,
          spouse_occupation: data.spouse_occupation,
          spouse_employer: data.spouse_employer,

          // Unemployed fields
          source_of_funds: data.source_of_funds,
          monthly_income_estimate: data.monthly_income_estimate,
        });
      }

      // Check for existing account
      const existingAccount = await queryRunner.manager.findOne(Account, {
        where: { email, roles: ArrayContains([userRole]) },
      });

      if (existingAccount) {
        throw new HttpException(
          `Account with email: ${email} already exists`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const property = await queryRunner.manager.findOne(Property, {
        where: { id: data.property_id },
      });

      if (!property?.id) {
        throw new HttpException(
          `Property with id: ${data.property_id} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      const hasActiveRent = await queryRunner.manager.exists(Rent, {
        where: {
          property_id: data.property_id,
          rent_status: RentStatusEnum.ACTIVE,
        },
      });

      if (hasActiveRent) {
        throw new HttpException(
          `Property is already rented out`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const tenantAccount = queryRunner.manager.create(Account, {
        user,
        creator_id: creatorId,
        email,
        roles: [userRole],
        profile_name: `${this.utilService.toSentenceCase(user.first_name)} ${this.utilService.toSentenceCase(user.last_name)}`,
        is_verified: false,
      });

      await queryRunner.manager.save(Account, tenantAccount);

      await queryRunner.manager.save(Rent, {
        tenant_id: tenantAccount.id,
        rent_start_date: data.rent_start_date,
        property_id: property.id,
        amount_paid: data.rental_price,
        rental_price: data.rental_price,
        security_deposit: data.security_deposit,
        service_charge: data.service_charge,
        payment_status: RentPaymentStatusEnum.PAID,
        rent_status: RentStatusEnum.ACTIVE,
      });

      await Promise.all([
        queryRunner.manager.save(PropertyTenant, {
          property_id: property.id,
          tenant_id: tenantAccount.id,
          status: TenantStatusEnum.ACTIVE,
        }),
        queryRunner.manager.update(Property, property.id, {
          property_status: PropertyStatusEnum.OCCUPIED,
          is_marketing_ready: false,
        }),
        queryRunner.manager.save(PropertyHistory, {
          property_id: property.id,
          tenant_id: tenantAccount.id,
          move_in_date: DateService.getStartOfTheDay(new Date()),
          monthly_rent: data.rental_price,
          owner_comment: null,
          tenant_comment: null,
          move_out_date: null,
          move_out_reason: null,
        }),
      ]);

      const token = await this.generatePasswordResetToken(
        tenantAccount.id,
        queryRunner,
      );

      const resetLink = `${this.configService.get<string>('FRONTEND_URL')}/reset-password?token=${token}`;
      const emailContent = clientSignUpEmailTemplate(
        user.first_name,
        resetLink,
      );
      const whatsappContent = clientSignUpWhatsappTemplate(
        user.first_name,
        resetLink,
      );

      const pandaEmail = this.configService.get<string>('GMAIL_USER')!;

      // Critical: this can throw — must stay *inside* transaction
      await Promise.all([
        this.utilService.sendEmail(
          email,
          EmailSubject.WELCOME_EMAIL,
          emailContent,
        ),
        this.utilService.sendEmail(
          pandaEmail,
          EmailSubject.WELCOME_EMAIL,
          emailContent,
        ),
        // this.twilioService.sendWhatsAppMessage(phone_number, whatsappContent),
      ]);

      await queryRunner.commitTransaction();

      this.eventEmitter.emit('user.added', {
        user_id: property.owner_id,
        property_id: data.property_id,
        property_name: property.name,
        profile_name: tenantAccount.profile_name,
        role: userRole,
      });

      const result = {
        ...tenantAccount,
        password_link: resetLink,
      };

      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('Transaction rolled back due to:', error);
      throw new HttpException(
        error?.message || 'An error occurred while creating user',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    } finally {
      await queryRunner.release();
    }
  }

  async createUserOld(data: CreateUserDto, user_id: string): Promise<IUser> {
    const { email, phone_number } = data;

    const emailExist = await this.usersRepository.exists({ where: { email } });
    if (emailExist) {
      throw new HttpException(
        `User with email: ${email} already exist`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const queryRunner =
      this.usersRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const userRole = data?.role
        ? RolesEnum[data?.role.toUpperCase()]
        : RolesEnum.TENANT;

      const newUser: IUser = {
        ...data,
        creator_id: userRole === RolesEnum.TENANT ? user_id : null,
      };

      const createdUser = await queryRunner.manager.save(Users, newUser);

      if (!createdUser?.id) {
        throw new Error('User ID is missing after creation');
      }

      await queryRunner.manager.save(Account, {
        roles: [userRole],
        user: createdUser,
        profile_name: `${createdUser.first_name || 'User'}'s ${userRole} Account`,
      });

      const property = await queryRunner.manager.findOne(Property, {
        where: {
          id: data.property_id,
        },
      });

      if (!property?.id) {
        throw new HttpException(
          `Property with id: ${data?.property_id} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      const hasActiveRent = await queryRunner.manager.exists(Rent, {
        where: {
          property_id: data?.property_id,
          rent_status: Not(RentStatusEnum.ACTIVE),
        },
      });

      if (hasActiveRent) {
        throw new HttpException(
          `Property with id: ${data?.property_id} is already rented`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const rent = {
        tenant_id: createdUser.id,
        rent_start_date: data?.rent_start_date,
        property_id: property?.id,
        amount_paid: data?.rental_price,
        rental_price: data?.rental_price,
        security_deposit: data?.security_deposit,
        service_charge: data?.service_charge,
        payment_status: RentPaymentStatusEnum.PAID,
        rent_status: RentStatusEnum.ACTIVE,
      };
      await queryRunner.manager.save(Rent, rent);

      await queryRunner.manager.save(PropertyTenant, {
        property_id: property.id,
        tenant_id: createdUser.id,
        status: TenantStatusEnum.ACTIVE,
      });

      await queryRunner.manager.update(Property, property.id, {
        property_status: PropertyStatusEnum.OCCUPIED,
        is_marketing_ready: false,
      });

      await queryRunner.manager.save(PropertyHistory, {
        property_id: property?.id,
        tenant_id: createdUser?.id,
        move_in_date: DateService.getStartOfTheDay(new Date()),
        monthly_rent: data?.rental_price,
        owner_comment: null,
        tenant_comment: null,
        move_out_date: null,
        move_out_reason: null,
      });

      // const token = await this.generatePasswordResetToken(
      //   createdUser?.id,
      //   queryRunner,
      // );

      // const emailContent = clientSignUpEmailTemplate(
      //   `${this.configService.get<string>('FRONTEND_URL')}/reset-password?token=${token}`,
      // );

      // await this.utilService.sendEmail(
      //   email,
      //   EmailSubject.WELCOME_EMAIL,
      //   emailContent,
      // );

      await queryRunner.commitTransaction();

      this.eventEmitter.emit('user.added', {
        user_id: property.owner_id,
        property_id: data.property_id,
        property_name: property.name,
        role: userRole,
      });
      return createdUser;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw new HttpException(
        error?.message || 'An error occurred while creating user',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Generates a password reset token for a user.
   * Delegates to PasswordService.
   */
  async generatePasswordResetToken(
    userId: string,
    queryRunner: QueryRunner,
  ): Promise<string> {
    return this.passwordService.generatePasswordResetToken(userId, queryRunner);
  }

  async getAllUsers(queryParams: UserFilter) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const query = await buildUserFilter(queryParams);
    const [users, count] = await this.usersRepository.findAndCount({
      where: query,
      skip,
      take: size,
      order: { created_at: 'DESC' },
      relations: ['property_tenants', 'property_tenants.property'],
    });

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
   * Get all tenants with pagination
   * Delegates to TenantManagementService
   */
  async getAllTenants(queryParams: UserFilter) {
    return this.tenantManagementService.getAllTenants(queryParams);
  }

  async getUserById(id: string): Promise<IUser> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user?.id) {
      throw new HttpException(
        `User with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return user;
  }

  async getAccountById(id: string): Promise<any> {
    const user = await this.accountRepository.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!user?.id) {
      throw new HttpException(
        `User with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return user;
  }

  async getUserFields(
    user_id: string,
    fields: string[],
  ): Promise<Partial<IUser>> {
    const selectFields = fields.reduce(
      (acc, field) => {
        acc[field] = true;
        return acc;
      },
      {} as Record<string, boolean>,
    );

    const user = await this.usersRepository.findOne({
      where: { id: user_id },
      select: selectFields,
    });

    if (!user) {
      throw new HttpException(
        `User with id: ${user_id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return user;
  }

  async updateUserById(id: string, data: UpdateUserDto) {
    const account = await this.accountRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!account?.id) {
      throw new NotFoundException(`Account with userId: ${id} not found`);
    }

    // Separate account fields from user fields
    const {
      profile_name,
      preferences,
      branding,
      offer_letter_template,
      ...userFields
    } = data;

    // Update account table fields
    const accountUpdates: any = {};

    if (profile_name !== undefined) {
      accountUpdates.profile_name = profile_name;
    } else if (data.first_name && data.last_name) {
      // Generate profile_name from first_name and last_name if not provided
      accountUpdates.profile_name = `${data.first_name} ${data.last_name}`;
    }

    if (Object.keys(accountUpdates).length > 0) {
      await this.accountRepository.update(account.id, accountUpdates);
    }

    // Update user table fields (first_name, last_name, email, phone_number, preferences, branding)
    const userUpdates: any = { ...userFields };

    if (preferences !== undefined) {
      userUpdates.preferences = preferences;
    }

    if (branding !== undefined) {
      userUpdates.branding = branding;
    }

    if (offer_letter_template !== undefined) {
      userUpdates.offer_letter_template = offer_letter_template;
    }

    // Only update if there are user fields to update
    if (Object.keys(userUpdates).length > 0) {
      await this.usersRepository.update(account.userId, userUpdates);
    }

    // Invalidate account cache after update
    await this.accountCacheService.invalidate(account.id);

    // Return updated account with user
    return this.accountRepository.findOne({
      where: { id: account.id },
      relations: ['user'],
    });
  }

  async deleteUserById(id: string) {
    // Soft-delete only. A hard delete cascades through accounts → rents →
    // property_tenants (ON DELETE CASCADE on every FK), silently emptying
    // tenancy state on every landlord this user appears on while leaving
    // property_status='occupied' behind — exactly the orphaned-property
    // shape the "Fix Status" banner catches after the fact.
    return this.usersRepository.softDelete(id);
  }

  async loginUser(data: LoginDto, res: Response, req?: any) {
    const { identifier, password } = data;

    // Determine if identifier is email or phone
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    const isPhone = /^[+]?[\d\s\-()]{10,}$/.test(identifier.replace(/\s/g, ''));

    if (!isEmail && !isPhone) {
      throw new BadRequestException('Invalid email or phone number format');
    }

    // Normalize once so the rate-limit bucket and the DB lookup use the same
    // value — otherwise "+234…", "234…", "0…" each get their own counter and
    // a lockout under one format can't be cleared by retrying with another.
    // Phone uses the shared canonical normalizer so it matches the stored
    // users.phone_number for any country (NG local 0… included). Non-Nigerian
    // numbers must include their country code (e.g. +44…) to resolve.
    const normalizedIdentifier = isEmail
      ? identifier.toLowerCase().trim()
      : this.utilService.normalizePhoneNumber(identifier);

    const rateLimitKey = `login_attempts:${normalizedIdentifier}`;
    const attempts = await this.cache.get(rateLimitKey);

    if (attempts && parseInt(attempts) >= 5) {
      throw new HttpException(
        'Too many login attempts. Please try again in 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Match by email OR by user.phone_number — no role filter, since multi-role
    // login needs to see every role attached to this identity.
    const whereCondition = isEmail
      ? { email: normalizedIdentifier }
      : { user: { phone_number: normalizedIdentifier } };

    const account = await this.accountRepository.findOne({
      where: whereCondition,
      relations: ['user'],
    });

    if (!account) {
      throw new NotFoundException(
        `User with ${isEmail ? 'email' : 'phone number'}: ${identifier} not found`,
      );
    }

    if (!account.is_verified) {
      throw new NotFoundException(`Your account is not verified`);
    }

    // Validate password
    const isPasswordValid = await this.utilService.validatePassword(
      password,
      account.password,
    );

    if (!isPasswordValid) {
      // incrementWithTtlNx so TTL is set on the first failure and never
      // refreshed — otherwise a user mashing wrong-password keeps extending
      // their own 15-minute lockout window indefinitely.
      await this.cache.incrementWithTtlNx(rateLimitKey, 15 * 60);

      throw new UnauthorizedException('Incorrect password');
    }

    // Clear rate limit on successful login
    await this.cache.delete(rateLimitKey);

    // Only admins (property managers) and facility managers may access the
    // dashboard. Landlords no longer sign in — their property manager operates
    // on their behalf — and tenants use WhatsApp, not the dashboard.
    const allowedRoles = (account.roles ?? []).filter(
      (r) => r === RolesEnum.ADMIN || r === RolesEnum.FACILITY_MANAGER,
    );

    if (allowedRoles.length === 0) {
      const isLandlord = (account.roles ?? []).includes(RolesEnum.LANDLORD);
      throw new ForbiddenException(
        isLandlord
          ? 'Landlord accounts no longer sign in here — your property manager now manages your properties on your behalf.'
          : 'This account does not have access to the dashboard.',
      );
    }

    if (allowedRoles.length === 1) {
      return this.issueSession(account, allowedRoles[0], res, req);
    }

    // Multi-role: hand back a 5-min role-selection ticket. NO session cookies set.
    const roleSelectionToken = await this.authService.generateRoleSelectionTicket({
      accountId: account.id,
      userId: account.user.id,
      availableRoles: allowedRoles,
    });

    return res.status(HttpStatus.OK).json({
      requiresRoleSelection: true,
      roleSelectionToken,
      availableRoles: allowedRoles,
    });
  }

  /**
   * Exchange a role-selection ticket for a real session. Called after the
   * multi-role login flow when the user has picked a role from the picker.
   */
  async selectRoleAfterLogin(
    data: { roleSelectionToken: string; role: RolesEnum },
    res: Response,
    req?: any,
  ) {
    let payload: { accountId: string; userId: string; availableRoles: string[] };
    try {
      payload = await this.authService.verifyRoleSelectionTicket(
        data.roleSelectionToken,
      );
    } catch (err) {
      // Expired, malformed, or wrong purpose → ask the user to sign in again.
      throw new UnauthorizedException(
        'Role-selection session expired. Please sign in again.',
      );
    }

    if (!payload.availableRoles.includes(data.role)) {
      throw new ForbiddenException(
        'Selected role is not available for this account.',
      );
    }

    const account = await this.accountRepository.findOne({
      where: { id: payload.accountId },
      relations: ['user'],
    });

    if (!account) {
      throw new UnauthorizedException('Account no longer exists.');
    }

    return this.issueSession(account, data.role, res, req);
  }

  /**
   * Mint access + refresh tokens, set cookies, return the user shape.
   * Shared between single-role login and the post-picker select-role exchange.
   */
  private async issueSession(
    account: Account,
    activeRole: RolesEnum,
    res: Response,
    req?: any,
  ) {
    const tokenPayload = {
      id: account.id,
      first_name: account.user.first_name,
      last_name: account.user.last_name,
      email: account.email,
      phone_number: account.user.phone_number,
      role: activeRole,
    };

    const access_token =
      await this.authService.generateAccessToken(tokenPayload);
    const refresh_token = await this.authService.generateRefreshToken(
      account.id,
      activeRole,
      req?.headers?.['user-agent'] || 'unknown',
      req?.ip || req?.connection?.remoteAddress || 'unknown',
    );

    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    res.cookie('access_token', access_token, {
      httpOnly: true,
      secure: isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });

    res.cookie('refresh_token', refresh_token, {
      httpOnly: true,
      secure: isProduction,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });

    return res.status(HttpStatus.OK).json({
      user: {
        id: account.id,
        first_name: account.user.first_name,
        last_name: account.user.last_name,
        email: account.email,
        phone_number: account.user.phone_number,
        profile_name: account.profile_name,
        role: activeRole,
        roles: account.roles ?? [],
        is_verified: account.is_verified,
        logo_urls: account.user.logo_urls,
        creator_id: account.creator_id,
        created_at: account.user.created_at,
        updated_at: account.user.updated_at,
      },
    });
  }

  // async loginUserOld(data: LoginDto, res: Response) {
  //   const { email, password } = data;

  //   const account = await this.accountRepository.findOne({
  //     where: { email },
  //     relations: ['user'],
  //   });
  //   if (!account?.id) {
  //     throw new NotFoundException(`User with email: ${data.email} not found`);
  //   }

  //   if (account?.password) {
  //     const isPasswordValid = await UtilService.validatePassword(
  //       password,
  //       account?.password,
  //     );
  //     if (!isPasswordValid) {
  //       throw new UnauthorizedException('Invalid password');
  //     }
  //   } else {
  //     const hashedPassword = await UtilService.hashPassword(password);
  //     await this.accountRepository.update(
  //       { email },
  //       { password: hashedPassword, is_verified: true },
  //     );
  //   }

  //   const userObject = {};
  //   if (account?.role === RolesEnum.TENANT) {
  //     const findTenantProperty = await this.propertyTenantRepository.findOne({
  //       where: {
  //         tenant_id: account.id,
  //       },
  //     });
  //     userObject['property_id'] = findTenantProperty?.property_id;
  //   }
  //   const tokenData = {
  //     id: account?.id,
  //     first_name: account.user.first_name,
  //     last_name: account.user.last_name,
  //     email: account.email,
  //     phone_number: account.user.phone_number,
  //     role: account.role,
  //   } as any;

  //   const access_token = await this.authService.generateToken(tokenData);

  //   res.cookie('access_token', access_token, {
  //     httpOnly: true,
  //     secure: this.configService.get<string>('NODE_ENV') === 'production', // Set to true in production for HTTPS
  //     expires: moment().add(8, 'hours').toDate(),
  //     sameSite: 'none',
  //   });

  //   return res.status(HttpStatus.OK).json({
  //     user: {
  //       ...userObject,
  //       id: account?.id,
  //       first_name: account.user?.first_name,
  //       last_name: account.user?.last_name,
  //       email: account?.email,
  //       phone_number: account.user?.phone_number,
  //       role: account?.role,
  //       is_verified: account?.is_verified,
  //       logo_urls: account.user?.logo_urls,
  //       creator_id: account.user?.creator_id,
  //       created_at: account.user?.created_at,
  //       updated_at: account.user?.updated_at,
  //     },
  //     access_token,
  //     expires_at: moment().add(8, 'hours').format(),
  //   });
  // }

  async logoutUser(res: Response) {
    const refreshToken = res.req.cookies['refresh_token'];

    // Revoke refresh token if it exists
    if (refreshToken) {
      await this.authService.revokeRefreshToken(refreshToken);
    }

    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    res.clearCookie('access_token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });

    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });

    res.clearCookie('sub_access_token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });

    res.clearCookie('parent_access_token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });

    return res.status(HttpStatus.OK).json({
      message: 'Logout successful',
    });
  }

  /**
   * Get tenant and property info for a tenant
   * Delegates to TenantManagementService
   */
  async getTenantAndPropertyInfo(tenant_id: string) {
    return this.tenantManagementService.getTenantAndPropertyInfo(tenant_id);
  }

  /**
   * Initiates the forgot password flow.
   * Delegates to PasswordService.
   */
  async forgotPassword(identifier: string) {
    return this.passwordService.forgotPassword(identifier);
  }

  /**
   * Validates an OTP entered by the user.
   * Delegates to PasswordService.
   */
  async validateOtp(otp: string) {
    return this.passwordService.validateOtp(otp);
  }

  /**
   * Resends an OTP to the user's email.
   * Delegates to PasswordService.
   */
  async resendOtp(oldToken: string) {
    return this.passwordService.resendOtp(oldToken);
  }

  /**
   * Resets the user's password using a valid token.
   * Delegates to PasswordService.
   */
  async resetPassword(payload: ResetPasswordDto, res: Response) {
    return this.passwordService.resetPassword(payload, res);
  }

  /**
   * Change password for authenticated user
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const account = await this.accountRepository.findOne({
      where: { id: userId },
    });

    if (!account) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const isPasswordValid = await this.utilService.validatePassword(
      currentPassword,
      account.password,
    );

    if (!isPasswordValid) {
      throw new HttpException(
        'Current password is incorrect',
        HttpStatus.BAD_REQUEST,
      );
    }

    const hashedPassword = await this.utilService.hashPassword(newPassword);

    await this.accountRepository.update(account.id, {
      password: hashedPassword,
    });

    await this.accountCacheService.invalidate(account.id);

    return { message: 'Password changed successfully' };
  }

  /**
   * Get tenants of a specific admin/landlord
   * Delegates to TenantManagementService
   */
  async getManagedTenants(landlordIds: string[], queryParams: UserFilter) {
    return this.tenantManagementService.getManagedTenants(
      landlordIds,
      queryParams,
    );
  }

  /**
   * Get a single tenant of an admin with full details
   * Delegates to TenantManagementService
   */
  async getManagedTenant(tenantId: string, landlordIds: string[]) {
    return this.tenantManagementService.getManagedTenant(
      tenantId,
      landlordIds,
    );
  }

  async getTenantBalance(tenantId: string, landlordIds: string[]) {
    return this.tenantManagementService.getTenantBalance(
      tenantId,
      landlordIds,
    );
  }

  /**
   * Flat active-tenancy list for the admin Tenancies screen.
   * Delegates to TenantManagementService
   */
  async getManagedTenancies(landlordIds: string[]) {
    return this.tenantManagementService.getManagedTenancies(landlordIds);
  }

  /**
   * All invoices + payment plans for one active tenancy (admin Invoices
   * page). Delegates to TenantManagementService.
   */
  async getTenancyInvoices(propertyTenantId: string, landlordIds: string[]) {
    return this.tenantManagementService.getTenancyInvoices(
      propertyTenantId,
      landlordIds,
    );
  }

  async uploadLogos(
    userId: string,
    files: Express.Multer.File[],
  ): Promise<Users> {
    const user = await this.usersRepository.findOne({
      where: {
        id: userId,
        accounts: { roles: ArrayContains([RolesEnum.LANDLORD]) },
      },
      relations: ['accounts'],
    });

    if (!user) {
      throw new HttpException('Admin not found', HttpStatus.NOT_FOUND);
    }

    try {
      const uploadedUrls = await Promise.all(
        files.map((file) =>
          this.fileUploadService.uploadFile(file, 'admin-logos'),
        ),
      );

      const updatedUser = await this.usersRepository.save({
        ...user,
        logo_urls: uploadedUrls.map((upload) => upload.secure_url),
      });

      return updatedUser;
    } catch (error) {
      throw new HttpException(
        'Error uploading logos',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async uploadBrandingAsset(
    accountId: string,
    file: Express.Multer.File,
    assetType: 'letterhead' | 'signature',
  ): Promise<{ url: string; assetType: string }> {
    console.log('uploadBrandingAsset called with accountId:', accountId);
    console.log('File received:', file ? 'Yes' : 'No');
    console.log('Asset type:', assetType);

    // Find account with user relation
    const account = await this.accountRepository.findOne({
      where: { id: accountId },
      relations: ['user'],
    });

    console.log('Account found:', account ? 'Yes' : 'No');
    console.log('User in account:', account?.user ? 'Yes' : 'No');

    if (!account || !account.user) {
      throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
    }

    if (!file) {
      throw new HttpException('No file provided', HttpStatus.BAD_REQUEST);
    }

    try {
      // Upload to Cloudinary in branding folder
      const uploadResult = await this.fileUploadService.uploadFile(
        file,
        `branding/${assetType}`,
      );

      console.log('Upload successful, URL:', uploadResult.secure_url);

      // Update user's branding data with the Cloudinary URL
      const updatedBranding = {
        ...account.user.branding,
        [assetType]: uploadResult.secure_url,
        updatedAt: new Date().toISOString(),
      };

      await this.usersRepository.update(account.user.id, {
        branding: updatedBranding,
      });

      console.log('Branding updated successfully');

      return {
        url: uploadResult.secure_url,
        assetType,
      };
    } catch (error) {
      console.error('Error in uploadBrandingAsset:', error);
      throw new HttpException(
        `Error uploading ${assetType}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async createUserKyc(userId: string, data: CreateKycDto): Promise<KYC> {
    const queryRunner =
      this.accountRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const user = await queryRunner.manager.findOne(Account, {
        where: { id: userId },
        relations: ['kyc'],
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (user.kyc) {
        throw new BadRequestException('KYC already submitted');
      }

      const newKyc = this.kycRepository.create({
        ...data,
        user,
      });

      const savedKyc = await queryRunner.manager.save(KYC, newKyc);

      user.is_verified = true;
      await queryRunner.manager.save(Account, user);

      await queryRunner.commitTransaction();
      return savedKyc;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw new HttpException(
        error?.message || 'An error occurred while submitting KYC',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    } finally {
      await queryRunner.release();
    }
  }

  async update(userId: string, updateKycDto: UpdateKycDto): Promise<KYC> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      relations: ['kyc'],
    });

    if (!user || !user.kyc) {
      throw new NotFoundException('KYC record not found for this user');
    }

    const updatedKyc = this.kycRepository.merge(user.kyc, updateKycDto);
    return this.kycRepository.save(updatedKyc);
  }

  async createLandlord(
    data: CreateLandlordDto,
  ): Promise<Omit<Users, 'password'>> {
    if (!data.password) {
      throw new BadRequestException('Password is required');
    }

    const hashedPassword = await this.utilService.hashPassword(data.password);

    // Look up an existing account by email, then fall back to phone (via the
    // linked user) so we catch legacy placeholder-email FM rows that share a
    // phone with this landlord. See team.service.ts for the same pattern.
    let existingAccount = await this.accountRepository.findOne({
      where: { email: data.email },
      relations: ['user'],
    });

    if (!existingAccount && data.phone_number) {
      existingAccount = await this.accountRepository.findOne({
        where: { user: { phone_number: data.phone_number } },
        relations: ['user'],
      });
    }

    if (existingAccount?.roles?.includes(RolesEnum.LANDLORD)) {
      throw new BadRequestException(
        'Landlord Account with this email already exists',
      );
    }

    // If we hit by phone but the existing account holds a different REAL email,
    // that's a real-data conflict — same phone bound to two different people.
    if (
      existingAccount &&
      existingAccount.email !== data.email &&
      !isPlaceholderEmail(existingAccount.email) &&
      !isPlaceholderEmail(data.email)
    ) {
      throw new BadRequestException(
        `Phone ${data.phone_number} is already linked to a different account (${existingAccount.email}).`,
      );
    }

    let user =
      existingAccount?.user ??
      (await this.usersRepository.findOne({
        where: { phone_number: data.phone_number },
      }));

    if (!user) {
      user = await this.usersRepository.save({
        phone_number: data.phone_number,
        first_name: data.first_name,
        last_name: data.last_name,
        role: RolesEnum.LANDLORD,
        is_verified: true,
        email: data.email,
      });
    }

    if (existingAccount) {
      // Email reconciliation: if existing email is placeholder and incoming is
      // real, upgrade. Otherwise keep existing.
      if (
        existingAccount.email !== data.email &&
        isPlaceholderEmail(existingAccount.email) &&
        !isPlaceholderEmail(data.email)
      ) {
        existingAccount.email = data.email;
      }

      // Promote: append LANDLORD to roles[] and overwrite password with the
      // user-chosen one. The landlord-set password becomes the canonical
      // credential for this identity going forward — multi-role login then
      // resolves the picker between Landlord and any other roles they hold.
      existingAccount.roles = Array.from(
        new Set([...(existingAccount.roles ?? []), RolesEnum.LANDLORD]),
      );
      existingAccount.password = hashedPassword;
      existingAccount.profile_name =
        existingAccount.profile_name ?? data.agency_name;
      existingAccount.is_verified = true;
      await this.accountRepository.save(existingAccount);
      await this.accountCacheService.invalidate(existingAccount.id);
    } else {
      const landlordAccount = this.accountRepository.create({
        user,
        email: data.email,
        password: hashedPassword,
        roles: [RolesEnum.LANDLORD],
        profile_name: data.agency_name,
        is_verified: true,
      });

      await this.accountRepository.save(landlordAccount);
    }

    const { password, ...result } = user;
    return result as Omit<Users, 'password'>;
  }

  async createAdmin(data: CreateAdminDto): Promise<Omit<Users, 'password'>> {
    const existingAccount = await this.accountRepository.findOne({
      where: { email: data.email, roles: ArrayContains([RolesEnum.ADMIN]) },
    });

    if (existingAccount) {
      throw new BadRequestException(
        'Admin Account with this email already exists',
      );
    }

    if (!data.password) {
      throw new BadRequestException('Password is required');
    }

    let user = await this.usersRepository.findOne({
      where: { phone_number: data.phone_number },
    });
    console.log({ user });
    if (!user) {
      user = await this.usersRepository.save({
        phone_number: data.phone_number,
        first_name: data.first_name,
        last_name: data.last_name,
        role: RolesEnum.ADMIN,
        is_verified: true,
        email: data.email,
      });

      console.log('user', user);
    }

    const adminAccount = this.accountRepository.create({
      user,
      email: data.email,
      password: await this.utilService.hashPassword(data.password),
      roles: [RolesEnum.ADMIN],
      profile_name: `${user.first_name}'s Admin Account`,
      is_verified: true,
    });

    await this.accountRepository.save(adminAccount);

    const { password, ...result } = user;
    return result as Omit<Users, 'password'>;
  }
  //create user that are admin
  async createAdminOld(data: CreateAdminDto): Promise<Omit<Users, 'password'>> {
    const existing = await this.usersRepository.findOne({
      where: { email: data.email },
    });

    if (existing) {
      throw new BadRequestException('User with this email already exists');
    }

    if (!data.password) {
      throw new BadRequestException('Password is required');
    }

    const hashedPassword = await this.utilService.hashPassword(data.password);

    const user = this.usersRepository.create({
      ...data,
      password: hashedPassword,
      is_verified: true,
    });

    const savedUser = await this.usersRepository.save(user);

    await this.accountRepository.save({
      roles: [RolesEnum.LANDLORD],
      user: savedUser,
      profile_name: `${savedUser.first_name}'s Admin Account`,
    });

    const { password, ...result } = savedUser;
    return result as Omit<Users, 'password'>;
  }

  async createCustomerRep(
    data: CreateCustomerRepDto,
  ): Promise<Omit<Users, 'password'>> {
    const queryRunner = this.dataSource.createQueryRunner();
    const existingAccount = await this.accountRepository.findOne({
      where: { email: data.email, roles: ArrayContains([RolesEnum.REP]) },
    });

    if (existingAccount) {
      throw new BadRequestException(
        'Rep Account with this email already exists',
      );
    }

    // if (!data.password) {
    //   throw new BadRequestException('Password is required');
    // }

    let user = await this.usersRepository.findOne({
      where: { email: data.email },
    });

    if (!user) {
      user = await this.usersRepository.save({
        phone_number: data.phone_number,
        first_name: data.first_name,
        last_name: data.last_name,
        is_verified: true,
        email: data.email,
      });

      console.log('user', user);
    }

    const repAccount = this.accountRepository.create({
      user,
      email: data.email,
      password: data.password
        ? await this.utilService.hashPassword(data.password)
        : '',
      roles: [RolesEnum.REP],
      profile_name: `${data.first_name} ${data.last_name}`,
      is_verified: true,
    });

    await this.accountRepository.save(repAccount);

    const token = await this.generatePasswordResetToken(
      repAccount.id,
      queryRunner,
    );

    const resetLink = `${this.configService.get<string>('FRONTEND_URL')}/reset-password?token=${token}`;
    const emailContent = clientSignUpEmailTemplate(data.first_name, resetLink);

    await this.utilService.sendEmail(
      data.email,
      EmailSubject.WELCOME_EMAIL,
      emailContent,
    );
    const { password, ...result } = user;
    return result as Omit<Users, 'password'>;
  }

  async getSubAccounts(adminId: string): Promise<Account[]> {
    // from JWT
    const subAccounts = await this.accountRepository.find({
      where: {
        creator_id: adminId,
        // is_sub_account: true,
      },
      relations: ['user'],
    });

    return subAccounts;
  }

  async switchAccount({
    targetAccountId,
    currentAccount,
    res,
  }: {
    targetAccountId: string;
    currentAccount: any;
    res: Response;
  }) {
    const target = await this.accountRepository.findOne({
      where: { id: targetAccountId },
      relations: ['user'], // you need this to access target.user.*
    });

    if (!target || target.creator_id !== currentAccount.id) {
      throw new ForbiddenException('You cannot switch to this account');
    }

    const tokenPayload = {
      id: target.id,
      first_name: target.user.first_name,
      last_name: target.user.last_name,
      email: target.email,
      phone_number: target.user.phone_number,
      role: target.roles?.[0],
    } as any;

    const access_token = await this.authService.generateToken(tokenPayload);

    res.cookie('access_token', access_token, {
      httpOnly: true,
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      expires: moment().add(8, 'hours').toDate(),
      sameSite: 'none',
    });

    return { success: true, message: 'Switched account successfully' };
  }

  /**
   * Assigns a collaborator to a landlord's team.
   * Delegates to TeamService.
   */
  async assignCollaboratorToTeam(
    user_id: string,
    team_member: TeamMemberInput,
  ) {
    return this.teamService.assignCollaboratorToTeam(user_id, team_member);
  }

  /**
   * Gets team members for the team owned by a landlord.
   * Delegates to TeamService.
   * @param requester the authenticated account making the request
   */
  async getTeamMembers(requester: Account): Promise<TeamMemberDto[]> {
    return this.teamService.getTeamMembers(requester);
  }

  /**
   * Landlords the requesting facility manager is teamed with, with each
   * landlord's open-request count for the requester. Empty array for
   * non-FM callers.
   */
  async getMyLandlords(requesterUserId: string) {
    return this.teamService.getMyLandlords(requesterUserId);
  }

  /**
   * Updates a team member's details (name and phone).
   * Delegates to TeamService.
   * @param id team member ID
   * @param data updated name and phone
   * @param requester the authenticated account making the request
   */
  async updateTeamMember(
    id: string,
    data: { name: string; phone: string },
    requester: Account,
  ) {
    return this.teamService.updateTeamMember(id, data, requester);
  }

  /**
   * Deletes a team member.
   * Delegates to TeamService.
   * @param id team member ID
   * @param requester the authenticated account making the request
   */
  async deleteTeamMember(id: string, requester: Account) {
    return this.teamService.deleteTeamMember(id, requester);
  }

  async getWhatsappText(from, message) {
    return await this.whatsappBotService.sendText(from, message);
  }

  async sendPropertiesNotification({ phone_number, name, property_name }) {
    return await this.whatsappBotService.sendToPropertiesCreatedTemplate({
      phone_number,
      name,
      property_name,
    });
  }

  async sendUserAddedTemplate({ phone_number, name, user, property_name }) {
    return await this.whatsappBotService.sendUserAddedTemplate({
      phone_number,
      name,
      user,
      property_name,
    });
  }
  async getWaitlist() {
    return await this.waitlistRepository.find();
  }

  async getLandlords() {
    return await this.usersRepository.find({
      where: {
        accounts: { roles: ArrayContains([RolesEnum.LANDLORD]) },
      },
      relations: ['accounts'],
    });
  }

  /**
   * Property-manager (admin) creates a MANAGED landlord — login-disabled (no
   * password), parented to the admin via `creator_id`. The landlord never signs
   * in; the admin operates on their behalf and all tenant-facing docs carry the
   * Property Kraft brand.
   *
   * Accounts can be entangled (a person may already be a tenant/FM) and
   * email/phone are unique — so we find-or-append the LANDLORD role to an
   * existing identity instead of failing on the unique indexes. Mirrors the
   * reconciliation in createLandlord / assignCollaboratorToTeam.
   */
  async createManagedLandlord(
    adminId: string,
    data: CreateManagedLandlordDto,
  ): Promise<Account> {
    return await this.dataSource.transaction(async (manager) => {
      const admin = await manager.getRepository(Account).findOne({
        where: { id: adminId },
        select: { id: true, roles: true },
      });
      if (!admin?.roles?.includes(RolesEnum.ADMIN)) {
        throw new ForbiddenException('Only administrators can add landlords');
      }

      const email = (data.email ?? '').trim().toLowerCase();
      const phone = data.phone_number; // normalized by the DTO transformer
      const isCorporate = data.landlord_type === LandlordType.CORPORATE;
      const firstName = (data.first_name ?? '').trim();
      const lastName = (data.last_name ?? '').trim();
      const businessName = (data.business_name ?? '').trim();

      if (isCorporate && !businessName) {
        throw new BadRequestException(
          'A business name is required for corporate landlords',
        );
      }
      if (!isCorporate && !firstName) {
        throw new BadRequestException(
          "An individual landlord's first name is required",
        );
      }

      // Display name: corporate → business name; individual → first + last.
      const profileName = isCorporate
        ? businessName
        : `${firstName} ${lastName}`.trim();
      // users.first_name is NOT NULL — a corporate landlord with no contact name
      // falls back to the business name.
      const userFirstName = firstName || businessName;

      // A "new" landlord may already exist (tenant/FM). Look up by email, then
      // by phone via the linked user.
      let account = await manager.getRepository(Account).findOne({
        where: { email },
        relations: ['user'],
      });
      if (!account && phone) {
        account = await manager.getRepository(Account).findOne({
          where: { user: { phone_number: phone } },
          relations: ['user'],
        });
      }

      if (account?.roles?.includes(RolesEnum.LANDLORD)) {
        throw new ConflictException(
          'A landlord account with this email or phone already exists',
        );
      }
      // Same phone bound to a different REAL email → real-data conflict.
      if (
        account &&
        account.email !== email &&
        !isPlaceholderEmail(account.email) &&
        !isPlaceholderEmail(email)
      ) {
        throw new ConflictException(
          `Phone ${phone} is already linked to a different account (${account.email}).`,
        );
      }

      // Find-or-create the underlying user row (dedup by phone, then email).
      let user =
        account?.user ??
        (await manager.getRepository(Users).findOne({
          where: { phone_number: phone },
        }));
      if (!user) {
        user = await manager
          .getRepository(Users)
          .findOne({ where: { email } });
      }
      if (!user) {
        user = await manager.getRepository(Users).save({
          email,
          phone_number: phone,
          first_name: userFirstName,
          last_name: lastName,
          is_verified: true,
        });
      }

      if (account) {
        // Existing identity → make them a managed landlord: append the role,
        // parent to this admin, set the type. Their password (for any other
        // role) is left untouched — landlords just get no dashboard.
        if (
          account.email !== email &&
          isPlaceholderEmail(account.email) &&
          !isPlaceholderEmail(email)
        ) {
          account.email = email; // self-heal placeholder → real email
        }
        account.roles = Array.from(
          new Set([...(account.roles ?? []), RolesEnum.LANDLORD]),
        );
        account.creator_id = admin.id;
        account.landlord_type = data.landlord_type;
        // Corporate display name must be the business name; for an individual
        // keep any existing display name, else set first+last.
        account.profile_name = isCorporate
          ? profileName
          : account.profile_name ?? profileName;
        account.is_verified = true;
        await manager.getRepository(Account).save(account);
        await this.accountCacheService.invalidate(account.id);
        return account;
      }

      // Brand-new identity → login-disabled managed landlord (no password).
      const landlord = manager.getRepository(Account).create({
        user,
        email,
        roles: [RolesEnum.LANDLORD],
        creator_id: admin.id,
        landlord_type: data.landlord_type,
        profile_name: profileName,
        is_verified: true,
      });
      await manager.getRepository(Account).save(landlord);
      return landlord;
    });
  }

  /**
   * Clean, admin-scoped list of the landlords a property manager manages — one
   * row per landlord ACCOUNT (id = the owner_id used across the system), with a
   * resolved display name + type. Backs the landlord picker (act-on-behalf) and
   * the Landlords management screen. Scoped by creator_id so it is multi-PM
   * correct — unlike the legacy getLandlords(), which returns every landlord
   * globally and is keyed on the User row.
   */
  async getManagedLandlords(adminId: string): Promise<
    Array<{
      id: string;
      name: string;
      landlord_type: LandlordType | null;
      email: string;
      phone: string | null;
      first_name: string;
      last_name: string;
      properties: number;
      active_tenancies: number;
    }>
  > {
    const accounts = await this.accountRepository.find({
      where: {
        creator_id: adminId,
        roles: ArrayContains([RolesEnum.LANDLORD]),
      },
      relations: ['user'],
      order: { profile_name: 'ASC' },
    });

    const landlordIds = accounts.map((a) => a.id);

    // Property + active-tenancy counts per landlord, computed in two grouped
    // queries (not N+1). `properties.owner_id` is the landlord Account.id.
    const [propertyCounts, tenancyCounts] = landlordIds.length
      ? await Promise.all([
          this.propertyTenantRepository.manager
            .createQueryBuilder(Property, 'p')
            .select('p.owner_id', 'ownerId')
            .addSelect('COUNT(*)', 'count')
            .where('p.owner_id IN (:...ids)', { ids: landlordIds })
            .groupBy('p.owner_id')
            .getRawMany<{ ownerId: string; count: string }>(),
          this.propertyTenantRepository
            .createQueryBuilder('pt')
            .innerJoin('pt.property', 'p')
            .select('p.owner_id', 'ownerId')
            .addSelect('COUNT(*)', 'count')
            .where('p.owner_id IN (:...ids)', { ids: landlordIds })
            .andWhere('pt.status = :status', {
              status: TenantStatusEnum.ACTIVE,
            })
            .groupBy('p.owner_id')
            .getRawMany<{ ownerId: string; count: string }>(),
        ])
      : [[], []];

    const propertyCountByOwner = new Map(
      propertyCounts.map((r) => [r.ownerId, Number(r.count)]),
    );
    const tenancyCountByOwner = new Map(
      tenancyCounts.map((r) => [r.ownerId, Number(r.count)]),
    );

    return accounts.map((a) => {
      const first = a.user?.first_name ?? '';
      const last = a.user?.last_name ?? '';
      const name =
        a.profile_name?.trim() || `${first} ${last}`.trim() || a.email;
      return {
        id: a.id,
        name,
        landlord_type: a.landlord_type ?? null,
        email: a.email,
        phone: a.user?.phone_number ?? null,
        first_name: first,
        last_name: last,
        properties: propertyCountByOwner.get(a.id) ?? 0,
        active_tenancies: tenancyCountByOwner.get(a.id) ?? 0,
      };
    });
  }

  /**
   * Full detail aggregate for ONE managed landlord, for the admin's landlord
   * detail page. Authorized here by the same rule as {@link getManagedLandlords}
   * (the landlord's `creator_id` must be this admin) so a client-supplied
   * landlordId can never reach another admin's landlord.
   *
   * Returns, in one payload:
   *  - profile: name (+ corporate contact name), email, phone, and counts
   *  - properties: EVERY property the landlord owns (all statuses); occupied
   *    ones carry their active tenancy + rent details, vacant ones don't
   *  - tenants: everyone who has ever been a tenant on those properties
   *    (current + previous) plus KYC applicants who applied to them (an
   *    applicant who is already a tenant is folded into the tenant entry)
   */
  async getManagedLandlordDetail(adminId: string, landlordId: string) {
    const account = await this.accountRepository.findOne({
      where: {
        id: landlordId,
        creator_id: adminId,
        roles: ArrayContains([RolesEnum.LANDLORD]),
      },
      relations: ['user'],
    });
    if (!account) {
      throw new NotFoundException(
        'Landlord not found or not managed by you.',
      );
    }

    const em = this.propertyTenantRepository.manager;
    const first = account.user?.first_name ?? '';
    const last = account.user?.last_name ?? '';
    const contactName = `${first} ${last}`.trim();

    // ── Properties (all statuses) with their active tenancy + rent ──────────
    const properties = await em.find(Property, {
      where: { owner_id: landlordId },
      relations: ['rents', 'rents.tenant', 'rents.tenant.user'],
      order: { created_at: 'DESC' },
    });

    const propertyPayload = properties.map((p) => {
      const activeRent = (p.rents ?? []).find(
        (r) => r.rent_status === RentStatusEnum.ACTIVE,
      );
      const tenantUser = activeRent?.tenant?.user;
      const tenancy = activeRent
        ? {
            tenantId: activeRent.tenant_id,
            tenantName:
              `${tenantUser?.first_name ?? ''} ${tenantUser?.last_name ?? ''}`.trim() ||
              activeRent.tenant?.profile_name ||
              activeRent.tenant?.email ||
              'Tenant',
            tenantPhone: tenantUser?.phone_number ?? null,
            rentAmount: activeRent.rental_price ?? null,
            frequency: activeRent.payment_frequency ?? null,
            serviceCharge: activeRent.service_charge ?? null,
            startDate: activeRent.rent_start_date ?? null,
            expiryDate: activeRent.expiry_date ?? null,
          }
        : null;

      return {
        id: p.id,
        name: p.name,
        location: p.location,
        status: p.property_status,
        isMarketingReady: p.is_marketing_ready,
        rentalPrice: p.rental_price ?? null,
        tenancy,
      };
    });

    const propertyIds = properties.map((p) => p.id);

    // ── Tenants ever on those properties (current + previous) ───────────────
    const propertyTenants = propertyIds.length
      ? await em.find(PropertyTenant, {
          where: { property_id: In(propertyIds) },
          relations: ['tenant', 'tenant.user', 'property'],
          order: { created_at: 'DESC' },
        })
      : [];

    // Collapse to one entry per tenant: current (any active row) wins over
    // previous, and we surface the property that row belongs to.
    const tenantsById = new Map<
      string,
      {
        id: string;
        kind: 'current' | 'previous';
        name: string;
        phone: string | null;
        email: string | null;
        propertyName: string | null;
      }
    >();
    for (const pt of propertyTenants) {
      const u = pt.tenant?.user;
      const isActive = pt.status === TenantStatusEnum.ACTIVE;
      const existing = tenantsById.get(pt.tenant_id);
      // Skip if we already have a current row and this one isn't a better match.
      if (existing && (existing.kind === 'current' || !isActive)) continue;
      tenantsById.set(pt.tenant_id, {
        id: pt.tenant_id,
        kind: isActive ? 'current' : 'previous',
        name:
          `${u?.first_name ?? ''} ${u?.last_name ?? ''}`.trim() ||
          pt.tenant?.profile_name ||
          pt.tenant?.email ||
          'Tenant',
        phone: u?.phone_number ?? null,
        email: pt.tenant?.email ?? u?.email ?? null,
        propertyName: pt.property?.name ?? null,
      });
    }

    // ── KYC applicants for those properties (excluding ones already tenants) ─
    const applications = propertyIds.length
      ? await this.kycApplicationRepository.find({
          where: { property_id: In(propertyIds) },
          relations: ['property'],
          order: { created_at: 'DESC' },
        })
      : [];

    const applicantPayload = applications
      .filter((a) => !(a.tenant_id && tenantsById.has(a.tenant_id)))
      .map((a) => ({
        id: `app-${a.id}`,
        kind: 'applicant' as const,
        name: `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() || 'Applicant',
        phone: a.phone_number ?? null,
        email: a.email ?? null,
        propertyName: a.property?.name ?? null,
        status: a.status as ApplicationStatus,
      }));

    const currentTenants = [...tenantsById.values()].filter(
      (t) => t.kind === 'current',
    );
    const previousTenants = [...tenantsById.values()].filter(
      (t) => t.kind === 'previous',
    );

    return {
      profile: {
        id: account.id,
        name:
          account.profile_name?.trim() ||
          contactName ||
          account.email,
        contactName:
          account.landlord_type === LandlordType.CORPORATE
            ? contactName || null
            : null,
        landlordType: account.landlord_type ?? null,
        email: account.email,
        phone: account.user?.phone_number ?? null,
        propertiesCount: properties.length,
        tenantsCount: tenantsById.size,
      },
      properties: propertyPayload,
      tenants: [
        ...currentTenants,
        ...previousTenants,
        ...applicantPayload,
      ],
    };
  }

  /**
   * Edit a managed landlord's profile (type / name / business name / email /
   * phone). Authorized by the same rule as {@link getManagedLandlordDetail} —
   * the landlord's `creator_id` must be this admin — so a client-supplied
   * landlordId can never reach another admin's landlord. Only the fields that
   * are present in `data` change. Returns the refreshed managed-landlord row
   * (same shape as {@link getManagedLandlords}).
   */
  async updateManagedLandlord(
    adminId: string,
    landlordId: string,
    data: UpdateManagedLandlordDto,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const account = await manager.getRepository(Account).findOne({
        where: {
          id: landlordId,
          creator_id: adminId,
          roles: ArrayContains([RolesEnum.LANDLORD]),
        },
        relations: ['user'],
      });
      if (!account) {
        throw new NotFoundException(
          'Landlord not found or not managed by you.',
        );
      }

      const nextType =
        data.landlord_type ?? account.landlord_type ?? LandlordType.INDIVIDUAL;
      const isCorporate = nextType === LandlordType.CORPORATE;

      // Resolve each name piece, falling back to what's already stored when the
      // caller left it out. For corporate the business name lives in
      // profile_name; for individual the display name is first+last.
      const firstName =
        data.first_name !== undefined
          ? data.first_name.trim()
          : account.user?.first_name ?? '';
      const lastName =
        data.last_name !== undefined
          ? data.last_name.trim()
          : account.user?.last_name ?? '';
      const businessName =
        data.business_name !== undefined
          ? data.business_name.trim()
          : isCorporate
            ? account.profile_name ?? ''
            : '';

      if (isCorporate && !businessName) {
        throw new BadRequestException(
          'A business name is required for corporate landlords',
        );
      }
      if (!isCorporate && !firstName) {
        throw new BadRequestException(
          "An individual landlord's first name is required",
        );
      }

      // ── Email (on the account) ──────────────────────────────────────────────
      if (data.email !== undefined) {
        const email = data.email.trim().toLowerCase();
        if (email && email !== account.email) {
          const clash = await manager
            .getRepository(Account)
            .findOne({ where: { email } });
          if (clash && clash.id !== account.id) {
            throw new ConflictException(
              'Another account already uses this email address.',
            );
          }
          account.email = email;
        }
      }

      // ── Phone (on the shared user row) ──────────────────────────────────────
      if (data.phone_number !== undefined && account.user) {
        const phone = data.phone_number; // normalized (digits-only) by the DTO
        if (phone && phone !== account.user.phone_number) {
          const clash = await manager
            .getRepository(Users)
            .findOne({ where: { phone_number: phone } });
          if (clash && clash.id !== account.user.id) {
            throw new ConflictException(
              `Phone ${phone} is already linked to a different account.`,
            );
          }
          account.user.phone_number = phone;
        }
      }

      // ── Names on the user row ───────────────────────────────────────────────
      if (account.user) {
        // users.first_name is NOT NULL — a corporate landlord with no contact
        // name falls back to the business name.
        account.user.first_name =
          (isCorporate ? firstName || businessName : firstName) ||
          account.user.first_name;
        account.user.last_name = lastName;
        await manager.getRepository(Users).save(account.user);
      }

      account.landlord_type = nextType;
      account.profile_name = isCorporate
        ? businessName
        : `${firstName} ${lastName}`.trim();

      await manager.getRepository(Account).save(account);
      await this.accountCacheService.invalidate(account.id);
    });

    // Return the refreshed row so the client can update in place.
    const rows = await this.getManagedLandlords(adminId);
    return rows.find((r) => r.id === landlordId) ?? { id: landlordId };
  }

  /**
   * Remove a managed landlord. Refuses while the landlord still owns properties
   * (their Account.id is the `owner_id` referenced across properties / rents /
   * tenancies) so we never orphan that data. When the landlord shares its
   * identity with another role (tenant / FM), only the landlord side is
   * detached (role + management link removed); a landlord-only account is
   * soft-deleted. Scoped to this admin's landlords.
   */
  async deleteManagedLandlord(adminId: string, landlordId: string) {
    return await this.dataSource.transaction(async (manager) => {
      const account = await manager.getRepository(Account).findOne({
        where: {
          id: landlordId,
          creator_id: adminId,
          roles: ArrayContains([RolesEnum.LANDLORD]),
        },
      });
      if (!account) {
        throw new NotFoundException(
          'Landlord not found or not managed by you.',
        );
      }

      const propertyCount = await manager
        .getRepository(Property)
        .count({ where: { owner_id: landlordId } });
      if (propertyCount > 0) {
        throw new BadRequestException(
          `This landlord still has ${propertyCount} propert${
            propertyCount === 1 ? 'y' : 'ies'
          }. Remove or reassign them before deleting the landlord.`,
        );
      }

      const remainingRoles = (account.roles ?? []).filter(
        (r) => r !== RolesEnum.LANDLORD,
      );

      if (remainingRoles.length > 0) {
        // Shared identity — detach the landlord side, keep the account.
        // creator_id / landlord_type are nullable columns typed as non-null on
        // the entity, so the null-clear needs a cast.
        await manager.getRepository(Account).update(account.id, {
          roles: remainingRoles,
          creator_id: null,
          landlord_type: null,
        } as unknown as Partial<Account>);
      } else {
        // Landlord-only account → soft-delete it.
        await manager.getRepository(Account).softDelete(account.id);
      }

      await this.accountCacheService.invalidate(account.id);
      return { message: 'Landlord removed successfully' };
    });
  }
}

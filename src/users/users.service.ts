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
  CreateTenantDto,
  CreateTenantKycDto,
  CreateUserDto,
  IUser,
  LoginDto,
  UserFilter,
} from './dto/create-user.dto';
import {
  AttachTenantToPropertyDto,
  RentFrequency,
} from './dto/attach-tenant-to-property.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from './entities/user.entity';
import { DataSource, Not, QueryRunner, Repository } from 'typeorm';
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
import { Account } from './entities/account.entity';
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
import { KYCApplication } from 'src/kyc-links/entities/kyc-application.entity';
import { AccountCacheService } from 'src/auth/account-cache.service';
import { TenantManagementService } from './tenant-management';
import { TeamService, TeamMemberInput } from './team';
import { PasswordService } from './password';

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
    dto: {
      kycApplicationId: string;
      propertyId: string;
      rentAmount: number;
      rentFrequency: string;
      tenancyStartDate: string;
      rentDueDate: string;
      serviceCharge?: number;
    },
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
          lease_agreement_end_date: data.lease_agreement_end_date,
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
        where: { email, role: userRole },
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
        role: userRole,
        profile_name: `${this.utilService.toSentenceCase(user.first_name)} ${this.utilService.toSentenceCase(user.last_name)}`,
        is_verified: false,
      });

      await queryRunner.manager.save(Account, tenantAccount);

      await queryRunner.manager.save(Rent, {
        tenant_id: tenantAccount.id,
        rent_start_date: data.rent_start_date,
        lease_agreement_end_date: data.lease_agreement_end_date,
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
        role: userRole,
        creator_id: userRole === RolesEnum.TENANT ? user_id : null,
      };

      const createdUser = await queryRunner.manager.save(Users, newUser);

      if (!createdUser?.id) {
        throw new Error('User ID is missing after creation');
      }

      await queryRunner.manager.save(Account, {
        role: userRole,
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
        lease_agreement_end_date: data?.lease_agreement_end_date,
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
        role: createdUser.role,
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
    });

    if (!account?.id) {
      throw new NotFoundException(`Account with userId: ${id} not found`);
    }

    await this.accountRepository.update(account.id, {
      profile_name: `${data.first_name} ${data.last_name}`,
    });

    // Invalidate account cache after update
    await this.accountCacheService.invalidate(account.id);

    return this.usersRepository.update(account.userId, data);
  }

  async deleteUserById(id: string) {
    return this.usersRepository.delete(id);
  }

  async loginUser(data: LoginDto, res: Response, req?: any) {
    const { identifier, password } = data; // Changed from 'email' to 'identifier'

    // Simple rate limiting check
    const rateLimitKey = `login_attempts:${identifier}`;
    const attempts = await this.cache.get(rateLimitKey);

    if (attempts && parseInt(attempts) >= 5) {
      throw new HttpException(
        'Too many login attempts. Please try again in 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Determine if identifier is email or phone
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    const isPhone = /^[+]?[\d\s\-()]{10,}$/.test(identifier.replace(/\s/g, ''));

    if (!isEmail && !isPhone) {
      throw new BadRequestException('Invalid email or phone number format');
    }

    // Build query conditions based on identifier type
    const whereCondition = isEmail
      ? { email: identifier.toLowerCase().trim() }
      : { user: { phone_number: identifier.replace(/[\s\-()+]/g, '') } };

    // Fetch accounts with the identifier but different roles
    const [adminAccount, landlordAccount, tenantAccount, repAccount] =
      await Promise.all([
        this.accountRepository.findOne({
          where: { ...whereCondition, role: RolesEnum.ADMIN },
          relations: ['user'],
        }),
        this.accountRepository.findOne({
          where: { ...whereCondition, role: RolesEnum.LANDLORD },
          relations: ['user'],
        }),
        this.accountRepository.findOne({
          where: { ...whereCondition, role: RolesEnum.TENANT },
          relations: ['user'],
        }),
        this.accountRepository.findOne({
          where: { ...whereCondition, role: RolesEnum.REP },
          relations: ['user'],
        }),
      ]);

    // Check if any account exists
    if (!adminAccount && !tenantAccount && !landlordAccount && !repAccount) {
      throw new NotFoundException(
        `User with ${isEmail ? 'email' : 'phone number'}: ${identifier} not found`,
      );
    }

    // Check verification status
    if (
      !adminAccount?.is_verified &&
      !tenantAccount?.is_verified &&
      !landlordAccount?.is_verified &&
      !repAccount?.is_verified
    ) {
      throw new NotFoundException(`Your account is not verified`);
    }

    // Validate password for each account
    const accounts = [
      adminAccount,
      landlordAccount,
      tenantAccount,
      repAccount,
    ].filter(Boolean) as any;

    let matchedAccount = null;

    for (const account of accounts) {
      if (account.password) {
        const isPasswordValid = await this.utilService.validatePassword(
          password,
          account.password,
        );

        if (isPasswordValid) {
          matchedAccount = account;
          console.log(
            `SUCCESS: Matched account with role: ${account.role}. Breaking loop.`,
          );
          break;
        }
      }
    }

    // Handle no password match
    if (!matchedAccount) {
      // Increment failed login attempts
      const currentAttempts = await this.cache.get(rateLimitKey);
      const newAttempts = currentAttempts ? parseInt(currentAttempts) + 1 : 1;
      await this.cache.set(rateLimitKey, newAttempts.toString(), 15 * 60); // 15 minutes TTL

      throw new UnauthorizedException('Incorrect password');
    }

    // Clear rate limit on successful login
    await this.cache.delete(rateLimitKey);

    const account = matchedAccount as any;

    let sub_access_token: string | null = null;
    let parent_access_token: string | null = null;

    // Handle LANDLORD with TENANT sub-account
    if (account.role === RolesEnum.LANDLORD) {
      const subAccountWhere = isEmail
        ? { id: Not(account.id), email: account.email, role: RolesEnum.TENANT }
        : {
            id: Not(account.id),
            user: { phone_number: account.user.phone_number },
            role: RolesEnum.TENANT,
          };

      const subAccount = (await this.accountRepository.findOne({
        where: subAccountWhere,
        relations: ['user', 'property_tenants'],
      })) as any;

      if (subAccount) {
        const subTokenPayload = {
          id: subAccount.id,
          first_name: subAccount.user.first_name,
          last_name: subAccount.user.last_name,
          email: subAccount.email,
          phone_number: subAccount.user.phone_number,
          property_id: subAccount.property_tenants[0]?.property_id,
          role: subAccount.role,
        } as any;

        sub_access_token =
          await this.authService.generateAccessToken(subTokenPayload);
      }
    }

    // Handle TENANT with LANDLORD parent account
    if (account.role === RolesEnum.TENANT) {
      const parentAccountWhere = isEmail
        ? {
            id: Not(account.id),
            email: account.email,
            role: RolesEnum.LANDLORD,
          }
        : {
            id: Not(account.id),
            user: { phone_number: account.user.phone_number },
            role: RolesEnum.LANDLORD,
          };

      const parentAccount = (await this.accountRepository.findOne({
        where: parentAccountWhere,
        relations: ['user', 'property_tenants'],
      })) as any;

      if (parentAccount) {
        const subTokenPayload = {
          id: parentAccount.id,
          first_name: parentAccount.user.first_name,
          last_name: parentAccount.user.last_name,
          email: parentAccount.email,
          phone_number: parentAccount.user.phone_number,
          property_id: parentAccount.property_tenants[0]?.property_id,
          role: parentAccount.role,
        } as any;

        parent_access_token =
          await this.authService.generateAccessToken(subTokenPayload);
      }
    }

    const tokenPayload = {
      id: account.id,
      first_name: account.user.first_name,
      last_name: account.user.last_name,
      email: account.email,
      phone_number: account.user.phone_number,
      role: account.role,
    };

    // Generate access token (15 minutes) and refresh token (7 days)
    const access_token =
      await this.authService.generateAccessToken(tokenPayload);
    const refresh_token = await this.authService.generateRefreshToken(
      account.id,
      req?.headers?.['user-agent'] || 'unknown',
      req?.ip || req?.connection?.remoteAddress || 'unknown',
    );

    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    // Set access token cookie (15 minutes)
    res.cookie('access_token', access_token, {
      httpOnly: true,
      secure: isProduction,
      maxAge: 15 * 60 * 1000, // 15 minutes in milliseconds
      sameSite: isProduction ? 'none' : 'lax',
      path: '/', // Available to all paths
    });

    // Set refresh token cookie (7 days)
    res.cookie('refresh_token', refresh_token, {
      httpOnly: true,
      secure: isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
      sameSite: isProduction ? 'none' : 'lax',
      path: '/', // Available to all paths
    });

    if (sub_access_token) {
      res.cookie('sub_access_token', sub_access_token, {
        httpOnly: true,
        secure: isProduction,
        maxAge: 15 * 60 * 1000, // 15 minutes
        sameSite: isProduction ? 'none' : 'lax',
        path: '/', // Available to all paths
      });
    }

    if (parent_access_token) {
      res.cookie('parent_access_token', parent_access_token, {
        httpOnly: true,
        secure: isProduction,
        maxAge: 15 * 60 * 1000, // 15 minutes
        sameSite: isProduction ? 'none' : 'lax',
        path: '/', // Available to all paths
      });
    }

    return res.status(HttpStatus.OK).json({
      user: {
        id: account.id,
        first_name: account.user.first_name,
        last_name: account.user.last_name,
        email: account.email,
        phone_number: account.user.phone_number,
        profile_name: account.profile_name,
        role: account.role,
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
  async forgotPassword(email: string) {
    return this.passwordService.forgotPassword(email);
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
   * Get tenants of a specific admin/landlord
   * Delegates to TenantManagementService
   */
  async getTenantsOfAnAdmin(creator_id: string, queryParams: UserFilter) {
    return this.tenantManagementService.getTenantsOfAnAdmin(
      creator_id,
      queryParams,
    );
  }

  /**
   * Get a single tenant of an admin with full details
   * Delegates to TenantManagementService
   */
  async getSingleTenantOfAnAdmin(
    tenantId: string,
    adminId: string,
  ): Promise<TenantDetailDto> {
    return this.tenantManagementService.getSingleTenantOfAnAdmin(
      tenantId,
      adminId,
    );
  }

  async uploadLogos(
    userId: string,
    files: Express.Multer.File[],
  ): Promise<Users> {
    const user = await this.usersRepository.findOne({
      where: { id: userId, role: RolesEnum.LANDLORD },
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
    const existingAccount = await this.accountRepository.findOne({
      where: { email: data.email, role: RolesEnum.LANDLORD },
    });

    if (existingAccount) {
      throw new BadRequestException(
        'Landlord Account with this email already exists',
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
        role: RolesEnum.LANDLORD,
        is_verified: true,
        email: data.email,
      });
    }

    const landlordAccount = this.accountRepository.create({
      user,
      email: data.email,
      password: await this.utilService.hashPassword(data.password),
      role: RolesEnum.LANDLORD,
      profile_name: data.agency_name,
      is_verified: true,
    });

    await this.accountRepository.save(landlordAccount);

    const { password, ...result } = user;
    return result as Omit<Users, 'password'>;
  }

  async createAdmin(data: CreateAdminDto): Promise<Omit<Users, 'password'>> {
    const existingAccount = await this.accountRepository.findOne({
      where: { email: data.email, role: RolesEnum.ADMIN },
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
      role: RolesEnum.ADMIN,
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
      role: RolesEnum.LANDLORD,
      password: hashedPassword,
      is_verified: true,
    });

    const savedUser = await this.usersRepository.save(user);

    await this.accountRepository.save({
      role: RolesEnum.LANDLORD,
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
      where: { email: data.email, role: RolesEnum.REP },
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
        role: RolesEnum.REP,
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
      role: RolesEnum.REP,
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
      role: target.role,
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
        role: RolesEnum.LANDLORD,
      },
    });
  }
}

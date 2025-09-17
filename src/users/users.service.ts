import {
  BadRequestException,
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
  CreateUserDto,
  IUser,
  LoginDto,
  UserFilter,
} from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from './entities/user.entity';
import { DataSource, Not, QueryRunner, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AuthService } from 'src/auth/auth.service';
import { RolesEnum } from 'src/base.entity';
import { UtilService } from 'src/utils/utility-service';
import {
  clientForgotPasswordTemplate,
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
import { v4 as uuidv4 } from 'uuid';
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
    private readonly cache: CacheService,

    private readonly dataSource: DataSource,
  ) {}

  async addTenant(user_id: string, dto: CreateTenantDto) {
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

    const admin = await this.accountRepository.findOne({
      where: {
        id: user_id,
        role: RolesEnum.LANDLORD,
      },
      relations: ['user'],
    }) as any;

    if (!admin) {
      throw new HttpException('admin account not found', HttpStatus.NOT_FOUND);
    }

    return await this.dataSource.transaction(async (manager) => {
      try {
        // 1. Check existing user
        let tenantUser = await manager.getRepository(Users).findOne({
          where: {
            phone_number: UtilService.normalizePhoneNumber(phone_number),
          },
        });

        if (tenantUser) {
          throw new HttpException(
            `Account with phone: ${UtilService.normalizePhoneNumber(phone_number)} already exists`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        const property = await manager.getRepository(Property).findOne({
          where: { id: property_id },
        });

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
          first_name: UtilService.toSentenceCase(first_name),
          last_name: UtilService.toSentenceCase(last_name),
          email,
          phone_number: UtilService.normalizePhoneNumber(phone_number),
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
        const generatedPassword = await UtilService.generatePassword();

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

        console.log(tenancy_start_date, tenancy_end_date);

        // 4. create rent record
        const rent = manager.getRepository(Rent).create({
          property_id,
          tenant_id: userAccount.id,
          amount_paid: rent_amount,
          rental_price: rent_amount,
          lease_start_date: tenancy_start_date,
          lease_end_date: tenancy_end_date,
          rent_status: RentStatusEnum.ACTIVE,
        });

        await manager.getRepository(Rent).save(rent);

        // 5. Assign tenant to property
        const propertyTenant = manager.getRepository(PropertyTenant).create({
          property_id,
          tenant_id: userAccount.id,
          status: TenantStatusEnum.ACTIVE,
        });

        await manager.getRepository(PropertyTenant).save(propertyTenant);

        // 5. Notify tenant
        await this.whatsappBotService.sendToUserWithTemplate(
          UtilService.normalizePhoneNumber(tenantUser.phone_number),
          `${tenantUser.first_name} ${tenantUser.last_name}`,
        );

        this.eventEmitter.emit('user.added', {
          user_id: user_id,
          property_id: property_id,
          property_name: property?.name,
          profile_name: `${tenantUser.first_name} ${tenantUser.last_name}`,
          role: RolesEnum.TENANT,
        });

        const admin_phone_number = UtilService.normalizePhoneNumber(
          admin.user.phone_number,
        );

        await this.sendUserAddedTemplate({
          phone_number: admin_phone_number,
          name: 'Admin',
          user: `${tenantUser.first_name} ${tenantUser.last_name}`,
          property_name: property?.name,
        });

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
          lease_start_date: data.lease_start_date,
          lease_end_date: data.lease_end_date,
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
        profile_name: `${UtilService.toSentenceCase(user.first_name)} ${UtilService.toSentenceCase(user.last_name)}`,
        is_verified: false,
      });

      await queryRunner.manager.save(Account, tenantAccount);

      await queryRunner.manager.save(Rent, {
        tenant_id: tenantAccount.id,
        lease_start_date: data.lease_start_date,
        lease_end_date: data.lease_end_date,
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
          property_status: PropertyStatusEnum.NOT_VACANT,
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
        tenantAccount.id as string,
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
        UtilService.sendEmail(email, EmailSubject.WELCOME_EMAIL, emailContent),
        UtilService.sendEmail(
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

      let result = {
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
        lease_start_date: data?.lease_start_date,
        lease_end_date: data?.lease_end_date,
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
        property_status: PropertyStatusEnum.NOT_VACANT,
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

      // await UtilService.sendEmail(
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

  async generatePasswordResetToken(
    userId: string,
    queryRunner: QueryRunner,
  ): Promise<string> {
    const token = uuidv4(); // Generate secure UUID
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // Token valid for 24 hour

    const passwordReset = queryRunner.manager.create(PasswordResetToken, {
      id: uuidv4(),
      user_id: userId,
      token,
      expires_at: expiresAt,
    });

    await queryRunner.manager.save(PasswordResetToken, passwordReset);

    return token;
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

  async getAllTenants(queryParams: UserFilter) {
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

    buildUserFilterQB(qb, queryParams); // apply search & filters

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
    const user = await this.accountRepository.findOne({ where: { id } });
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
    return this.usersRepository.update(account.userId, data);
  }

  async deleteUserById(id: string) {
    return this.usersRepository.delete(id);
  }

  async loginUser(data: LoginDto, res: Response) {
    const { email, password } = data;

    // Fetch both accounts with the same email but different roles

    const [adminAccount, landlordAccount, tenantAccount, repAccount] = await Promise.all([
      this.accountRepository.findOne({
        where: { email, role: RolesEnum.ADMIN },
        relations: ['user'],
      }),
      this.accountRepository.findOne({
        where: { email, role: RolesEnum.LANDLORD },
        relations: ['user'],
      }),
      this.accountRepository.findOne({
        where: { email, role: RolesEnum.TENANT },
        relations: ['user'],
      }),
      this.accountRepository.findOne({
        where: { email, role: RolesEnum.REP },
        relations: ['user'],
      }),
    ]);

    // Check if any account exists
    if (!adminAccount && !tenantAccount && !landlordAccount && !repAccount) {
      throw new NotFoundException(`User with email: ${email} not found`);
    }

    if (
      !adminAccount?.is_verified &&
      !tenantAccount?.is_verified &&
      !landlordAccount?.is_verified &&
      !repAccount?.is_verified
    ) {
      throw new NotFoundException(`Your account is not verified`);
    }

    // Validate password for each account
    const accounts = [adminAccount, landlordAccount, tenantAccount, repAccount].filter(
      Boolean,
    ) as any;

    let matchedAccount = null;

    for (const account of accounts) {
      if (account.password) {
        const isPasswordValid = await UtilService.validatePassword(
          password,
          account.password,
        );
        if (isPasswordValid) {
          matchedAccount = account;
          break;
        }
      }
    }

    // Handle no password match
    if (!matchedAccount) {
      throw new UnauthorizedException('Invalid password');
    }

    const account = matchedAccount as any;

    let related_accounts = [] as any;
    let sub_access_token: string | null = null;
    let parent_access_token: string | null = null;

    if (account.role === RolesEnum.LANDLORD) {
      let subAccount = (await this.accountRepository.findOne({
        where: {
          id: Not(account.id),
          email: account.email,
          role: RolesEnum.TENANT,
        },
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
          await this.authService.generateToken(subTokenPayload);
      }
    }

    // const userObject: Record<string, any> = {};

    if (account.role === RolesEnum.TENANT) {
      // const findTenantProperty = await this.propertyTenantRepository.findOne({
      //   where: { tenant_id: account.id },
      // });
      // userObject['property_id'] = findTenantProperty?.property_id;

      let parentAccount = (await this.accountRepository.findOne({
        where: {
          id: Not(account.id),
          email: account.email,
          role: RolesEnum.LANDLORD,
        },
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
          await this.authService.generateToken(subTokenPayload);
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

    const access_token = await this.authService.generateToken(tokenPayload);

    return res.status(HttpStatus.OK).json({
      user: {
        // ...userObject,
        id: account.id,
        first_name: account.user.first_name,
        last_name: account.user.last_name,
        email: account.email,
        phone_number: account.user.phone_number,
        role: account.role,
        is_verified: account.is_verified,
        logo_urls: account.user.logo_urls,
        creator_id: account.creator_id,
        created_at: account.user.created_at,
        updated_at: account.user.updated_at,
      },
      access_token,
      sub_access_token,
      parent_access_token,
      // related_accounts,
      // parent_account_token,
      // expires_at: moment().add(8, 'hours').format(),
    });
  }

  async loginUserOld(data: LoginDto, res: Response) {
    const { email, password } = data;

    const account = await this.accountRepository.findOne({
      where: { email },
      relations: ['user'],
    });
    if (!account?.id) {
      throw new NotFoundException(`User with email: ${data.email} not found`);
    }

    if (account?.password) {
      const isPasswordValid = await UtilService.validatePassword(
        password,
        account?.password,
      );
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid password');
      }
    } else {
      const hashedPassword = await UtilService.hashPassword(password);
      await this.accountRepository.update(
        { email },
        { password: hashedPassword, is_verified: true },
      );
    }

    const userObject = {};
    if (account?.role === RolesEnum.TENANT) {
      const findTenantProperty = await this.propertyTenantRepository.findOne({
        where: {
          tenant_id: account.id,
        },
      });
      userObject['property_id'] = findTenantProperty?.property_id;
    }
    const tokenData = {
      id: account?.id,
      first_name: account.user.first_name,
      last_name: account.user.last_name,
      email: account.email,
      phone_number: account.user.phone_number,
      role: account.role,
    } as any;

    const access_token = await this.authService.generateToken(tokenData);

    res.cookie('access_token', access_token, {
      httpOnly: true,
      secure: this.configService.get<string>('NODE_ENV') === 'production', // Set to true in production for HTTPS
      expires: moment().add(8, 'hours').toDate(),
      sameSite: 'none',
    });

    return res.status(HttpStatus.OK).json({
      user: {
        ...userObject,
        id: account?.id,
        first_name: account.user?.first_name,
        last_name: account.user?.last_name,
        email: account?.email,
        phone_number: account.user?.phone_number,
        role: account?.role,
        is_verified: account?.is_verified,
        logo_urls: account.user?.logo_urls,
        creator_id: account.user?.creator_id,
        created_at: account.user?.created_at,
        updated_at: account.user?.updated_at,
      },
      access_token,
      expires_at: moment().add(8, 'hours').format(),
    });
  }

  async logoutUser(res: Response) {
    res.clearCookie('access_token', {
      httpOnly: true,
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      sameSite: 'strict',
    });

    return res.status(HttpStatus.OK).json({
      message: 'Logout successful',
    });
  }

  async getTenantAndPropertyInfo(tenant_id: string) {
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

  async forgotPassword(email: string) {
    try {
      const user = await this.accountRepository.findOne({ where: { email } });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      const otp = UtilService.generateOTP(6);
      const token = uuidv4();
      const expires_at = new Date(Date.now() + 1000 * 60 * 5); // 15 min

      await this.passwordResetRepository.save({
        user_id: user.id,
        token,
        otp,
        expires_at,
      });

      const emailContent = clientForgotPasswordTemplate(otp);

      await UtilService.sendEmail(
        email,
        EmailSubject.WELCOME_EMAIL,
        emailContent,
      );

      return {
        message: 'OTP sent to email',
        token,
      };
    } catch (error) {
      console.error('[ForgotPassword Error]', error);
      // Ensure the request is not hanging and sends a response
      throw new HttpException(
        'Failed to process forgot password request',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async validateOtp(otp: string) {
    const entry = await this.passwordResetRepository.findOne({
      where: { otp },
    });

    if (!entry || entry.expires_at < new Date()) {
      throw new HttpException('Invalid or expired OTP', HttpStatus.BAD_REQUEST);
    }

    return {
      message: 'OTP validated successfully',
      token: entry.token,
    };
  }

  async resendOtp(oldToken: string) {
    const resetEntry = await this.passwordResetRepository.findOne({
      where: { token: oldToken },
    });

    if (!resetEntry) {
      throw new HttpException('Invalid token', HttpStatus.BAD_REQUEST);
    }

    const user = await this.accountRepository.findOne({
      where: { id: resetEntry.user_id },
    });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    // Optional: Prevent resending if recently sent
    const now = new Date();
    const timeDiff = (resetEntry.expires_at.getTime() - now.getTime()) / 1000;
    if (timeDiff > 840) {
      throw new HttpException(
        'OTP already sent recently. Please wait a moment before requesting again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Invalidate old token
    await this.passwordResetRepository.delete({ id: resetEntry.id });

    // Generate new OTP and token
    const newOtp = UtilService.generateOTP(6);
    const newToken = uuidv4();
    const expires_at = new Date(Date.now() + 1000 * 60 * 5); // 15 minutes

    await this.passwordResetRepository.save({
      user_id: user.id,
      token: newToken,
      otp: newOtp,
      expires_at,
    });

    const emailContent = clientForgotPasswordTemplate(newOtp);
    await UtilService.sendEmail(
      user.email,
      EmailSubject.RESEND_OTP,
      emailContent,
    );

    return {
      message: 'OTP resent successfully',
      token: newToken,
    };
  }

  async resetPassword(payload: ResetPasswordDto, res: Response) {
    const { token, newPassword } = payload;

    const resetEntry = await this.passwordResetRepository.findOne({
      where: { token },
    });

    if (!resetEntry) {
      throw new HttpException('Invalid token', HttpStatus.BAD_REQUEST);
    }

    if (resetEntry.expires_at < new Date()) {
      await this.passwordResetRepository.delete({ id: resetEntry.id }); // Clean up expired token
      throw new HttpException('Token has expired', HttpStatus.BAD_REQUEST);
    }

    const user = await this.accountRepository.findOne({
      where: { id: resetEntry.user_id },
      relations: ['property_tenants'],
    });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    // Hash and update the password
    user.password = await UtilService.hashPassword(newPassword);
    if (!user.is_verified) {
      user.is_verified = true;
      this.eventEmitter.emit('user.signup', {
        user_id: user.id,
        profile_name: user.profile_name,
        property_id: user.property_tenants[0].property_id,
        role: RolesEnum.TENANT,
      });
    }

    await this.accountRepository.save(user);

    // Delete token after successful password reset
    await this.passwordResetRepository.delete({ id: resetEntry.id });

    return res.status(HttpStatus.OK).json({
      message: 'Password reset successful',
      user_id: user.id,
    });
  }

  async getTenantsOfAnAdmin(creator_id: string, queryParams: UserFilter) {
    const page = queryParams?.page ?? config.DEFAULT_PAGE_NO;
    const size = queryParams?.size ?? config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const extraFilters = await buildUserFilter(queryParams);

    //   const qb = this.accountRepository
    // .createQueryBuilder('account')
    // .leftJoinAndSelect('account.user', 'user')
    // .leftJoinAndSelect('account.rents', 'rents', 'rents.rent_status = :status', { status: 'active' })
    // .leftJoinAndSelect('rents.property', 'property')
    // .where('account.creator_id = :creator_id', { creator_id });
    const qb = this.accountRepository
      .createQueryBuilder('accounts')
      .leftJoinAndSelect('accounts.user', 'user')
      .leftJoinAndSelect('accounts.rents', 'rents')
      .leftJoinAndSelect('rents.property', 'property')
      .where('accounts.creator_id = :creator_id', { creator_id });
    //   .leftJoinAndSelect('tenant.user', 'user')
    // .leftJoinAndSelect('rents.property', 'property')

    // Apply extra filters only on the `account` table
    if (queryParams.sort_by === 'rent' && queryParams?.sort_order) {
      qb.orderBy(
        'rents.rental_price',
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
    } else if (queryParams.sort_by === 'date' && queryParams?.sort_order) {
      qb.orderBy(
        'tenant.created_at',
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
    } else if (queryParams.sort_by === 'name' && queryParams?.sort_order) {
      qb.orderBy(
        'tenant.profile_name',
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

  async getSingleTenantOfAnAdmin(tenant_id: string) {
    const tenant = this.accountRepository
      .createQueryBuilder('accounts')
      .leftJoinAndSelect('accounts.user', 'user')
      .leftJoinAndSelect('accounts.rents', 'rents')
      .leftJoinAndSelect('rents.property', 'property')
      .where('accounts.id = :tenant_id', { tenant_id })
      .getOne();

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
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

  async createLandlord(data: CreateLandlordDto): Promise<Omit<Users, 'password'>> {
    const existingAccount = await this.accountRepository.findOne({
      where: { email: data.email, role: RolesEnum.LANDLORD },
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
        role: RolesEnum.LANDLORD,
        is_verified: true,
        email: data.email,
      });

      console.log('user', user);
    }

    const landlordAccount = this.accountRepository.create({
      user,
      email: data.email,
      password: await UtilService.hashPassword(data.password),
      role: RolesEnum.LANDLORD,
      profile_name:data.agency_name,
      is_verified: true,
    });

    await this.accountRepository.save(landlordAccount);

    const { password, ...result } = user;
    return result;
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
      password: await UtilService.hashPassword(data.password),
      role: RolesEnum.ADMIN,
      profile_name: `${user.first_name}'s Admin Account`,
      is_verified: true,
    });

    await this.accountRepository.save(adminAccount);

    const { password, ...result } = user;
    return result;
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

    const hashedPassword = await UtilService.hashPassword(data.password);

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
    return result;
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
        ? await UtilService.hashPassword(data.password)
        : '',
      role: RolesEnum.REP,
      profile_name: `${data.first_name} ${data.last_name}`,
      is_verified: true,
    });

    await this.accountRepository.save(repAccount);

    const token = await this.generatePasswordResetToken(
      repAccount.id as string,
      queryRunner,
    );

    const resetLink = `${this.configService.get<string>('FRONTEND_URL')}/reset-password?token=${token}`;
    const emailContent = clientSignUpEmailTemplate(data.first_name, resetLink);

    await UtilService.sendEmail(
      data.email,
      EmailSubject.WELCOME_EMAIL,
      emailContent,
    );
    const { password, ...result } = user;
    return result;
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

  async assignCollaboratorToTeam(
    user_id: string,
    team_member: {
      email: string;
      permissions: string[];
      role: RolesEnum;
      first_name: string;
      last_name: string;
      phone_number: string;
    },
  ) {
    return await this.dataSource.transaction(async (manager) => {
      try {
        // 1. Get or create team
        let team = await manager.getRepository(Team).findOne({
          where: { creatorId: user_id },
        });

        if (!team) {
          const teamAdminAccount = await manager
            .getRepository(Account)
            .findOne({
              where: { id: user_id, role: RolesEnum.LANDLORD },
            });

          if (!teamAdminAccount) {
            throw new HttpException(
              'Team admin account not found',
              HttpStatus.NOT_FOUND,
            );
          }

          team = manager.getRepository(Team).create({
            name: `${teamAdminAccount.profile_name} Team`,
            creatorId: teamAdminAccount.id,
          });

          await manager.getRepository(Team).save(team);
        }

        // 2. Ensure user really owns this team
        if (team.creatorId !== user_id) {
          throw new HttpException(
            'Not authorized to add members to this team',
            HttpStatus.FORBIDDEN,
          );
        }

        // 3. Ensure collaborator is not already a member
        const existingMember = await manager.getRepository(TeamMember).findOne({
          where: { email: team_member.email, teamId: team.id },
        });

        if (existingMember) {
          throw new HttpException(
            'Collaborator already in team',
            HttpStatus.CONFLICT,
          );
        }

        // 4. Get or create user
        let user = await manager.getRepository(Users).findOne({
          where: { email: team_member.email },
        });

        let normalized_phone_number = team_member.phone_number.replace(
          /\D/g,
          '',
        ); // Remove non-digits
        if (!normalized_phone_number.startsWith('234')) {
          normalized_phone_number =
            '234' + normalized_phone_number.replace(/^0+/, ''); // Remove leading 0s
        }

        if (!user) {
          user = await manager.getRepository(Users).save({
            phone_number: normalized_phone_number,
            first_name: team_member.first_name,
            last_name: team_member.last_name,
            role: team_member.role,
            is_verified: true,
            email: team_member.email,
          });
        }

        // 5. Get or create account
        let userAccount = await manager.getRepository(Account).findOne({
          where: { email: team_member.email },
        });

        if (!userAccount) {
          const generatedPassword = await UtilService.generatePassword(); // Await the promise
          userAccount = manager.getRepository(Account).create({
            user,
            email: team_member.email,
            password: generatedPassword, // assign the awaited value
            role: team_member.role,
            profile_name: `${team_member.first_name} ${team_member.last_name}`,
            is_verified: true,
          });

          await manager.getRepository(Account).save(userAccount);
        }

        // 6. Add collaborator to team
        const newTeamMember = manager.getRepository(TeamMember).create({
          email: team_member.email,
          permissions: team_member.permissions,
          teamId: team.id,
          accountId: userAccount.id,
          role: team_member.role,
        });

        await manager.getRepository(TeamMember).save(newTeamMember);

        await this.whatsappBotService.sendToFacilityManagerWithTemplate({
          phone_number: normalized_phone_number,
          name: UtilService.toSentenceCase(team_member.first_name),
          team: team.name,
          role: 'Facility Manager',
        });

        return newTeamMember;
      } catch (error) {
        console.error('Error assigning collaborator to team:', error);
        if (error instanceof HttpException) throw error;
        throw new HttpException(
          error.message || 'Could not assign collaborator',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    });
  }

  async getTeamMembers(user_id: string): Promise<TeamMember[]> {
    // 1. Get team by creatorId
    const team = await this.teamRepository.findOne({
      where: { creatorId: user_id },
    });

    if (!team) {
      throw new HttpException('Team not found', HttpStatus.NOT_FOUND);
    }

    // 2. Ensure user really owns this team
    if (team.creatorId !== user_id) {
      throw new HttpException(
        'Not authorized to view members of this team',
        HttpStatus.FORBIDDEN,
      );
    }

    // 3. Get team members
    const members = await this.teamMemberRepository.find({
      where: { teamId: team.id },
      relations: ['account', 'account.user'],
    });

    return members;
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

  async sendUserAddedTemplate({phone_number, name, user, property_name}){
    return await this.whatsappBotService.sendUserAddedTemplate({phone_number, name, user, property_name})
  }
  async getWaitlist(){
    return await this.waitlistRepository.find()
  }

    async getLandlords(){
    return await this.usersRepository.find({
      where:{
        
      }
    })
  }
}

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CreateAdminDto,
  CreateUserDto,
  IUser,
  LoginDto,
  UserFilter,
} from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from './entities/user.entity';
import { Not, QueryRunner, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AuthService } from 'src/auth/auth.service';
import { RolesEnum } from 'src/base.entity';
import { UtilService } from 'src/utils/utility-service';
import {
  clientSignUpEmailTemplate,
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
    private readonly fileUploadService: FileUploadService,
    @InjectRepository(KYC)
    private readonly kycRepository: Repository<KYC>,
    private readonly eventEmitter: EventEmitter2,
    @InjectRepository(Account)
    private accountRepository: Repository<Account>,
  ) {}

  async createUser(data: CreateUserDto, creatorId: string): Promise<Account> {
    const { email, phone_number} = data;

    const queryRunner =
      this.usersRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const userRole = data?.role
        ? RolesEnum[data?.role.toUpperCase()]
        : RolesEnum.TENANT;

      let user = await this.usersRepository.findOne({
        where: { email },
      });

      if (!user) {
        user = await queryRunner.manager.save(Users, {
          email,
          phone_number,
          first_name: data.first_name,
          last_name: data.last_name,
          creator_id: userRole === RolesEnum.TENANT ? creatorId : null,
        });
      }

      const existingAccount = await this.accountRepository.findOne({
        where: { email, role: userRole },
      });

      if (existingAccount) {
        throw new HttpException(
          `Account with email: ${email} already exists`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      //check if a sub account allready exist for user with creatorId as account.id
      // const checkSubAccount = await this.accountRepository.findOne({
      //   where: {
      //     creator_id: creatorId,
      //     is_sub_account: true,
      //   },
      // });

      // if (checkSubAccount && is_sub_account) {
      //   throw new HttpException(
      //     `Sub account with email already exists`,
      //     HttpStatus.UNPROCESSABLE_ENTITY,
      //   );
      // }


      // const hashedPassword = await UtilService.hashPassword(data.password);

      //  console.log(hashedPassword)

      const tenantAccount = this.accountRepository.create({
        user,
        creator_id: creatorId,
        email,
        role: userRole,
        // is_sub_account,
        // profile_name:is_sub_account ?  `${user.first_name} ${userRole} Account`: `${user.first_name} ${user.last_name} `,
        profile_name:`${user.first_name} ${user.last_name}`,
        is_verified: false,
      }) as any

      await queryRunner.manager.save(Account, tenantAccount);

      const property = await queryRunner.manager.findOne(Property, {
        where: { id: data.property_id },
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
          rent_status: RentStatusEnum.ACTIVE,
        },
      });

      if (hasActiveRent) {
        throw new HttpException(
          `Property is already rented out`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const rent = {
        tenant_id: tenantAccount.id,
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
        tenant_id: tenantAccount.id,
        status: TenantStatusEnum.ACTIVE,
      });

      await queryRunner.manager.update(Property, property.id, {
        property_status: PropertyStatusEnum.NOT_VACANT,
      });

      await queryRunner.manager.save(PropertyHistory, {
        property_id: property?.id,
        tenant_id: tenantAccount?.id,
        move_in_date: DateService.getStartOfTheDay(new Date()),
        monthly_rent: data?.rental_price,
        owner_comment: null,
        tenant_comment: null,
        move_out_date: null,
        move_out_reason: null,
      });

      if (!user?.id) {
        throw new Error('User ID is missing after creation');
      }

      const token = await this.generatePasswordResetToken(
        tenantAccount?.id,
        queryRunner,
      );

      const emailContent = clientSignUpEmailTemplate(
        `${this.configService.get<string>('FRONTEND_URL')}/reset-password?token=${token}`,
      );

      await UtilService.sendEmail(
        email,
        EmailSubject.WELCOME_EMAIL,
        emailContent,
      );

      await queryRunner.commitTransaction();

      this.eventEmitter.emit('user.added', {
        user_id: property.owner_id,
        property_id: data.property_id,
        property_name: property.name,
        role: userRole,
      });

      return tenantAccount;
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

      const token = await this.generatePasswordResetToken(
        createdUser?.id,
        queryRunner,
      );

      const emailContent = clientSignUpEmailTemplate(
        `${this.configService.get<string>('FRONTEND_URL')}/reset-password?token=${token}`,
      );

      await UtilService.sendEmail(
        email,
        EmailSubject.WELCOME_EMAIL,
        emailContent,
      );

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
    expiresAt.setHours(expiresAt.getHours() + 1); // Token valid for 1 hour

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
    return this.usersRepository.update(id, data);
  }

  async deleteUserById(id: string) {
    return this.usersRepository.delete(id);
  }

async loginUser(data: LoginDto, res: Response) {
  const { email, password } = data;

  // Fetch both accounts with the same email but different roles
  const [tenantAccount, adminAccount] = await Promise.all([
    this.accountRepository.findOne({
      where: { email, role: RolesEnum.TENANT },
      relations: ['user'],
    }),
    this.accountRepository.findOne({
      where: { email, role: RolesEnum.ADMIN },
      relations: ['user'],
    }),
  ]);

  // Check if any account exists
  if (!tenantAccount && !adminAccount) {
    throw new NotFoundException(`User with email: ${email} not found`);
  }

  // Validate password for each account
  const accounts = [tenantAccount, adminAccount].filter(Boolean) as any

  let matchedAccount = null;

  for (const account of accounts) {
    if (account.password) {
      const isPasswordValid = await UtilService.validatePassword(password, account.password);
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

  const account = matchedAccount as any

  // Handle missing password (first-time login)
  // if (!account.password) {
  //   const hashedPassword = await UtilService.hashPassword(password);
  //   await this.accountRepository.update(
  //     { email, role: account.role },
  //     { password: hashedPassword, is_verified: true },
  //   );
  // }

  const userObject: Record<string, any> = {};

  if (account.role === RolesEnum.TENANT) {
    const findTenantProperty = await this.propertyTenantRepository.findOne({
      where: { tenant_id: account.id },
    });
    userObject['property_id'] = findTenantProperty?.property_id;
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

  res.cookie('access_token', access_token, {
    httpOnly: true,
    secure: this.configService.get<string>('NODE_ENV') === 'production',
    expires: moment().add(8, 'hours').toDate(),
    sameSite: 'none',
  });

  let related_accounts = [] as any;
  let parent_account_token: string | null = null;

  if (!account.creator_id) {
    const subAccounts = await this.accountRepository.find({
      where: { email, id: Not(account.id) },
      relations: ['user', 'property_tenants'],
    });

    related_accounts = await Promise.all(
      subAccounts.map(async (sub) => {
        const subTokenPayload = {
          id: sub.id,
          first_name: sub.user.first_name,
          last_name: sub.user.last_name,
          email: sub.email,
          phone_number: sub.user.phone_number,
          property_id: sub.property_tenants[0]?.property_id,
          role: sub.role,
        } as any

        const sub_access_token = await this.authService.generateToken(subTokenPayload);

        return {
          id: sub.id,
          email: sub.email,
          role: sub.role,
          first_name: sub.user.first_name,
          last_name: sub.user.last_name,
          access_token: sub_access_token,
          property_id: sub.property_tenants[0]?.property_id,
        };
      }),
    );
  } else {
    const parentAccount = await this.accountRepository.findOne({
      where: { id: account.creator_id },
      relations: ['user'],
    });

    if (parentAccount) {
      const parentTokenData = {
        id: parentAccount.id,
        email: parentAccount.email,
        role: parentAccount.role,
        first_name: parentAccount.user.first_name,
        last_name: parentAccount.user.last_name,
      } as any

      parent_account_token = await this.authService.generateToken(parentTokenData);
    }
  }

  return res.status(HttpStatus.OK).json({
    user: {
      ...userObject,
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
    related_accounts,
    parent_account_token,
    expires_at: moment().add(8, 'hours').format(),
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
    const tenant = await this.usersRepository.findOne({
      where: {
        id: tenant_id,
        role: RolesEnum.TENANT,
      },
      relations: ['property_tenants', 'property_tenants.property'],
    });

    if (!tenant?.id) {
      throw new HttpException(
        `Tenant with id: ${tenant_id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    return tenant;
  }

  async resetPassword(payload:ResetPasswordDto, res: Response) {

    const {token, newPassword} = payload
    const resetEntry = await this.passwordResetRepository.findOne({
      where: { token },
    });

    if (!resetEntry || resetEntry.expires_at < new Date()) {
      throw new HttpException(
        'Invalid or expired token',
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = await this.accountRepository.findOne({
      where: { id: resetEntry.user_id },
    });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    user.password = await UtilService.hashPassword(newPassword);
    await this.accountRepository.save(user);

    return res.status(HttpStatus.OK).json({
      user_id: user.id,
    });

    // await this.passwordResetRepository.delete({ id: resetEntry.id });
  }

  async getTenantsOfAnAdmin(queryParams: UserFilter) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const query = await buildUserFilter(queryParams);

    const [users, count] = await this.accountRepository.findAndCount({
      where: query,
      relations: ['user', 'rents', 'property_tenants', 'properties'],
      skip,
      take: size,
      order: { created_at: 'DESC' },
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

  async uploadLogos(
    userId: string,
    files: Express.Multer.File[],
  ): Promise<Users> {
    const user = await this.usersRepository.findOne({
      where: { id: userId, role: RolesEnum.ADMIN },
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

  async createAdmin(data: CreateAdminDto): Promise<Omit<Users, 'password'>> {
    const existingAccount = await this.accountRepository.findOne({
      where: { email: data.email, role: RolesEnum.ADMIN },
    });

    if (existingAccount) {
      throw new BadRequestException('Admin Account with this email already exists');
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
      role: RolesEnum.ADMIN,
      password: hashedPassword,
      is_verified: true,
    });

    const savedUser = await this.usersRepository.save(user);

    await this.accountRepository.save({
      role: RolesEnum.ADMIN,
      user: savedUser,
      profile_name: `${savedUser.first_name}'s Admin Account`,
    });

    const { password, ...result } = savedUser;
    return result;
  }

  async getSubAccounts(adminId:string): Promise<Account[]> {
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
  } as any

  const access_token = await this.authService.generateToken(tokenPayload);

  res.cookie('access_token', access_token, {
    httpOnly: true,
    secure: this.configService.get<string>('NODE_ENV') === 'production',
    expires: moment().add(8, 'hours').toDate(),
    sameSite: 'none',
  });

  return { success: true, message: 'Switched account successfully' };
}

}

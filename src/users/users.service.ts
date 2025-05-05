import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
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
import { RentStatusEnum } from 'src/rents/dto/create-rent.dto';
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
  ) {}

  async createUser(data: CreateUserDto, user_id: string): Promise<IUser> {
    const { email, phone_number } = data;

    const emailExist = await this.usersRepository.exists({ where: { email } });
    if (emailExist) {
      throw new HttpException(
        `User with email: ${email} already exist`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const phoneNumberExist = await this.usersRepository.exists({
      where: { phone_number },
    });
    if (phoneNumberExist) {
      throw new HttpException(
        `User with phone number: ${phone_number} already exist`,
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

      if (createdUser.role === RolesEnum.TENANT) {
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
            status: Not(RentStatusEnum.PENDING),
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
          amount_paid: property?.rental_price,
          status: RentStatusEnum.PAID,
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
          monthly_rent: property?.rental_price,
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
      }

      await queryRunner.commitTransaction();
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
  
    qb.orderBy('user.created_at', 'DESC')
      .skip(skip)
      .take(size);
  
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

    const user = await this.usersRepository.findOne({
      where: { email },
    });
    if (!user?.id) {
      throw new NotFoundException(`User with email: ${data.email} not found`);
    }

    if (user?.password) {
      const isPasswordValid = await UtilService.validatePassword(
        password,
        user?.password,
      );
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid password');
      }
    } else {
      const hashedPassword = await UtilService.hashPassword(password);
      await this.usersRepository.update(
        { email },
        { password: hashedPassword, is_verified: true },
      );
    }
    const userObject = {};
    if (user?.role === RolesEnum.TENANT) {
      const findTenantProperty = await this.propertyTenantRepository.findOne({
        where: {
          tenant_id: user.id,
        },
      });
      userObject['property_id'] = findTenantProperty?.property_id;
    }
    const tokenData = {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      phone_number: user.phone_number,
      role: user.role,
    };

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
        id: user?.id,
        first_name: user?.first_name,
        last_name: user?.last_name,
        email: user?.email,
        phone_number: user?.phone_number,
        role: user?.role,
        is_verified: user?.is_verified,
        logo_urls: user?.logo_urls,
        creator_id: user?.creator_id,
        created_at: user?.created_at,
        updated_at: user?.updated_at,
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

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const resetEntry = await this.passwordResetRepository.findOne({
      where: { token },
    });

    if (!resetEntry || resetEntry.expires_at < new Date()) {
      throw new HttpException(
        'Invalid or expired token',
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = await this.usersRepository.findOne({
      where: { id: resetEntry.user_id },
    });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    user.password = await UtilService.hashPassword(newPassword);
    await this.usersRepository.save(user);

    await this.passwordResetRepository.delete({ id: resetEntry.id });
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
    const [users, count] = await this.usersRepository.findAndCount({
      where: query,
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
}

import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
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
import { DataSource, Not, QueryFailedError, QueryRunner, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AuthService } from 'src/auth/auth.service';
import { RolesEnum } from 'src/base.entity';
import { UtilService } from 'src/utils/utility-service';
import {
  clientSignUpEmailTemplate,
  EmailSubject,
} from 'src/utils/email-template';
import { buildUserFilter } from 'src/filters/query-filter';
import { Response } from 'express';
import moment from 'moment';
import { config } from 'src/config';
import { connectionSource } from 'ormconfig';
import { Property } from 'src/properties/entities/property.entity';
import { RentStatusEnum } from 'src/rents/dto/create-rent.dto';
import { Rent } from 'src/rents/entities/rent.entity';
import { v4 as uuidv4 } from 'uuid';
import { PasswordResetToken } from './entities/password-reset-token.entity';


@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetRepository: Repository<PasswordResetToken>,
    private readonly dataSource: DataSource,


  ) {}

  async createUser(data: CreateUserDto, user_id: string): Promise<IUser> {
    const { email, phone_number } = data;
  
    // Check for existing email
    const emailExist = await this.usersRepository.exists({ where: { email } });
    if (emailExist) {
      throw new HttpException(
        `User with email: ${email} already exists`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  
    // Check for existing phone number
    const phoneNumberExist = await this.usersRepository.exists({
      where: { phone_number },
    });
    if (phoneNumberExist) {
      throw new HttpException(
        `User with phone number: ${phone_number} already exists`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  
    const queryRunner = this.dataSource.createQueryRunner();
  
    await queryRunner.connect();
    await queryRunner.startTransaction();
  
    try {
      const userRole = data?.role
        ? RolesEnum[data.role.toUpperCase()]
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
  
      // Validate property existence
      const property = await queryRunner.manager.findOneBy(Property, {
        id: data?.property_id,
      });
  
      if (!property?.id) {
        throw new HttpException(
          `Property with id: ${data.property_id} not found`,
          HttpStatus.NOT_FOUND,
        );
      }
  
      // Check if rent already exists
      const isPropertyAvailable = await queryRunner.manager.findOneBy(Rent, {
        property_id: data.property_id,
        status: Not(RentStatusEnum.PENDING),
      });
  
      if (isPropertyAvailable?.id) {
        throw new HttpException(
          `Property with id: ${data.property_id} is already rented`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
  
      // Save rent
      const rent = {
        tenant_id: createdUser.id,
        lease_start_date: data?.lease_start_date,
        lease_end_date: data?.lease_end_date,
        property_id: data?.property_id,
        amount_paid: property.rental_price,
        status: RentStatusEnum.PAID,
      };
  
      await queryRunner.manager.save(Rent, rent);
  
      // Send email to tenant
      if (createdUser.role === RolesEnum.TENANT) {
        const token = await this.generatePasswordResetToken(createdUser.id, queryRunner);
  
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
  
      // Handle known Postgres unique constraint violation
      if (error?.code === '23505') {
        throw new HttpException(
          error?.detail || 'Duplicate data error',
          HttpStatus.CONFLICT,
        );
      }
  
      throw new HttpException(
        error?.message || 'An error occurred while creating user',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    } finally {
      await queryRunner.release();
    }
  }
  
  

  async generatePasswordResetToken(userId: string, queryRunner: QueryRunner): Promise<string> {
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

  async updateUserById(id: string, data: UpdateUserDto) {
    if (!id) {
      throw new UnauthorizedException('User ID is required.');
    }

    const user = await this.usersRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found.`);
    }

    try {
      const result = await this.usersRepository.update(id, data);

      if (result.affected === 0) {
        throw new BadRequestException('No changes were made.');
      }

      return { message: 'User successfully updated' };
    } catch (error) {
      this.handleDatabaseError(error);
    }
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof QueryFailedError) {
      const driverError = (error as any).driverError;
      const detail: string = driverError?.detail || '';

      if (driverError?.code === '23505') {
        if (detail.includes('(email)')) {
          throw new ConflictException('Email already exists.');
        }

        if (detail.includes('(phone_number)')) {
          throw new ConflictException('Phone number already exists.');
        }

        throw new ConflictException('Duplicate entry detected.');
      }
    }

    if (error instanceof HttpException) {
      throw error; // rethrow known HTTP exceptions
    }

    throw new InternalServerErrorException('An unexpected error occurred.');
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
      expires: moment().add(1, 'hour').toDate(),
      sameSite: 'none',
    });

    return res.status(HttpStatus.OK).json({
      user,
      access_token,
      expires_at: moment().add(1, 'hour').format(),
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
    const resetEntry = await this.passwordResetRepository.findOne({ where: { token } });

    if (!resetEntry || resetEntry.expires_at < new Date()) {
      throw new HttpException('Invalid or expired token', HttpStatus.BAD_REQUEST);
    }

    const user = await this.usersRepository.findOne({ where: { id: resetEntry.user_id } });

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
}

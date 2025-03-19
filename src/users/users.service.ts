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
import { Repository } from 'typeorm';
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

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    private configService: ConfigService,
    private readonly authService: AuthService,
  ) {}

  async createUser(data: CreateUserDto): Promise<IUser> {
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

    const newUser: IUser = {
      ...data,
      role: data.role ? RolesEnum[data.role.toUpperCase()] : RolesEnum.TENANT,
    };
    const createdUser = await this.usersRepository.save(newUser);

    if (createdUser.role === RolesEnum.TENANT) {
      const emailContent = clientSignUpEmailTemplate(
        this.configService.get<string>('LOGIN_URL')!,
      );
      await UtilService.sendEmail(
        email,
        EmailSubject.WELCOME_EMAIL,
        emailContent,
      );
    }
    return createdUser;
  }

  async getAllUsers(queryParams: UserFilter) {
    const page = queryParams?.page ? Number(queryParams?.page) : 1;
    const size = queryParams?.size ? Number(queryParams.size) : 10;
    const skip = queryParams?.page ? (Number(queryParams.page) - 1) * size : 0;
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

    if (user.password) {
      const isPasswordValid = await UtilService.validatePassword(
        password,
        user.password,
      );
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid password');
      }
    } else {
      const hashedPassword = await UtilService.hashPassword(password);
      await this.usersRepository.update(
        { email },
        { password: hashedPassword },
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
      sameSite: 'strict',
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
}

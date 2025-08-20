import { CreateAdminDto, CreateCustomerRepDto, CreateUserDto, IUser, LoginDto, UserFilter } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Users } from './entities/user.entity';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AuthService } from 'src/auth/auth.service';
import { RolesEnum } from 'src/base.entity';
import { Response } from 'express';
import { Rent } from 'src/rents/entities/rent.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { FileUploadService } from 'src/utils/cloudinary';
import { KYC } from './entities/kyc.entity';
import { CreateKycDto } from './dto/create-kyc.dto';
import { UpdateKycDto } from './dto/update-kyc.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Account } from './entities/account.entity';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TwilioService } from 'src/whatsapp/services/twilio.service';
import { Team } from './entities/team.entity';
import { TeamMember } from './entities/team-member.entity';
export declare class UsersService {
    private readonly usersRepository;
    private readonly configService;
    private readonly authService;
    private readonly passwordResetRepository;
    private readonly propertyTenantRepository;
    private readonly rentRepository;
    private readonly fileUploadService;
    private readonly kycRepository;
    private readonly eventEmitter;
    private accountRepository;
    private readonly twilioService;
    private readonly teamRepository;
    private readonly teamMemberRepository;
    private readonly dataSource;
    constructor(usersRepository: Repository<Users>, configService: ConfigService, authService: AuthService, passwordResetRepository: Repository<PasswordResetToken>, propertyTenantRepository: Repository<PropertyTenant>, rentRepository: Repository<Rent>, fileUploadService: FileUploadService, kycRepository: Repository<KYC>, eventEmitter: EventEmitter2, accountRepository: Repository<Account>, twilioService: TwilioService, teamRepository: Repository<Team>, teamMemberRepository: Repository<TeamMember>, dataSource: DataSource);
    createUser(data: CreateUserDto, creatorId: string): Promise<Account>;
    createUserOld(data: CreateUserDto, user_id: string): Promise<IUser>;
    generatePasswordResetToken(userId: string, queryRunner: QueryRunner): Promise<string>;
    getAllUsers(queryParams: UserFilter): Promise<{
        users: Users[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getAllTenants(queryParams: UserFilter): Promise<{
        users: Users[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getUserById(id: string): Promise<IUser>;
    getAccountById(id: string): Promise<any>;
    getUserFields(user_id: string, fields: string[]): Promise<Partial<IUser>>;
    updateUserById(id: string, data: UpdateUserDto): Promise<import("typeorm").UpdateResult>;
    deleteUserById(id: string): Promise<import("typeorm").DeleteResult>;
    loginUser(data: LoginDto, res: Response): Promise<Response<any, Record<string, any>>>;
    loginUserOld(data: LoginDto, res: Response): Promise<Response<any, Record<string, any>>>;
    logoutUser(res: Response): Promise<Response<any, Record<string, any>>>;
    getTenantAndPropertyInfo(tenant_id: string): Promise<Account>;
    forgotPassword(email: string): Promise<{
        message: string;
        token: string;
    }>;
    validateOtp(otp: string): Promise<{
        message: string;
        token: string;
    }>;
    resendOtp(oldToken: string): Promise<{
        message: string;
        token: string;
    }>;
    resetPassword(payload: ResetPasswordDto, res: Response): Promise<Response<any, Record<string, any>>>;
    getTenantsOfAnAdmin(creator_id: string, queryParams: UserFilter): Promise<{
        users: Account[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getSingleTenantOfAnAdmin(tenant_id: string): Promise<Account | null>;
    uploadLogos(userId: string, files: Express.Multer.File[]): Promise<Users>;
    createUserKyc(userId: string, data: CreateKycDto): Promise<KYC>;
    update(userId: string, updateKycDto: UpdateKycDto): Promise<KYC>;
    createAdmin(data: CreateAdminDto): Promise<Omit<Users, 'password'>>;
    createAdminOld(data: CreateAdminDto): Promise<Omit<Users, 'password'>>;
    createCustomerRep(data: CreateCustomerRepDto): Promise<Omit<Users, 'password'>>;
    getSubAccounts(adminId: string): Promise<Account[]>;
    switchAccount({ targetAccountId, currentAccount, res, }: {
        targetAccountId: string;
        currentAccount: any;
        res: Response;
    }): Promise<{
        success: boolean;
        message: string;
    }>;
    assignCollaboratorToTeam(user_id: string, team_member: {
        email: string;
        permissions: string[];
        role: RolesEnum;
    }): Promise<TeamMember>;
}

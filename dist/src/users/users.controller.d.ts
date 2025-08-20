import { UsersService } from './users.service';
import { CreateAdminDto, CreateCustomerRepDto, CreateUserDto, LoginDto, ResetDto, UserFilter } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Response } from 'express';
import { CreateKycDto } from './dto/create-kyc.dto';
import { KYC } from './entities/kyc.entity';
import { UpdateKycDto } from './dto/update-kyc.dto';
export declare class UsersController {
    private readonly usersService;
    constructor(usersService: UsersService);
    createUser(body: CreateUserDto, req: any): Promise<import("./entities/account.entity").Account>;
    getAllTenants(query: UserFilter): Promise<{
        users: import("./entities/user.entity").Users[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getProfile(req: any): Promise<any>;
    getTenantsOfAnAdmin(query: UserFilter, req: any): Promise<{
        users: import("./entities/account.entity").Account[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getSingleTenantOfAnAdmin(req: any): Promise<import("./entities/account.entity").Account | null>;
    getTenantAndPropertyInfo(req: any): Promise<import("./entities/account.entity").Account>;
    getUserById(id: string): Promise<import("./dto/create-user.dto").IUser>;
    getUserFields(user_id: string, fields: string[]): Promise<Partial<import("./dto/create-user.dto").IUser>>;
    getAllUsers(query: UserFilter): Promise<{
        users: import("./entities/user.entity").Users[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    updateUserById(id: string, body: UpdateUserDto): Promise<import("typeorm").UpdateResult>;
    login(body: LoginDto, res: Response): Promise<Response<any, Record<string, any>>>;
    logout(res: Response): Promise<Response<any, Record<string, any>>>;
    deleteUserById(id: string): Promise<import("typeorm").DeleteResult>;
    forgotPassword(body: {
        email: string;
    }, res: Response): Promise<Response<any, Record<string, any>>>;
    validateOtp(body: {
        otp: string;
    }, res: Response): Promise<Response<any, Record<string, any>>>;
    resendOtp(body: {
        token: string;
    }, res: Response): Promise<Response<any, Record<string, any>>>;
    resetPassword(body: ResetDto, res: Response): Promise<{
        message: string;
    }>;
    uploadLogos(files: Array<Express.Multer.File>, req: any): Promise<import("./entities/user.entity").Users>;
    completeKyc(userId: string, createKycDto: CreateKycDto): Promise<KYC>;
    updateKyc(userId: string, updateKycDto: UpdateKycDto): Promise<KYC>;
    createAdmin(createUserDto: CreateAdminDto): Promise<Omit<import("./entities/user.entity").Users, "password">>;
    createCustomerRep(createUserDto: CreateCustomerRepDto): Promise<Omit<import("./entities/user.entity").Users, "password">>;
    getSubAccounts(req: any): Promise<import("./entities/account.entity").Account[]>;
    switchAccount(id: string, req: any, res: Response): Promise<{
        success: boolean;
        message: string;
    }>;
}

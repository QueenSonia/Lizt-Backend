import { HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response } from 'express';
import { RolesEnum } from 'src/base.entity';
import { CreateKycDto } from 'src/users/dto/create-kyc.dto';
import {
  CreateAdminDto,
  CreateCustomerRepDto,
  CreateLandlordDto,
  CreateTenantDto,
  LoginDto,
  ResetDto,
  UserFilter,
} from 'src/users/dto/create-user.dto';
import { PaginationResponseDto } from 'src/users/dto/paginate.dto';
import { UpdateKycDto } from 'src/users/dto/update-kyc.dto';
import { UpdateUserDto } from 'src/users/dto/update-user.dto';
import { KYC } from 'src/users/entities/kyc.entity';
import { Users } from 'src/users/entities/user.entity';
import { UsersController } from 'src/users/users.controller';
import { UsersService } from 'src/users/users.service';

interface UserRequest extends Request {
  user: {
    id: string;
    role: RolesEnum;
  };
}

interface TenantIdRequest extends Request {
  params: { tenant_id: string };
}

describe('UsersController', () => {
  let controller: UsersController;

  const mockUsersService = {
    getWaitlist: jest.fn(),
    getLandlords: jest.fn(),
    getTeamMembers: jest.fn(),
    addTenant: jest.fn(),
    getAllTenants: jest.fn(),
    getAccountById: jest.fn(),
    getTenantsOfAnAdmin: jest.fn(),
    getSingleTenantOfAnAdmin: jest.fn(),
    getTenantAndPropertyInfo: jest.fn(),
    getUserById: jest.fn(),
    getUserFields: jest.fn(),
    getAllUsers: jest.fn(),
    updateUserById: jest.fn(),
    loginUser: jest.fn(),
    logoutUser: jest.fn(),
    deleteUserById: jest.fn(),
    forgotPassword: jest.fn(),
    validateOtp: jest.fn(),
    resendOtp: jest.fn(),
    resetPassword: jest.fn(),
    uploadLogos: jest.fn(),
    createUserKyc: jest.fn(),
    update: jest.fn(),
    createAdmin: jest.fn(),
    createLandlord: jest.fn(),
    createCustomerRep: jest.fn(),
    getSubAccounts: jest.fn(),
    switchAccount: jest.fn(),
    assignCollaboratorToTeam: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('testDev should return dev is working', async () => {
    // act
    const result = await controller.testDev();

    // assert
    expect(result).toEqual('dev is working');
  });

  describe('getWaitlist', () => {
    it('getWaitlist should return waitlist', async () => {
      // Arrange
      const waitlist = [{ id: '1', email: 'test@example.com' }];
      jest.spyOn(mockUsersService, 'getWaitlist').mockRejectedValue(waitlist);

      // Act
      const result = await controller.getWaitlist();

      // Assert
      expect(mockUsersService.getWaitlist).toHaveBeenCalled();
      expect(result).toEqual(waitlist);
    });

    it('getWaitlist should throw HttpException on error', async () => {
      // Arrange
      jest
        .spyOn(mockUsersService, 'getWaitlist')
        .mockRejectedValue(new Error('Failed'));

      // Act
      // Assert
      await expect(controller.getWaitlist()).rejects.toThrow(
        new HttpException(
          'Failed to get waitlist',
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );
    });
  });

  describe('getLandlords', () => {
    it('getLandlords should return landlords', async () => {
      // Arrange
      const landlords: Partial<Users>[] = [
        {
          first_name: 'John',
          last_name: 'Doe',
          email: 'john.doe@example.com',
          phone_number: '+2348012345678',
          password: 'hashedpassword123',
        },
      ];
      jest.spyOn(mockUsersService, 'getLandlords').mockResolvedValue(landlords);

      // Act
      const result = await controller.getLandlords();

      // Assert
      expect(mockUsersService.getLandlords).toHaveBeenCalled();
      expect(result).toEqual(landlords);
    });

    it('getLandlords should throw httpException on error', async () => {
      // Arrange
      jest
        .spyOn(mockUsersService, 'getLandlords')
        .mockRejectedValue(new Error('Failed'));

      // Act
      // Assert
      await expect(controller.getLandlords()).rejects.toThrow(
        new HttpException(
          'Failed to get landlords',
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );
    });
  });

  describe('getTeamMembers', () => {
    it('getTeamMembers should return team members', async () => {
      // Arrange
      const req = {
        user: { id: 'team_id', role: RolesEnum.ADMIN },
      } as unknown as UserRequest;

      const teamMembers = [
        {
          email: 'alice.manager@example.com',
          teamId: '11111111-1111-1111-1111-111111111111',
          accountId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          role: RolesEnum.FACILITY_MANAGER,
          permissions: ['view_properties', 'assign_tasks'],
        },
      ];
      jest
        .spyOn(mockUsersService, 'getTeamMembers')
        .mockResolvedValue(teamMembers);

      // Act
      const result = await controller.getTeamMembers(req);

      // Assert
      expect(mockUsersService.getTeamMembers).toHaveBeenCalledWith(req.user.id);
      expect(result).toEqual(teamMembers);
    });

    it('getTeamMembers should throw HttpException on error', async () => {
      // Arrange
      const req = {
        user: { id: 'team_id', role: RolesEnum.ADMIN },
      } as unknown as UserRequest;
      jest
        .spyOn(mockUsersService, 'getTeamMembers')
        .mockRejectedValue(new Error('Failed'));

      // Act
      // Assert
      await expect(controller.getTeamMembers(req)).rejects.toThrow(
        new HttpException(
          'Failed to get team members',
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );
    });
  });
  describe('addTenant', () => {
    it('addTenant should add a new tenant', async () => {
      // Arrange
      const body: CreateTenantDto = {
        phone_number: '+2348012345678',
        full_name: 'John Doe',
        email: 'john.doe@example.com',
        property_id: '11111111-1111-1111-1111-111111111111',
        due_date: new Date('2025-12-31'),
        rent_amount: 250000,
      };
      const req = {
        user: { id: 'user_id', role: RolesEnum.ADMIN },
      } as unknown as UserRequest;
      const tenant = { id: 'new_tentnt_id' };
      jest.spyOn(mockUsersService, 'addTenant').mockResolvedValue(tenant);

      // Act
      const result = await controller.addTenant(body, req);

      // Assert
      expect(mockUsersService.addTenant).toHaveBeenCalledWith(
        req.user.id,
        body,
      );
      expect(result).toEqual(tenant);
    });
  });
  describe('getAllTenants', () => {
    it('getAllTenants should return paginated tenants', async () => {
      // Arrange
      const query: UserFilter = { page: 1, size: 10 };
      const tenants: PaginationResponseDto = {
        users: [],
        pagination: {
          totalRows: 0,
          perPage: 10,
          currentPage: 1,
          totalPages: 0,
          hasNextPage: false,
        },
      };
      jest.spyOn(mockUsersService, 'getAllTenants').mockResolvedValue(tenants);

      // Act
      const result = await controller.getAllTenants(query);

      // Assert
      expect(mockUsersService.getAllTenants).toHaveBeenCalledWith(query);
      expect(result).toEqual(tenants);
    });
  });
  describe('getProfile', () => {
    it('getProfile should return user profile', async () => {
      // Arrange
      const userId = 'user_id';
      const req = {
        user: { id: 'fallback_id', role: RolesEnum.ADMIN },
      } as unknown as UserRequest;
      const profile = { id: userId };
      jest.spyOn(mockUsersService, 'getAccountById').mockResolvedValue(profile);

      // Act
      const result = await controller.getProfile(userId, req);

      // Assert
      expect(mockUsersService.getAccountById).toHaveBeenCalledWith(userId);
      expect(result).toEqual(profile);
    });
  });
  describe('getTenantsOfAdmin', () => {
    it('getProfile should return paginated tenants of admin', async () => {
      // Arrange
      const query: UserFilter = { page: 1, size: 10 };
      const req = {
        user: { id: 'creator_id', role: RolesEnum.ADMIN },
      } as unknown as UserRequest;
      const tenants: PaginationResponseDto = {
        users: [],
        pagination: {
          totalRows: 0,
          perPage: 10,
          currentPage: 1,
          totalPages: 0,
          hasNextPage: false,
        },
      };
      jest
        .spyOn(mockUsersService, 'getTenantsOfAnAdmin')
        .mockResolvedValue(tenants);

      // Act
      const result = await controller.getTenantsOfAnAdmin(query, req);

      // Assert
      expect(mockUsersService.getTenantsOfAnAdmin).toHaveBeenCalledWith(
        req.user.id,
        query,
      );
      expect(result).toEqual(tenants);
    });

    it('getSingleTenantOfAnAdmin should return single tenant', async () => {
      // Arrange
      const req = {
        params: { tenant_id: 'tenant_id' },
      } as unknown as TenantIdRequest;
      const tenant = { id: 'tenant_id' };
      jest
        .spyOn(mockUsersService, 'getSingleTenantOfAnAdmin')
        .mockResolvedValue(tenant);

      // Act
      const result = await controller.getSingleTenantOfAnAdmin(req);

      // Assert
      expect(mockUsersService.getSingleTenantOfAnAdmin).toHaveBeenCalledWith(
        'tenant_id',
      );
      expect(result).toEqual(tenant);
    });
  });

  describe('getTenantAndPropertyInfo', () => {
    it('should return tenant and property info', async () => {
      // arrange
      const req = {
        user: { id: 'tenant_id', role: RolesEnum.TENANT },
      } as unknown as UserRequest;
      const info = { id: 'tenant_id' };
      jest
        .spyOn(mockUsersService, 'getTenantAndPropertyInfo')
        .mockResolvedValue(info);

      // Act
      const result = await controller.getTenantAndPropertyInfo(req);

      // Assert
      expect(mockUsersService.getTenantAndPropertyInfo).toHaveBeenCalledWith(
        req.user.id,
      );
      expect(result).toEqual(info);
    });
  });

  it('getUserById should return user by id', async () => {
    // Arrange
    const id = 'user_id';
    const user = { id };
    jest.spyOn(mockUsersService, 'getUserById').mockResolvedValue(user);

    // Act
    const result = await controller.getUserById(id);

    // Assert
    expect(mockUsersService.getUserById).toHaveBeenCalledWith(id);
    expect(result).toEqual(user);
  });

  it('getUserFields should return specific user fields', async () => {
    // Arrange
    const user_id = 'user_id';
    const fields = ['id', 'email'];
    const userFields = { id: user_id, email: 'test@email.com' };
    jest.spyOn(mockUsersService, 'getUserFields').mockResolvedValue(userFields);

    // Act
    const result = await controller.getUserFields(user_id, fields);

    // Assert
    expect(mockUsersService.getUserFields).toHaveBeenCalledWith(
      user_id,
      fields,
    );
    expect(result).toEqual(userFields);
  });

  it('getAllUsers should return paginated users', async () => {
    // Arrange
    const query: UserFilter = { page: 1, size: 10 };
    const users: PaginationResponseDto = {
      users: [],
      pagination: {
        totalRows: 0,
        perPage: 10,
        currentPage: 1,
        totalPages: 0,
        hasNextPage: false,
      },
    };
    jest.spyOn(mockUsersService, 'getAllUsers').mockResolvedValue(users);

    // Act
    const result = await controller.getAllUsers(query);

    // Assert
    expect(mockUsersService.getAllUsers).toHaveBeenCalledWith(query);
    expect(result).toEqual(users);
  });

  it('updateUserById => should update user by id', async () => {
    // arrange
    const id = 'user_id';
    const body: UpdateUserDto = { first_name: 'Updated' };
    const updatedUser = { id, first_name: 'Updated' };
    jest
      .spyOn(mockUsersService, 'updateUserById')
      .mockResolvedValue(updatedUser);

    // act
    const result = await controller.updateUserById(id, body);

    // assert
    expect(mockUsersService.updateUserById).toHaveBeenCalledWith(id, body);
    expect(result).toEqual(updatedUser);
  });

  it('login => should login user and return data', async () => {
    // arrange
    const body: LoginDto = { email: 'test@example.com', password: 'password' };
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as Response;

    jest
      .spyOn(mockUsersService, 'loginUser')
      .mockImplementation(async (_body, res) => {
        return res
          .status(200)
          .json({ user: { id: '1' }, access_token: 'token' });
      });

    const mockResSpy = jest.spyOn(mockRes, 'status');

    // act
    await controller.login(body, mockRes);

    // assert
    expect(mockUsersService.loginUser).toHaveBeenCalledWith(body, mockRes);
    expect(mockResSpy).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      user: { id: '1' },
      access_token: 'token',
    });
  });

  it('logout => should logout user', async () => {
    // arrange
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      clearCookie: jest.fn(),
    } as unknown as Response;

    jest
      .spyOn(mockUsersService, 'logoutUser')
      .mockImplementation(async (res) => {
        res.clearCookie('access_token', {
          httpOnly: true,
          secure: false,
          sameSite: 'strict',
        });
        return res.status(200).json({ message: 'Logout successful' });
      });
    const clearCookieSpy = jest.spyOn(mockRes, 'clearCookie');
    const statusSpy = jest.spyOn(mockRes, 'status');

    // act
    await controller.logout(mockRes);

    // assert
    expect(mockUsersService.logoutUser).toHaveBeenCalledWith(mockRes);
    expect(clearCookieSpy).toHaveBeenCalledWith('access_token', {
      httpOnly: true,
      secure: false, // or true if NODE_ENV=production
      sameSite: 'strict',
    });
    expect(statusSpy).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({ message: 'Logout successful' });
  });

  it('deleteUserById => should delete user by id', async () => {
    // arrange
    const id = 'user_id';
    const deleteResult = { affected: 1 };
    jest
      .spyOn(mockUsersService, 'deleteUserById')
      .mockResolvedValue(deleteResult);

    // act
    const result = await controller.deleteUserById(id);

    // assert
    expect(mockUsersService.deleteUserById).toHaveBeenCalledWith(id);
    expect(result).toEqual(deleteResult);
  });

  describe('forgotPassword', () => {
    it('forgotPassword should send forgot password email', async () => {
      // arrange
      const body = { email: 'test@example.com' };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;
      jest
        .spyOn(mockUsersService, 'forgotPassword')
        .mockResolvedValue(undefined);
      const mockResStatusSpy = jest.spyOn(mockRes, 'status');

      // act
      await controller.forgotPassword(body, mockRes);

      // assert
      expect(mockUsersService.forgotPassword).toHaveBeenCalledWith(body.email);
      expect(mockResStatusSpy).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Check your Email',
      });
    });

    it('forgotPassword => should handle error', async () => {
      // arrange
      const body = { email: 'test@example.com' };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;
      jest
        .spyOn(mockUsersService, 'forgotPassword')
        .mockRejectedValue(new Error('Failed'));
      const mockResStatusSpy = jest.spyOn(mockRes, 'status');

      // act
      await controller.forgotPassword(body, mockRes);

      // assert
      expect(mockResStatusSpy).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Internal Server Error',
      });
    });
  });

  it('validateOtp => should validate OTP', async () => {
    // arrange
    const body = { otp: '123456' };
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;
    const response = { message: 'OTP validated' };
    jest.spyOn(mockUsersService, 'validateOtp').mockResolvedValue(response);
    const mockResStatusSpy = jest.spyOn(mockRes, 'status');

    // act
    await controller.validateOtp(body, mockRes);

    // assert
    expect(mockUsersService.validateOtp).toHaveBeenCalledWith(body.otp);
    expect(mockResStatusSpy).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(response);
  });

  it('resendOtp => should resend OTP', async () => {
    // arrange
    const body = { token: 'token' };
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;
    const response = { message: 'OTP resent' };
    jest.spyOn(mockUsersService, 'resendOtp').mockResolvedValue(response);
    const mockResStatusSpy = jest.spyOn(mockRes, 'status');

    // act
    await controller.resendOtp(body, mockRes);

    // assert
    expect(mockUsersService.resendOtp).toHaveBeenCalledWith(body.token);
    expect(mockResStatusSpy).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(response);
  });

  it('resetPassword => should reset password', async () => {
    // arrange
    const body: ResetDto = { token: 'token', newPassword: 'newpass' };
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;
    const result = { message: 'Password reset' };
    jest.spyOn(mockUsersService, 'resetPassword').mockResolvedValue(result);
    const mockResStatusSpy = jest.spyOn(mockRes, 'status');

    // act
    await controller.resetPassword(body, mockRes);

    // assert
    expect(mockUsersService.resetPassword).toHaveBeenCalledWith(body, mockRes);
    expect(mockResStatusSpy).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(result);
  });

  it('uploadLogos => should upload logos', async () => {
    // arrange
    const files = [{ originalname: 'logo.png' }] as Express.Multer.File[];
    const req: UserRequest = {
      user: { id: 'user_id', role: RolesEnum.ADMIN },
    } as UserRequest;
    const uploadedUser = { id: 'user_id', logo_urls: ['url'] };
    jest.spyOn(mockUsersService, 'uploadLogos').mockResolvedValue(uploadedUser);

    // act
    const result = await controller.uploadLogos(files, req);

    // assert
    expect(mockUsersService.uploadLogos).toHaveBeenCalledWith(
      req.user.id,
      files,
    );
    expect(result).toEqual(uploadedUser);
  });

  describe('KYC', () => {
    it('completeKyc => should complete KYC', async () => {
      // arrange
      const userId = 'user_id';
      const body: CreateKycDto = {} as CreateKycDto;
      const kyc: KYC = { id: 'kyc_id' } as KYC;
      jest.spyOn(mockUsersService, 'createUserKyc').mockResolvedValue(kyc);

      // act
      const result = await controller.completeKyc(userId, body);

      // assert
      expect(mockUsersService.createUserKyc).toHaveBeenCalledWith(userId, body);
      expect(result).toEqual(kyc);
    });

    it('updateKyc => should update KYC', async () => {
      // arrange
      const userId = 'user_id';
      const body: UpdateKycDto = {} as UpdateKycDto;
      const kyc: KYC = { id: 'kyc_id' } as KYC;
      jest.spyOn(mockUsersService, 'update').mockResolvedValue(kyc);

      // act
      const result = await controller.updateKyc(userId, body);

      // assert
      expect(mockUsersService.update).toHaveBeenCalledWith(userId, body);
      expect(result).toEqual(kyc);
    });
  });

  it('createAdmin => should create admin', async () => {
    // arrange
    const body: CreateAdminDto = {
      email: 'admin@example.com',
      password: 'pass',
    } as CreateAdminDto;
    const admin = { id: 'admin_id' };
    jest.spyOn(mockUsersService, 'createAdmin').mockResolvedValue(admin);

    // act
    const result = await controller.createAdmin(body);

    // assert
    expect(mockUsersService.createAdmin).toHaveBeenCalledWith(body);
    expect(result).toEqual(admin);
  });

  it('createLandlord => should create landlord', async () => {
    // arrange
    const body: CreateLandlordDto = {
      email: 'landlord@example.com',
      password: 'pass',
    } as CreateLandlordDto;
    const landlord = { id: 'landlord_id' };
    jest.spyOn(mockUsersService, 'createLandlord').mockResolvedValue(landlord);

    // act
    const result = await controller.createLandlord(body);

    // assert
    expect(mockUsersService.createLandlord).toHaveBeenCalledWith(body);
    expect(result).toEqual(landlord);
  });

  it('createCustomerRep => should create customer rep', async () => {
    // arrange
    const body: CreateCustomerRepDto = {
      email: 'rep@example.com',
      password: 'pass',
    } as CreateCustomerRepDto;
    const rep = { id: 'rep_id' };
    jest.spyOn(mockUsersService, 'createCustomerRep').mockResolvedValue(rep);

    // act
    const result = await controller.createCustomerRep(body);

    // assert
    expect(mockUsersService.createCustomerRep).toHaveBeenCalledWith(body);
    expect(result).toEqual(rep);
  });

  it('getSubAccounts => should return sub accounts', async () => {
    // arrange
    const req: UserRequest = {
      user: { id: 'admin_id', role: RolesEnum.ADMIN },
    } as UserRequest;
    const subAccounts = [{ id: 'sub_id' }];
    jest
      .spyOn(mockUsersService, 'getSubAccounts')
      .mockResolvedValue(subAccounts);

    // act
    const result = await controller.getSubAccounts(req);

    // assert
    expect(mockUsersService.getSubAccounts).toHaveBeenCalledWith(req.user.id);
    expect(result).toEqual(subAccounts);
  });

  it('switchAccount => should switch account', async () => {
    // arrange
    const id = 'target_id';
    const req: UserRequest = {
      user: { id: 'current_id', role: RolesEnum.ADMIN },
    } as UserRequest;
    const mockRes = { cookie: jest.fn() } as unknown as Response;
    const switchResult = { success: true, message: 'Switched' };
    jest
      .spyOn(mockUsersService, 'switchAccount')
      .mockResolvedValue(switchResult);

    // act
    const result = await controller.switchAccount(id, req, mockRes);

    // assert
    expect(mockUsersService.switchAccount).toHaveBeenCalledWith({
      targetAccountId: id,
      currentAccount: req.user,
      res: mockRes,
    });
    expect(result).toEqual(switchResult);
  });

  it('assignCollaborator => should assign collaborator', async () => {
    // arrange
    const body = {
      email: 'collab@example.com',
      permissions: ['read'],
      role: RolesEnum.REP,
      first_name: 'Collab',
      last_name: 'User',
      phone_number: '1234567890',
    };
    const req: UserRequest = {
      user: { id: 'user_id', role: RolesEnum.ADMIN },
    } as UserRequest;
    const collaborator = { id: 'collab_id' };
    jest
      .spyOn(mockUsersService, 'assignCollaboratorToTeam')
      .mockResolvedValue(collaborator);

    // act
    const result = await controller.assignCollaborator(body, req);

    // assert
    expect(mockUsersService.assignCollaboratorToTeam).toHaveBeenCalledWith(
      req.user.id,
      body,
    );
    expect(result).toEqual(collaborator);
  });
});

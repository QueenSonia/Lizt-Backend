/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from 'src/users/users.controller';
import { UsersService } from 'src/users/users.service';
import { Response, Request } from 'express';
import {
  HttpException,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ADMIN_ROLES, RolesEnum } from 'src/base.entity';
import {
  CreateAdminDto,
  CreateCustomerRepDto,
  CreateLandlordDto,
  CreateTenantDto,
  LoginDto,
  ResetDto,
  UploadLogoDto,
  UserFilter,
} from 'src/users/dto/create-user.dto';
import { CreateKycDto } from 'src/users/dto/create-kyc.dto';
import { UpdateKycDto } from 'src/users/dto/update-kyc.dto';
import { UpdateUserDto } from 'src/users/dto/update-user.dto';
import { KYC } from 'src/users/entities/kyc.entity';

interface UserRequest extends Request {
  user: { id: string; role: RolesEnum };
}

describe('UsersController', () => {
  let controller: UsersController;
  let service: jest.Mocked<UsersService>;

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

  const mockRequest: UserRequest = {
    user: { id: 'user-id', role: ADMIN_ROLES.ADMIN },
    query: { user_id: 'some-id' },
    params: { tenant_id: 'tenant-id', userId: 'user-id' },
  } as unknown as UserRequest;

  const mockResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response;

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
    service = module.get<UsersService>(
      UsersService,
    ) as jest.Mocked<UsersService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('testDev', () => {
    it('should return "dev is working"', async () => {
      const response = await controller.testDev();
      expect(response).toBe('dev is working');
    });

    it('should throw HttpException on error', async () => {
      jest
        .spyOn(controller, 'testDev')
        .mockRejectedValue(new Error('Test error'));
      await expect(controller.testDev()).rejects.toThrow(
        new HttpException(
          'Failed to test dev',
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );
    });
  });

  describe('getWaitlist', () => {
    it('should call getWaitlist and return the result', async () => {
      const result = [{ id: '1', email: 'waitlist@example.com' }];
      service.getWaitlist.mockResolvedValue(result);

      const response = await controller.getWaitlist();
      expect(service.getWaitlist).toHaveBeenCalled();
      expect(response).toEqual(result);
    });

    it('should throw HttpException if service throws', async () => {
      service.getWaitlist.mockRejectedValue(new Error('Service error'));

      await expect(controller.getWaitlist()).rejects.toThrow(
        new HttpException(
          'Failed to get waitlist',
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );
    });
  });

  describe('getLandlords', () => {
    it('should call getLandlords and return the result', async () => {
      const result = [{ id: '1', first_name: 'Landlord' }];
      service.getLandlords.mockResolvedValue(result);

      const response = await controller.getLandlords();
      expect(service.getLandlords).toHaveBeenCalled();
      expect(response).toEqual(result);
    });

    it('should throw HttpException if service throws', async () => {
      service.getLandlords.mockRejectedValue(new Error('Service error'));

      await expect(controller.getLandlords()).rejects.toThrow(
        new HttpException(
          'Failed to get landlords',
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );
    });
  });

  describe('getTeamMembers', () => {
    it('should call getTeamMembers with team_id and return the result', async () => {
      const result = [{ id: 'member1', email: 'member@example.com' }];
      service.getTeamMembers.mockResolvedValue(result);

      const response = await controller.getTeamMembers(mockRequest);
      expect(service.getTeamMembers).toHaveBeenCalledWith('user-id');
      expect(response).toEqual(result);
    });

    it('should throw HttpException if service throws', async () => {
      service.getTeamMembers.mockRejectedValue(new Error('Service error'));

      await expect(controller.getTeamMembers(mockRequest)).rejects.toThrow(
        new HttpException(
          'Failed to get team members',
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );
    });

    it('should handle missing req.user.id', async () => {
      const invalidReq = {
        ...mockRequest,
        user: { id: undefined, role: ADMIN_ROLES.ADMIN },
      };

      await expect(controller.getTeamMembers(invalidReq)).rejects.toThrow(
        new HttpException(
          'Failed to get team members',
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );
      expect(service.getTeamMembers).not.toHaveBeenCalled();
    });
  });

  describe('addTenant', () => {
    const mockTenantDto: CreateTenantDto = {
      phone_number: '09012345678',
      full_name: 'John Doe',
      email: 'john@email.com',
      property_id: 'property-id',
      due_date: new Date('2023-12-31'),
      rent_amount: 300000,
    };

    it('should call addTenant with user_id and dto and return the result', async () => {
      const result = { id: 'tenant-id', first_name: 'John', last_name: 'Doe' };
      service.addTenant.mockResolvedValue(result);

      const response = await controller.addTenant(mockTenantDto, mockRequest);
      expect(service.addTenant).toHaveBeenCalledWith('user-id', mockTenantDto);
      expect(response).toEqual(result);
    });

    it('should throw the service error if addTenant fails', async () => {
      const error = new BadRequestException('Invalid data');
      service.addTenant.mockRejectedValue(error);

      await expect(
        controller.addTenant(mockTenantDto, mockRequest),
      ).rejects.toThrow(error);
    });
  });

  describe('getAllTenants', () => {
    const mockQuery: UserFilter = { page: 1, size: 10 };

    it('should call getAllTenants with query and return the result', async () => {
      const result = { users: [], pagination: { totalRows: 0 } };
      service.getAllTenants.mockResolvedValue(result);

      const response = await controller.getAllTenants(mockQuery);
      expect(service.getAllTenants).toHaveBeenCalledWith(mockQuery);
      expect(response).toEqual(result);
    });

    it('should throw the service error if getAllTenants fails', async () => {
      const error = new Error('Query error');
      service.getAllTenants.mockRejectedValue(error);

      await expect(controller.getAllTenants(mockQuery)).rejects.toThrow(error);
    });
  });

  describe('getProfile', () => {
    it('should call getAccountById with query.user_id if present', async () => {
      const result = { id: 'some-id', first_name: 'John' };
      service.getAccountById.mockResolvedValue(result);

      const response = await controller.getProfile(mockRequest);
      expect(service.getAccountById).toHaveBeenCalledWith('some-id');
      expect(response).toEqual(result);
    });

    it('should call getAccountById with req.user.id if query.user_id absent', async () => {
      const reqWithoutQuery = { ...mockRequest, query: {} };
      const result = { id: 'user-id', first_name: 'John' };
      service.getAccountById.mockResolvedValue(result);

      const response = await controller.getProfile(reqWithoutQuery);
      expect(service.getAccountById).toHaveBeenCalledWith('user-id');
      expect(response).toEqual(result);
    });

    it('should throw the service error if getAccountById fails', async () => {
      const error = new NotFoundException('User not found');
      service.getAccountById.mockRejectedValue(error);

      await expect(controller.getProfile(mockRequest)).rejects.toThrow(error);
    });
  });

  describe('getTenantsOfAnAdmin', () => {
    const mockQuery: UserFilter = { page: 1, size: 10 };

    it('should call getTenantsOfAnAdmin with creator_id and query', async () => {
      const result = { users: [], pagination: { totalRows: 0 } };
      service.getTenantsOfAnAdmin.mockResolvedValue(result);

      const response = await controller.getTenantsOfAnAdmin(
        mockQuery,
        mockRequest,
      );
      expect(service.getTenantsOfAnAdmin).toHaveBeenCalledWith(
        'user-id',
        mockQuery,
      );
      expect(response).toEqual(result);
    });

    it('should throw the service error if getTenantsOfAnAdmin fails', async () => {
      const error = new Error('Query error');
      service.getTenantsOfAnAdmin.mockRejectedValue(error);

      await expect(
        controller.getTenantsOfAnAdmin(mockQuery, mockRequest),
      ).rejects.toThrow(error);
    });
  });

  describe('getSingleTenantOfAnAdmin', () => {
    it('should call getSingleTenantOfAnAdmin with tenant_id', async () => {
      const result = { id: 'tenant-id', first_name: 'John' };
      service.getSingleTenantOfAnAdmin.mockResolvedValue(result);

      const response = await controller.getSingleTenantOfAnAdmin(mockRequest);
      expect(service.getSingleTenantOfAnAdmin).toHaveBeenCalledWith(
        'tenant-id',
      );
      expect(response).toEqual(result);
    });

    it('should throw the service error if getSingleTenantOfAnAdmin fails', async () => {
      const error = new NotFoundException('Tenant not found');
      service.getSingleTenantOfAnAdmin.mockRejectedValue(error);

      await expect(
        controller.getSingleTenantOfAnAdmin(mockRequest),
      ).rejects.toThrow(error);
    });
  });

  describe('getTenantAndPropertyInfo', () => {
    it('should call getTenantAndPropertyInfo with user.id', async () => {
      const result = { tenant: { id: 'user-id' }, property: {} };
      service.getTenantAndPropertyInfo.mockResolvedValue(result);

      const response = await controller.getTenantAndPropertyInfo(mockRequest);
      expect(service.getTenantAndPropertyInfo).toHaveBeenCalledWith('user-id');
      expect(response).toEqual(result);
    });

    it('should throw the service error if getTenantAndPropertyInfo fails', async () => {
      const error = new NotFoundException('Tenant not found');
      service.getTenantAndPropertyInfo.mockRejectedValue(error);

      await expect(
        controller.getTenantAndPropertyInfo(mockRequest),
      ).rejects.toThrow(error);
    });
  });

  describe('getUserById', () => {
    it('should call getUserById with id and return result', async () => {
      const id = 'user-id';
      const result = { id, first_name: 'John' };
      service.getUserById.mockResolvedValue(result);

      const response = await controller.getUserById(id);
      expect(service.getUserById).toHaveBeenCalledWith(id);
      expect(response).toEqual(result);
    });

    it('should throw the service error if getUserById fails', async () => {
      const id = 'user-id';
      const error = new NotFoundException('User not found');
      service.getUserById.mockRejectedValue(error);

      await expect(controller.getUserById(id)).rejects.toThrow(error);
    });
  });

  describe('getUserFields', () => {
    it('should call getUserFields with user_id and fields and return result', async () => {
      const user_id = 'user-id';
      const fields = ['id', 'first_name'];
      const result = { id: 'user-id', first_name: 'John' };
      service.getUserFields.mockResolvedValue(result);

      const response = await controller.getUserFields(user_id, fields);
      expect(service.getUserFields).toHaveBeenCalledWith(user_id, fields);
      expect(response).toEqual(result);
    });

    it('should throw error if fields is empty', async () => {
      const user_id = 'user-id';
      const fields: string[] = [];

      await expect(controller.getUserFields(user_id, fields)).rejects.toThrow(
        new Error('Fields query parameter is required'),
      );
      expect(service.getUserFields).not.toHaveBeenCalled();
    });

    it('should throw the service error if getUserFields fails', async () => {
      const user_id = 'user-id';
      const fields = ['id', 'first_name'];
      const error = new NotFoundException('User not found');
      service.getUserFields.mockRejectedValue(error);

      await expect(controller.getUserFields(user_id, fields)).rejects.toThrow(
        error,
      );
    });
  });

  describe('getAllUsers', () => {
    const mockQuery: UserFilter = { page: 1, size: 10 };

    it('should call getAllUsers with query and return result', async () => {
      const result = { users: [], pagination: { totalRows: 0 } };
      service.getAllUsers.mockResolvedValue(result);

      const response = await controller.getAllUsers(mockQuery);
      expect(service.getAllUsers).toHaveBeenCalledWith(mockQuery);
      expect(response).toEqual(result);
    });

    it('should throw the service error if getAllUsers fails', async () => {
      const error = new Error('Query error');
      service.getAllUsers.mockRejectedValue(error);

      await expect(controller.getAllUsers(mockQuery)).rejects.toThrow(error);
    });
  });

  describe('updateUserById', () => {
    const mockUpdateDto: UpdateUserDto = { first_name: 'Updated Name' };

    it('should call updateUserById with id and body and return result', async () => {
      const id = 'user-id';
      const result = { affected: 1 };
      service.updateUserById.mockResolvedValue(result);

      const response = await controller.updateUserById(id, mockUpdateDto);
      expect(service.updateUserById).toHaveBeenCalledWith(id, mockUpdateDto);
      expect(response).toEqual(result);
    });

    it('should throw the service error if updateUserById fails', async () => {
      const id = 'user-id';
      const error = new NotFoundException('User not found');
      service.updateUserById.mockRejectedValue(error);

      await expect(
        controller.updateUserById(id, mockUpdateDto),
      ).rejects.toThrow(error);
    });
  });

  describe('login', () => {
    const mockLoginDto: LoginDto = {
      email: 'test@example.com',
      password: 'password',
    };

    it('should call loginUser with body and res and return result', async () => {
      const result = { user: {}, access_token: 'token' };
      service.loginUser.mockResolvedValue(result);

      const response = await controller.login(mockLoginDto, mockResponse);
      expect(service.loginUser).toHaveBeenCalledWith(
        mockLoginDto,
        mockResponse,
      );
      expect(response).toEqual(result);
    });

    it('should throw the service error if loginUser fails', async () => {
      const error = new UnauthorizedException('Invalid credentials');
      service.loginUser.mockRejectedValue(error);

      await expect(
        controller.login(mockLoginDto, mockResponse),
      ).rejects.toThrow(error);
    });
  });

  describe('logout', () => {
    it('should call logoutUser with res and return result', async () => {
      const result = { message: 'Logout successful' };
      service.logoutUser.mockResolvedValue(result);

      const response = await controller.logout(mockResponse);
      expect(service.logoutUser).toHaveBeenCalledWith(mockResponse);
      expect(response).toEqual(result);
    });

    it('should throw the service error if logoutUser fails', async () => {
      const error = new Error('Logout error');
      service.logoutUser.mockRejectedValue(error);

      await expect(controller.logout(mockResponse)).rejects.toThrow(error);
    });
  });

  describe('deleteUserById', () => {
    it('should call deleteUserById with id and return result', async () => {
      const id = 'user-id';
      const result = { deleted: true };
      service.deleteUserById.mockResolvedValue(result);

      const response = await controller.deleteUserById(id);
      expect(service.deleteUserById).toHaveBeenCalledWith(id);
      expect(response).toEqual(result);
    });

    it('should throw the service error if deleteUserById fails', async () => {
      const id = 'user-id';
      const error = new NotFoundException('User not found');
      service.deleteUserById.mockRejectedValue(error);

      await expect(controller.deleteUserById(id)).rejects.toThrow(error);
    });
  });

  describe('forgotPassword', () => {
    const mockBody = { email: 'test@example.com' };

    it('should call forgotPassword and send success response', async () => {
      service.forgotPassword.mockResolvedValue(undefined);

      await controller.forgotPassword(mockBody, mockResponse);

      expect(service.forgotPassword).toHaveBeenCalledWith('test@example.com');
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Check your Email',
      });
    });

    it('should send 500 response if service throws error', async () => {
      service.forgotPassword.mockRejectedValue(new Error('Service error'));

      await controller.forgotPassword(mockBody, mockResponse);

      expect(service.forgotPassword).toHaveBeenCalledWith('test@example.com');
      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Internal Server Error',
      });
    });
  });

  describe('validateOtp', () => {
    const mockBody = { otp: '123456' };

    it('should call validateOtp and send response', async () => {
      const serviceResult = { message: 'OTP validated', token: 'token' };
      service.validateOtp.mockResolvedValue(serviceResult);

      await controller.validateOtp(mockBody, mockResponse);

      expect(service.validateOtp).toHaveBeenCalledWith('123456');
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(serviceResult);
    });

    it('should send 500 response if service throws error', async () => {
      service.validateOtp.mockRejectedValue(new Error('Service error'));

      await controller.validateOtp(mockBody, mockResponse);

      expect(service.validateOtp).toHaveBeenCalledWith('123456');
      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Internal Server Error',
      });
    });
  });

  describe('resendOtp', () => {
    const mockBody = { token: 'resend-token' };

    it('should call resendOtp and send response', async () => {
      const serviceResult = { message: 'OTP resent', token: 'new-token' };
      service.resendOtp.mockResolvedValue(serviceResult);

      await controller.resendOtp(mockBody, mockResponse);

      expect(service.resendOtp).toHaveBeenCalledWith('resend-token');
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(serviceResult);
    });

    it('should send 500 response if service throws error', async () => {
      service.resendOtp.mockRejectedValue(new Error('Service error'));

      await controller.resendOtp(mockBody, mockResponse);

      expect(service.resendOtp).toHaveBeenCalledWith('resend-token');
      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Internal Server Error',
      });
    });
  });

  describe('resetPassword', () => {
    const mockBody: ResetDto = {
      token: 'reset-token',
      newPassword: 'newPass123',
    };

    it('should call resetPassword and return success message', async () => {
      service.resetPassword.mockResolvedValue(undefined);

      const response = await controller.resetPassword(mockBody, mockResponse);

      expect(service.resetPassword).toHaveBeenCalledWith(
        mockBody,
        mockResponse,
      );
      expect(response).toEqual({ message: 'Password reset successful' });
    });

    it('should throw the service error if resetPassword fails', async () => {
      const error = new BadRequestException('Invalid token');
      service.resetPassword.mockRejectedValue(error);

      await expect(
        controller.resetPassword(mockBody, mockResponse),
      ).rejects.toThrow(error);
    });
  });

  describe('uploadLogos', () => {
    const mockFiles = [
      { originalname: 'logo1.png' },
      { originalname: 'logo2.png' },
    ] as Express.Multer.File[];

    it('should call uploadLogos with user_id and files and return result', async () => {
      const result = { logo_urls: ['url1', 'url2'] };
      service.uploadLogos.mockResolvedValue(result);

      const response = await controller.uploadLogos(mockFiles, mockRequest);
      expect(service.uploadLogos).toHaveBeenCalledWith('user-id', mockFiles);
      expect(response).toEqual(result);
    });

    it('should throw the service error if uploadLogos fails', async () => {
      const error = new HttpException(
        'Upload failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      service.uploadLogos.mockRejectedValue(error);

      await expect(
        controller.uploadLogos(mockFiles, mockRequest),
      ).rejects.toThrow(error);
    });
  });

  describe('completeKyc', () => {
    const mockUserId = 'user-id';
    const mockKycDto: CreateKycDto = {
      occupation: 'Engineer',
      employers_name: 'Tech Corp',
      employers_address: '123 Street',
      state_of_origin: 'Lagos',
      nationality: 'Nigerian',
      religion: 'Christianity',
      marital_status: 'Single',
      monthly_income: '100000',
      accept_terms_and_condition: true,
    };

    it('should call createUserKyc with userId and dto and return KYC', async () => {
      const result: KYC = { id: 'kyc-id', ...mockKycDto };
      service.createUserKyc.mockResolvedValue(result);

      const response = await controller.completeKyc(mockUserId, mockKycDto);
      expect(service.createUserKyc).toHaveBeenCalledWith(
        mockUserId,
        mockKycDto,
      );
      expect(response).toEqual(result);
    });

    it('should throw the service error if createUserKyc fails', async () => {
      const error = new BadRequestException('KYC already submitted');
      service.createUserKyc.mockRejectedValue(error);

      await expect(
        controller.completeKyc(mockUserId, mockKycDto),
      ).rejects.toThrow(error);
    });
  });

  describe('updateKyc', () => {
    const mockUserId = 'user-id';
    const mockUpdateDto: UpdateKycDto = { status: 'approved' };

    it('should call update with userId and dto and return KYC', async () => {
      const result: KYC = { id: 'kyc-id', status: 'approved' };
      service.update.mockResolvedValue(result);

      const response = await controller.updateKyc(mockUserId, mockUpdateDto);
      expect(service.update).toHaveBeenCalledWith(mockUserId, mockUpdateDto);
      expect(response).toEqual(result);
    });

    it('should throw the service error if update fails', async () => {
      const error = new NotFoundException('KYC record not found');
      service.update.mockRejectedValue(error);

      await expect(
        controller.updateKyc(mockUserId, mockUpdateDto),
      ).rejects.toThrow(error);
    });
  });

  describe('createAdmin', () => {
    const mockAdminDto: CreateAdminDto = {
      first_name: 'Admin',
      last_name: 'User',
      email: 'admin@example.com',
      phone_number: '+2348100000000',
      property_id: 'property-id',
      password: 'Password5%',
    };

    it('should call createAdmin with dto and return user without password', async () => {
      const result = {
        first_name: 'Admin',
        last_name: 'User',
        email: 'admin@example.com',
      };
      service.createAdmin.mockResolvedValue(result);

      const response = await controller.createAdmin(mockAdminDto);
      expect(service.createAdmin).toHaveBeenCalledWith(mockAdminDto);
      expect(response).toEqual(result);
    });

    it('should throw the service error if createAdmin fails', async () => {
      const error = new BadRequestException('Account exists');
      service.createAdmin.mockRejectedValue(error);

      await expect(controller.createAdmin(mockAdminDto)).rejects.toThrow(error);
    });
  });

  describe('createLandlord', () => {
    const mockLandlordDto: CreateLandlordDto = {
      first_name: 'Landlord',
      last_name: 'Smith',
      agency_name: 'Agency',
      email: 'landlord@example.com',
      phone_number: '+2348100000000',
      property_id: 'property-id',
      password: 'Password5%',
    };

    it('should call createLandlord with dto and return user without password', async () => {
      const result = {
        first_name: 'Landlord',
        last_name: 'Smith',
        email: 'landlord@example.com',
      };
      service.createLandlord.mockResolvedValue(result);

      const response = await controller.createLandlord(mockLandlordDto);
      expect(service.createLandlord).toHaveBeenCalledWith(mockLandlordDto);
      expect(response).toEqual(result);
    });

    it('should throw the service error if createLandlord fails', async () => {
      const error = new BadRequestException('Account exists');
      service.createLandlord.mockRejectedValue(error);

      await expect(controller.createLandlord(mockLandlordDto)).rejects.toThrow(
        error,
      );
    });
  });

  describe('createCustomerRep', () => {
    const mockRepDto: CreateCustomerRepDto = {
      first_name: 'Rep',
      last_name: 'Johnson',
      email: 'rep@example.com',
      phone_number: '+2348100000000',
      password: 'Password5%',
      property_id: 'property-id',
    };

    it('should call createCustomerRep with dto and return user without password', async () => {
      const result = {
        first_name: 'Rep',
        last_name: 'Johnson',
        email: 'rep@example.com',
      };
      service.createCustomerRep.mockResolvedValue(result);

      const response = await controller.createCustomerRep(mockRepDto);
      expect(service.createCustomerRep).toHaveBeenCalledWith(mockRepDto);
      expect(response).toEqual(result);
    });

    it('should throw the service error if createCustomerRep fails', async () => {
      const error = new BadRequestException('Account exists');
      service.createCustomerRep.mockRejectedValue(error);

      await expect(controller.createCustomerRep(mockRepDto)).rejects.toThrow(
        error,
      );
    });
  });

  describe('getSubAccounts', () => {
    it('should call getSubAccounts with adminId and return result', async () => {
      const result = [{ id: 'sub-id', email: 'sub@example.com' }];
      service.getSubAccounts.mockResolvedValue(result);

      const response = await controller.getSubAccounts(mockRequest);
      expect(service.getSubAccounts).toHaveBeenCalledWith('user-id');
      expect(response).toEqual(result);
    });

    it('should throw the service error if getSubAccounts fails', async () => {
      const error = new Error('Service error');
      service.getSubAccounts.mockRejectedValue(error);

      await expect(controller.getSubAccounts(mockRequest)).rejects.toThrow(
        error,
      );
    });
  });

  describe('switchAccount', () => {
    const mockId = 'target-id';

    it('should call switchAccount with params and return result', async () => {
      const result = { success: true, message: 'Switched' };
      service.switchAccount.mockResolvedValue(result);

      const response = await controller.switchAccount(
        mockId,
        mockRequest,
        mockResponse,
      );
      expect(service.switchAccount).toHaveBeenCalledWith({
        targetAccountId: mockId,
        currentAccount: mockRequest.user,
        res: mockResponse,
      });
      expect(response).toEqual(result);
    });

    it('should throw the service error if switchAccount fails', async () => {
      const error = new ForbiddenException('Cannot switch');
      service.switchAccount.mockRejectedValue(error);

      await expect(
        controller.switchAccount(mockId, mockRequest, mockResponse),
      ).rejects.toThrow(error);
    });
  });

  describe('assignCollaborator', () => {
    const mockTeamMember = {
      email: 'collab@example.com',
      permissions: ['read'],
      role: RolesEnum.REP,
      first_name: 'Collab',
      last_name: 'User',
      phone_number: '+2348100000000',
    };

    it('should call assignCollaboratorToTeam with user.id and team_member and return result', async () => {
      const result = { id: 'collab-id', email: 'collab@example.com' };
      service.assignCollaboratorToTeam.mockResolvedValue(result);

      const response = await controller.assignCollaborator(
        mockTeamMember,
        mockRequest,
      );
      expect(service.assignCollaboratorToTeam).toHaveBeenCalledWith(
        'user-id',
        mockTeamMember,
      );
      expect(response).toEqual(result);
    });

    it('should throw the service error if assignCollaboratorToTeam fails', async () => {
      const error = new HttpException('Already in team', HttpStatus.CONFLICT);
      service.assignCollaboratorToTeam.mockRejectedValue(error);

      await expect(
        controller.assignCollaborator(mockTeamMember, mockRequest),
      ).rejects.toThrow(error);
    });
  });
});

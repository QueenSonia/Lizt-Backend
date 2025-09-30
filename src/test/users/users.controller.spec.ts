/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from 'src/users/users.controller';
import { UsersService } from 'src/users/users.service';
import { Response } from 'express';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ADMIN_ROLES, RolesEnum } from 'src/base.entity';
import {
  CreateAdminDto,
  CreateCustomerRepDto,
  CreateLandlordDto,
  CreateTenantDto,
} from 'src/users/dto/create-user.dto';
import { CreateKycDto } from 'src/users/dto/create-kyc.dto';

describe('UsersController', () => {
  let controller: UsersController;
  let service: UsersService;

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

  const mockRequest = {
    user: { id: 'user-id', role: ADMIN_ROLES.ADMIN },
    query: { user_id: 'some-id' },
    params: { tenant_id: 'tenant-id' },
  };

  const mockResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
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
    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getWaitlist', () => {
    it('should call getWaitlist service method', async () => {
      // Arrange
      const result = { waitlist: [] };
      mockUsersService.getWaitlist.mockResolvedValue(result);

      // Act
      const response = await controller.getWaitlist();

      // Assert
      expect(mockUsersService.getWaitlist).toHaveBeenCalled();
      expect(response).toEqual(result);
    });
  });

  describe('getLandlords', () => {
    it('should call getLandlords service method', async () => {
      const result = { landlords: [] };
      mockUsersService.getLandlords.mockResolvedValue(result);

      const response = await controller.getLandlords();
      expect(mockUsersService.getLandlords).toHaveBeenCalled();
      expect(response).toEqual(result);
    });
  });

  describe('getTeamMembers', () => {
    it('should call getTeamMembers service method with user id', async () => {
      const result = { members: [] };
      mockUsersService.getTeamMembers.mockResolvedValue(result);

      const response = await controller.getTeamMembers(mockRequest);
      expect(mockUsersService.getTeamMembers).toHaveBeenCalledWith('user-id');
      expect(response).toEqual(result);
    });
  });

  describe('addTenant', () => {
    it('should call addTenant service method with user id and body', async () => {
      const body: CreateTenantDto = {
        phone_number: '09012345678',
        full_name: 'John Doe',
        email: 'John@email.com',
        property_id: '2345',
        due_date: new Date(),
        rent_amount: 300000,
      };

      const result = { id: 'tenant-id', ...body };
      mockUsersService.addTenant.mockResolvedValue(result);

      const response = await controller.addTenant(body, mockRequest);
      expect(mockUsersService.addTenant).toHaveBeenCalledWith('user-id', body);
      expect(response).toEqual(result);
    });
  });

  describe('getAllTenants', () => {
    it('should call getAllTenants service method with query', async () => {
      const query = { page: 1, size: 10 };
      const result = { data: [], meta: {} };
      mockUsersService.getAllTenants.mockResolvedValue(result);

      const response = await controller.getAllTenants(query);
      expect(mockUsersService.getAllTenants).toHaveBeenCalledWith(query);
      expect(response).toEqual(result);
    });
  });

  describe('getProfile', () => {
    it('should call getAccountById with user_id from query when present', async () => {
      const result = { id: 'some-id', first_name: 'John' };
      mockUsersService.getAccountById.mockResolvedValue(result);

      const response = await controller.getProfile(mockRequest);
      expect(mockUsersService.getAccountById).toHaveBeenCalledWith('some-id');
      expect(response).toEqual(result);
    });

    it('should call getAccountById with user.id when user_id not in query', async () => {
      const req = { user: { id: 'user-id' }, query: {} };
      const result = { id: 'user-id', first_name: 'John' };
      mockUsersService.getAccountById.mockResolvedValue(result);

      const response = await controller.getProfile(req);
      expect(mockUsersService.getAccountById).toHaveBeenCalledWith('user-id');
      expect(response).toEqual(result);
    });
  });

  describe('getTenantsOfAnAdmin', () => {
    it('should call getTenantsOfAnAdmin with creator_id and query', async () => {
      const query = { page: 1, size: 10 };
      const result = { data: [], meta: {} };
      mockUsersService.getTenantsOfAnAdmin.mockResolvedValue(result);

      const response = await controller.getTenantsOfAnAdmin(query, mockRequest);
      expect(mockUsersService.getTenantsOfAnAdmin).toHaveBeenCalledWith(
        'user-id',
        query,
      );
      expect(response).toEqual(result);
    });
  });

  describe('getSingleTenantOfAnAdmin', () => {
    it('should call getSingleTenantOfAnAdmin with tenant_id from params', async () => {
      const result = { id: 'tenant-id', first_name: 'John' };
      mockUsersService.getSingleTenantOfAnAdmin.mockResolvedValue(result);

      const response = await controller.getSingleTenantOfAnAdmin(mockRequest);
      expect(mockUsersService.getSingleTenantOfAnAdmin).toHaveBeenCalledWith(
        'tenant-id',
      );
      expect(response).toEqual(result);
    });
  });

  describe('getTenantAndPropertyInfo', () => {
    it('should call getTenantAndPropertyInfo with user id', async () => {
      const result = { tenant: {}, property: {} };
      mockUsersService.getTenantAndPropertyInfo.mockResolvedValue(result);

      const response = await controller.getTenantAndPropertyInfo(mockRequest);
      expect(mockUsersService.getTenantAndPropertyInfo).toHaveBeenCalledWith(
        'user-id',
      );
      expect(response).toEqual(result);
    });
  });

  describe('getUserById', () => {
    it('should call getUserById with id parameter', async () => {
      const id = 'user-id';
      const result = { id: 'user-id', first_name: 'John' };
      mockUsersService.getUserById.mockResolvedValue(result);

      const response = await controller.getUserById(id);
      expect(mockUsersService.getUserById).toHaveBeenCalledWith(id);
      expect(response).toEqual(result);
    });
  });

  describe('getUserFields', () => {
    it('should call getUserFields with user_id and fields', async () => {
      const user_id = 'user-id';
      const fields = ['id', 'first_name', 'email'];
      const result = {
        id: 'user-id',
        first_name: 'John',
        email: 'john@example.com',
      };
      mockUsersService.getUserFields.mockResolvedValue(result);

      const response = await controller.getUserFields(user_id, fields);
      expect(mockUsersService.getUserFields).toHaveBeenCalledWith(
        user_id,
        fields,
      );
      expect(response).toEqual(result);
    });

    it('should throw error when fields array is empty', async () => {
      const user_id = 'user-id';
      const fields: string[] = [];

      await expect(controller.getUserFields(user_id, fields)).rejects.toThrow(
        'Fields query parameter is required',
      );
    });
  });

  describe('getAllUsers', () => {
    it('should call getAllUsers with query', async () => {
      const query = { page: 1, size: 10 };
      const result = { data: [], meta: {} };
      mockUsersService.getAllUsers.mockResolvedValue(result);

      const response = await controller.getAllUsers(query);
      expect(mockUsersService.getAllUsers).toHaveBeenCalledWith(query);
      expect(response).toEqual(result);
    });
  });

  describe('updateUserById', () => {
    it('should call updateUserById with id and body', async () => {
      const id = 'user-id';
      const body = { first_name: 'Jane' };
      const result = { id, first_name: 'Jane' };
      mockUsersService.updateUserById.mockResolvedValue(result);

      const response = await controller.updateUserById(id, body);
      expect(mockUsersService.updateUserById).toHaveBeenCalledWith(id, body);
      expect(response).toEqual(result);
    });
  });

  describe('login', () => {
    it('should call loginUser with body and response', async () => {
      const body = { email: 'test@example.com', password: 'password' };
      const result = { user: {}, token: 'token' };
      mockUsersService.loginUser.mockResolvedValue(result);

      const response = await controller.login(body, mockResponse);
      expect(mockUsersService.loginUser).toHaveBeenCalledWith(
        body,
        mockResponse,
      );
      expect(response).toEqual(result);
    });
  });

  describe('logout', () => {
    it('should call logoutUser with response', async () => {
      const result = { message: 'Logged out' };
      mockUsersService.logoutUser.mockResolvedValue(result);

      const response = await controller.logout(mockResponse);
      expect(mockUsersService.logoutUser).toHaveBeenCalledWith(mockResponse);
      expect(response).toEqual(result);
    });
  });

  describe('deleteUserById', () => {
    it('should call deleteUserById with id', async () => {
      const id = 'user-id';
      const result = { message: 'User deleted' };
      mockUsersService.deleteUserById.mockResolvedValue(result);

      const response = await controller.deleteUserById(id);
      expect(mockUsersService.deleteUserById).toHaveBeenCalledWith(id);
      expect(response).toEqual(result);
    });
  });

  describe('forgotPassword', () => {
    it('should call forgotPassword and return success message', async () => {
      const body = { email: 'test@example.com' };
      mockUsersService.forgotPassword.mockResolvedValue(undefined);

      await controller.forgotPassword(body, mockResponse);

      expect(mockUsersService.forgotPassword).toHaveBeenCalledWith(
        'test@example.com',
      );
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Check your Email',
      });
    });

    it('should return error message when service throws error', async () => {
      const body = { email: 'test@example.com' };
      mockUsersService.forgotPassword.mockRejectedValue(new Error());

      await controller.forgotPassword(body, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Internal Server Error',
      });
    });
  });

  describe('validateOtp', () => {
    it('should call validateOtp and return response', async () => {
      const body = { otp: '123456' };
      const serviceResponse = { valid: true };
      mockUsersService.validateOtp.mockResolvedValue(serviceResponse);

      await controller.validateOtp(body, mockResponse);

      expect(mockUsersService.validateOtp).toHaveBeenCalledWith('123456');
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(serviceResponse);
    });

    it('should return error message when service throws error', async () => {
      const body = { otp: '123456' };
      mockUsersService.validateOtp.mockRejectedValue(new Error());

      await controller.validateOtp(body, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Internal Server Error',
      });
    });
  });

  describe('resendOtp', () => {
    it('should call resendOtp and return response', async () => {
      const body = { token: 'token' };
      const serviceResponse = { success: true };
      mockUsersService.resendOtp.mockResolvedValue(serviceResponse);

      await controller.resendOtp(body, mockResponse);

      expect(mockUsersService.resendOtp).toHaveBeenCalledWith('token');
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(serviceResponse);
    });

    it('should return error message when service throws error', async () => {
      const body = { token: 'token' };
      mockUsersService.resendOtp.mockRejectedValue(new Error());

      await controller.resendOtp(body, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Internal Server Error',
      });
    });
  });

  describe('resetPassword', () => {
    it('should call resetPassword and return success message', async () => {
      const body = { token: 'token', newPassword: 'newPassword' };
      mockUsersService.resetPassword.mockResolvedValue(undefined);

      const response = await controller.resetPassword(body, mockResponse);

      expect(mockUsersService.resetPassword).toHaveBeenCalledWith(
        { token: 'token', newPassword: 'newPassword' },
        mockResponse,
      );
      expect(response).toEqual({ message: 'Password reset successful' });
    });
  });

  describe('uploadLogos', () => {
    it('should call uploadLogos with user id and files', async () => {
      const files = [{ originalname: 'logo.png' }] as Express.Multer.File[];
      const result = { message: 'Logos uploaded' };
      mockUsersService.uploadLogos.mockResolvedValue(result);

      const response = await controller.uploadLogos(files, mockRequest);
      expect(mockUsersService.uploadLogos).toHaveBeenCalledWith(
        'user-id',
        files,
      );
      expect(response).toEqual(result);
    });
  });

  describe('completeKyc', () => {
    it('should call createUserKyc with userId and createKycDto', async () => {
      const userId = 'user-id';
      const createKycDto: CreateKycDto = {
        occupation: 'Engineer',
        employers_name: 'Tech Corp',
        employers_address: '123 Street',
        state_of_origin: 'Lagos',
        nationality: 'Nigerian',
        religion: 'Islam',
        marital_status: 'Single',
        monthly_income: '200000',
        accept_terms_and_condition: true,
      };
      const result = { ...createKycDto };
      mockUsersService.createUserKyc.mockResolvedValue(result);

      const response = await controller.completeKyc(userId, createKycDto);
      expect(mockUsersService.createUserKyc).toHaveBeenCalledWith(
        userId,
        createKycDto,
      );
      expect(response).toEqual(result);
    });
  });

  describe('updateKyc', () => {
    it('should call update with userId and updateKycDto', async () => {
      const userId = 'user-id';
      const updateKycDto = { status: 'approved' };
      const result = { id: 'kyc-id', status: 'approved' };
      mockUsersService.update.mockResolvedValue(result);

      const response = await controller.updateKyc(userId, updateKycDto);
      expect(mockUsersService.update).toHaveBeenCalledWith(
        userId,
        updateKycDto,
      );
      expect(response).toEqual(result);
    });
  });

  describe('createAdmin', () => {
    it('should call createAdmin with createUserDto', async () => {
      const createUserDto: CreateAdminDto = {
        first_name: 'Admin',
        last_name: 'User',
        email: 'admin@example.com',
        phone_number: '+2348100000000',
        property_id: '90b7f325-be27-45a7-9688-fa49630cac8f',
        password: 'Password5%',
      };
      const result = { ...createUserDto, role: RolesEnum.ADMIN };
      mockUsersService.createAdmin.mockResolvedValue(result);

      const response = await controller.createAdmin(createUserDto);
      expect(mockUsersService.createAdmin).toHaveBeenCalledWith(createUserDto);
      expect(response).toEqual(result);
    });
  });

  describe('createLandlord', () => {
    it('should call createLandlord with createUserDto', async () => {
      const createUserDto: CreateLandlordDto = {
        first_name: 'Landlord',
        last_name: 'Smith',
        agency_name: 'SuperAgency',
        email: 'landlord@example.com',
        phone_number: '+2348100000000',
        property_id: '90b7f325-be27-45a7-9688-fa49630cac8f',
        password: 'Password5%',
      };

      const result = { ...createUserDto, role: RolesEnum.LANDLORD };
      mockUsersService.createLandlord.mockResolvedValue(result);

      const response = await controller.createLandlord(createUserDto);
      expect(mockUsersService.createLandlord).toHaveBeenCalledWith(
        createUserDto,
      );
      expect(response).toEqual(result);
    });
  });

  describe('createCustomerRep', () => {
    it('should call createCustomerRep with createUserDto', async () => {
      const createUserDto: CreateCustomerRepDto = {
        first_name: 'Rep',
        last_name: 'Johnson',
        email: 'rep@example.com',
        phone_number: '+2348100000000',
        password: 'Password5%',
        property_id: '90b7f325-be27-45a7-9688-fa49630cac8f',
      };
      const result = { ...createUserDto, role: RolesEnum.REP };
      mockUsersService.createCustomerRep.mockResolvedValue(result);

      const response = await controller.createCustomerRep(createUserDto);
      expect(mockUsersService.createCustomerRep).toHaveBeenCalledWith(
        createUserDto,
      );
      expect(response).toEqual(result);
    });
  });

  describe('getSubAccounts', () => {
    it('should call getSubAccounts with adminId', async () => {
      const req = { user: { id: 'admin-id' } };
      const result = { subAccounts: [] };
      mockUsersService.getSubAccounts.mockResolvedValue(result);

      const response = await controller.getSubAccounts(req);
      expect(mockUsersService.getSubAccounts).toHaveBeenCalledWith('admin-id');
      expect(response).toEqual(result);
    });
  });

  describe('switchAccount', () => {
    it('should call switchAccount with targetAccountId, currentAccount and response', async () => {
      const id = 'target-id';
      const req = { user: { id: 'current-user' } };
      const result = { account: {} };
      mockUsersService.switchAccount.mockResolvedValue(result);

      const response = await controller.switchAccount(id, req, mockResponse);
      expect(mockUsersService.switchAccount).toHaveBeenCalledWith({
        targetAccountId: id,
        currentAccount: { id: 'current-user' },
        res: mockResponse,
      });
      expect(response).toEqual(result);
    });
  });

  describe('assignCollaborator', () => {
    it('should call assignCollaboratorToTeam with adminId and team member details', async () => {
      const teamMember = {
        email: 'collaborator@example.com',
        permissions: ['read', 'write'],
        role: RolesEnum.TENANT,
        first_name: 'John',
        last_name: 'Doe',
        phone_number: '1234567890',
      };
      const req = { user: { id: 'admin-id' } };
      const result = { collaborator: {} };
      mockUsersService.assignCollaboratorToTeam.mockResolvedValue(result);

      const response = await controller.assignCollaborator(teamMember, req);
      expect(mockUsersService.assignCollaboratorToTeam).toHaveBeenCalledWith(
        'admin-id',
        teamMember,
      );
      expect(response).toEqual(result);
    });
  });
});

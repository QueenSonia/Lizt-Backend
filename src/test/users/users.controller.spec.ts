import { HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { RolesEnum } from 'src/base.entity';
import { CreateTenantDto, UserFilter } from 'src/users/dto/create-user.dto';
import { PaginationResponseDto } from 'src/users/dto/paginate.dto';
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
});

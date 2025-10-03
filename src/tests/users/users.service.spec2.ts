import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from 'src/users/users.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Users } from 'src/users/entities/user.entity';
import { Account } from 'src/users/entities/account.entity';
import { PasswordResetToken } from 'src/users/entities/password-reset-token.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Rent } from 'src/rents/entities/rent.entity';
import { KYC } from 'src/users/entities/kyc.entity';
import { Team } from 'src/users/entities/team.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { Waitlist } from 'src/users/entities/waitlist.entity';
import { ConfigService } from '@nestjs/config';
import { AuthService } from 'src/auth/auth.service';
import { FileUploadService } from 'src/utils/cloudinary';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WhatsappBotService } from 'src/whatsapp-bot/whatsapp-bot.service';
import { CacheService } from 'src/lib/cache';
import { DataSource, Repository } from 'typeorm';
import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { RolesEnum } from 'src/base.entity';
import { UtilService } from 'src/utils/utility-service';

describe('UsersService', () => {
  let service: UsersService;
  let usersRepository: Repository<Users>;
  let accountRepository: Repository<Account>;
  let passwordResetRepository: Repository<PasswordResetToken>;
  let propertyTenantRepository: Repository<PropertyTenant>;
  let rentRepository: Repository<Rent>;
  let kycRepository: Repository<KYC>;
  let teamRepository: Repository<Team>;
  let teamMemberRepository: Repository<TeamMember>;
  let waitlistRepository: Repository<Waitlist>;
  let dataSource: DataSource;

  const mockRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn(),
    createQueryBuilder: jest.fn(),
    merge: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn(),
    createQueryRunner: jest.fn(() => ({
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        findOne: jest.fn(),
        save: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        exists: jest.fn(),
        getRepository: jest.fn(() => mockRepository),
      },
    })),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config = {
        FRONTEND_URL: 'http://localhost:3000',
        NODE_ENV: 'test',
        GMAIL_USER: 'test@example.com',
      };
      return config[key];
    }),
  };

  const mockAuthService = {
    generateToken: jest.fn(),
  };

  const mockFileUploadService = {
    uploadFile: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockWhatsappBotService = {
    sendTenantWelcomeTemplate: jest.fn(),
    sendToUserWithTemplate: jest.fn(),
    sendUserAddedTemplate: jest.fn(),
    sendToFacilityManagerWithTemplate: jest.fn(),
    sendText: jest.fn(),
    sendToPropertiesCreatedTemplate: jest.fn(),
  };

  const mockCacheService = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(Users),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(Account),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(PasswordResetToken),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(PropertyTenant),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(Rent),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(KYC),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(Team),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(TeamMember),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(Waitlist),
          useValue: mockRepository,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: FileUploadService,
          useValue: mockFileUploadService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: WhatsappBotService,
          useValue: mockWhatsappBotService,
        },
        {
          provide: CacheService,
          useValue: mockCacheService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    usersRepository = module.get(getRepositoryToken(Users));
    accountRepository = module.get(getRepositoryToken(Account));
    passwordResetRepository = module.get(
      getRepositoryToken(PasswordResetToken),
    );
    propertyTenantRepository = module.get(getRepositoryToken(PropertyTenant));
    rentRepository = module.get(getRepositoryToken(Rent));
    kycRepository = module.get(getRepositoryToken(KYC));
    teamRepository = module.get(getRepositoryToken(Team));
    teamMemberRepository = module.get(getRepositoryToken(TeamMember));
    waitlistRepository = module.get(getRepositoryToken(Waitlist));
    dataSource = module.get(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addTenant', () => {
    const mockAdminAccount = {
      id: 'admin-id',
      role: RolesEnum.LANDLORD,
      user: {
        phone_number: '2348012345678',
      },
      profile_name: 'Admin User',
    };

    const mockProperty = {
      id: 'property-id',
      name: 'Test Property',
      owner_id: 'admin-id',
    };

    const createTenantDto = {
      phone_number: '+2348012345678',
      full_name: 'John Doe',
      email: 'john@example.com',
      property_id: 'property-id',
      due_date: new Date('2025-12-31'),
      rent_amount: 500000,
    };

    it('should add tenant successfully', async () => {
      const transactionMock = jest.fn(async (callback) => {
        const manager = {
          getRepository: jest.fn((entity) => ({
            findOne: jest
              .fn()
              .mockResolvedValue(
                entity.name === 'Property'
                  ? mockProperty
                  : entity.name === 'Account'
                    ? mockAdminAccount
                    : null,
              ),
            create: jest.fn((data) => ({ ...data, id: 'new-id' })),
            save: jest.fn((data) => Promise.resolve(data)),
          })),
        };
        return callback(manager);
      });

      mockDataSource.transaction = transactionMock;

      const result = await service.addTenant('admin-id', createTenantDto);

      expect(result).toBeDefined();
      expect(transactionMock).toHaveBeenCalled();
    });

    it('should throw error if admin not found', async () => {
      const transactionMock = jest.fn(async (callback) => {
        const manager = {
          getRepository: jest.fn(() => ({
            findOne: jest.fn().mockResolvedValue(null),
          })),
        };
        return callback(manager);
      });

      mockDataSource.transaction = transactionMock;
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.addTenant('invalid-id', createTenantDto),
      ).rejects.toThrow('admin account not found');
    });

    it('should throw error if tenant already exists', async () => {
      const existingTenant = {
        id: 'existing-tenant-id',
        phone_number: '2348012345678',
      };

      const transactionMock = jest.fn(async (callback) => {
        const manager = {
          getRepository: jest.fn((entity) => ({
            findOne: jest
              .fn()
              .mockResolvedValue(
                entity.name === 'Account'
                  ? mockAdminAccount
                  : entity.name === 'Users'
                    ? existingTenant
                    : null,
              ),
          })),
        };
        return callback(manager);
      });

      mockDataSource.transaction = transactionMock;

      await expect(
        service.addTenant('admin-id', createTenantDto),
      ).rejects.toThrow();
    });
  });

  describe('getAllUsers', () => {
    it('should return paginated users', async () => {
      const mockUsers = [
        {
          id: '1',
          first_name: 'John',
          last_name: 'Doe',
          email: 'john@example.com',
        },
        {
          id: '2',
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
        },
      ];

      mockRepository.findAndCount.mockResolvedValue([mockUsers, 2]);

      const result = await service.getAllUsers({ page: 1, size: 10 });

      expect(result.users).toEqual(mockUsers);
      expect(result.pagination.totalRows).toBe(2);
      expect(result.pagination.currentPage).toBe(1);
      expect(result.pagination.perPage).toBe(10);
    });

    it('should handle empty results', async () => {
      mockRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getAllUsers({ page: 1, size: 10 });

      expect(result.users).toEqual([]);
      expect(result.pagination.totalRows).toBe(0);
    });
  });

  describe('getUserById', () => {
    it('should return user by id', async () => {
      const mockUser = {
        id: 'test-id',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
      };

      mockRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.getUserById('test-id');

      expect(result).toEqual(mockUser);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-id' },
      });
    });

    it('should throw error if user not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.getUserById('invalid-id')).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('updateUserById', () => {
    it('should update user successfully', async () => {
      const mockAccount = {
        id: 'account-id',
        userId: 'user-id',
      };

      mockRepository.findOne.mockResolvedValue(mockAccount);
      mockRepository.update.mockResolvedValue({ affected: 1 });

      const updateData = {
        first_name: 'Jane',
        last_name: 'Smith',
      };

      await service.updateUserById('account-id', updateData);

      expect(mockRepository.update).toHaveBeenCalledWith(
        'account-id',
        expect.objectContaining({
          profile_name: 'Jane Smith',
        }),
      );
    });

    it('should throw error if account not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateUserById('invalid-id', { first_name: 'Jane' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteUserById', () => {
    it('should delete user successfully', async () => {
      mockRepository.delete.mockResolvedValue({ affected: 1 });

      const result = await service.deleteUserById('test-id');

      expect(result).toEqual({ affected: 1 });
      expect(mockRepository.delete).toHaveBeenCalledWith('test-id');
    });
  });

  describe('loginUser', () => {
    const loginDto = {
      email: 'test@example.com',
      password: 'Password5%',
    };

    const mockResponse: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      cookie: jest.fn(),
    };

    it('should login user successfully', async () => {
      const mockAccount = {
        id: 'account-id',
        email: 'test@example.com',
        password: 'hashed-password',
        is_verified: true,
        role: RolesEnum.LANDLORD,
        user: {
          first_name: 'John',
          last_name: 'Doe',
          phone_number: '2348012345678',
        },
      };

      mockRepository.findOne.mockResolvedValue(mockAccount);
      jest.spyOn(UtilService, 'validatePassword').mockResolvedValue(true);
      mockAuthService.generateToken.mockResolvedValue('token-123');

      await service.loginUser(loginDto, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockResponse.json).toHaveBeenCalled();
    });

    it('should throw error if user not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.loginUser(loginDto, mockResponse)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw error if password is invalid', async () => {
      const mockAccount = {
        id: 'account-id',
        email: 'test@example.com',
        password: 'hashed-password',
        role: RolesEnum.LANDLORD,
        user: {
          first_name: 'John',
          last_name: 'Doe',
        },
      };

      mockRepository.findOne.mockResolvedValue(mockAccount);
      jest.spyOn(UtilService, 'validatePassword').mockResolvedValue(false);

      await expect(service.loginUser(loginDto, mockResponse)).rejects.toThrow(
        'Invalid password',
      );
    });
  });

  describe('forgotPassword', () => {
    it('should send forgot password email', async () => {
      const email = 'test@example.com';
      const mockAccount = {
        id: 'account-id',
        email,
      };

      mockRepository.findOne.mockResolvedValue(mockAccount);
      mockRepository.save.mockResolvedValue({});
      jest.spyOn(UtilService, 'sendEmail').mockResolvedValue(true);

      const result = await service.forgotPassword(email);

      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('token');
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should throw error if user not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.forgotPassword('invalid@example.com'),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('validateOtp', () => {
    it('should validate OTP successfully', async () => {
      const otp = '123456';
      const mockEntry = {
        otp,
        token: 'token-123',
        expires_at: new Date(Date.now() + 10000),
      };

      mockRepository.findOne.mockResolvedValue(mockEntry);

      const result = await service.validateOtp(otp);

      expect(result.message).toBe('OTP validated successfully');
      expect(result.token).toBe('token-123');
    });

    it('should throw error if OTP is invalid', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.validateOtp('invalid-otp')).rejects.toThrow(
        HttpException,
      );
    });

    it('should throw error if OTP is expired', async () => {
      const mockEntry = {
        otp: '123456',
        token: 'token-123',
        expires_at: new Date(Date.now() - 10000), // expired
      };

      mockRepository.findOne.mockResolvedValue(mockEntry);

      await expect(service.validateOtp('123456')).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('resetPassword', () => {
    const mockResponse: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    it('should reset password successfully', async () => {
      const payload = {
        token: 'valid-token',
        newPassword: 'NewPassword5%',
      };

      const mockResetEntry = {
        id: 'reset-id',
        token: 'valid-token',
        user_id: 'user-id',
        expires_at: new Date(Date.now() + 10000),
      };

      const mockAccount = {
        id: 'user-id',
        email: 'test@example.com',
        is_verified: false,
        property_tenants: [{ property_id: 'property-id' }],
      };

      mockRepository.findOne
        .mockResolvedValueOnce(mockResetEntry)
        .mockResolvedValueOnce(mockAccount);
      mockRepository.save.mockResolvedValue(mockAccount);
      mockRepository.delete.mockResolvedValue({ affected: 1 });
      jest
        .spyOn(UtilService, 'hashPassword')
        .mockResolvedValue('hashed-new-password');

      const result = await service.resetPassword(payload, mockResponse);

      expect(result.message).toBe('Password reset successful');
      expect(mockRepository.save).toHaveBeenCalled();
      expect(mockRepository.delete).toHaveBeenCalled();
    });

    it('should throw error if token is invalid', async () => {
      const payload = {
        token: 'invalid-token',
        newPassword: 'NewPassword5%',
      };

      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.resetPassword(payload, mockResponse),
      ).rejects.toThrow(HttpException);
    });

    it('should throw error if token is expired', async () => {
      const payload = {
        token: 'expired-token',
        newPassword: 'NewPassword5%',
      };

      const mockResetEntry = {
        id: 'reset-id',
        token: 'expired-token',
        user_id: 'user-id',
        expires_at: new Date(Date.now() - 10000), // expired
      };

      mockRepository.findOne.mockResolvedValue(mockResetEntry);
      mockRepository.delete.mockResolvedValue({ affected: 1 });

      await expect(
        service.resetPassword(payload, mockResponse),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('uploadLogos', () => {
    it('should upload logos successfully', async () => {
      const userId = 'user-id';
      const files = [
        { filename: 'logo1.png' } as Express.Multer.File,
        { filename: 'logo2.png' } as Express.Multer.File,
      ];

      const mockUser = {
        id: userId,
        role: RolesEnum.LANDLORD,
        logo_urls: [],
      };

      mockRepository.findOne.mockResolvedValue(mockUser);
      mockFileUploadService.uploadFile.mockResolvedValue({
        secure_url: 'https://example.com/logo.png',
      });
      mockRepository.save.mockResolvedValue({
        ...mockUser,
        logo_urls: [
          'https://example.com/logo1.png',
          'https://example.com/logo2.png',
        ],
      });

      const result = await service.uploadLogos(userId, files);

      expect(result.logo_urls).toHaveLength(2);
      expect(mockFileUploadService.uploadFile).toHaveBeenCalledTimes(2);
    });

    it('should throw error if user not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.uploadLogos('invalid-id', [])).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('createAdmin', () => {
    it('should create admin successfully', async () => {
      const createAdminDto = {
        first_name: 'Admin',
        last_name: 'User',
        email: 'admin@example.com',
        phone_number: '+2348012345678',
        password: 'Password5%',
        property_id: 'property-id-123',
      };

      mockRepository.findOne.mockResolvedValue(null); // No existing account
      mockRepository.save.mockResolvedValue({
        id: 'new-admin-id',
        ...createAdminDto,
        role: RolesEnum.ADMIN,
      });
      jest
        .spyOn(UtilService, 'hashPassword')
        .mockResolvedValue('hashed-password');

      const result = await service.createAdmin(createAdminDto);

      expect(result).toBeDefined();
      expect(result).not.toHaveProperty('password');
    });

    it('should throw error if admin already exists', async () => {
      const createAdminDto = {
        first_name: 'Admin',
        last_name: 'User',
        email: 'admin@example.com',
        phone_number: '+2348012345678',
        password: 'Password5%',
        property_id: 'property-id-123',
      };

      mockRepository.findOne.mockResolvedValue({ id: 'existing-admin' });

      await expect(service.createAdmin(createAdminDto)).rejects.toThrow(
        'Admin Account with this email already exists',
      );
    });
  });

  describe('createLandlord', () => {
    it('should create landlord successfully', async () => {
      const createLandlordDto = {
        first_name: 'Landlord',
        last_name: 'User',
        agency_name: 'Agency Name',
        email: 'landlord@example.com',
        phone_number: '+2348012345678',
        password: 'Password5%',
        property_id: 'property-id-123',
      };

      mockRepository.findOne.mockResolvedValue(null);
      mockRepository.save.mockResolvedValue({
        id: 'new-landlord-id',
        ...createLandlordDto,
        role: RolesEnum.LANDLORD,
      });
      jest
        .spyOn(UtilService, 'hashPassword')
        .mockResolvedValue('hashed-password');

      const result = await service.createLandlord(createLandlordDto);

      expect(result).toBeDefined();
      expect(result).not.toHaveProperty('password');
    });
  });

  describe('assignCollaboratorToTeam', () => {
    it('should assign collaborator to team successfully', async () => {
      const userId = 'landlord-id';
      const teamMember = {
        email: 'member@example.com',
        permissions: ['read', 'write'],
        role: RolesEnum.FACILITY_MANAGER,
        first_name: 'Team',
        last_name: 'Member',
        phone_number: '+2348012345678',
      };

      const mockTeam = {
        id: 'team-id',
        name: 'Test Team',
        creatorId: userId,
      };

      const transactionMock = jest.fn(async (callback) => {
        const manager = {
          getRepository: jest.fn((entity) => ({
            findOne: jest
              .fn()
              .mockResolvedValue(
                entity.name === 'Team'
                  ? mockTeam
                  : entity.name === 'Account'
                    ? { id: 'account-id', profile_name: 'Admin' }
                    : null,
              ),
            create: jest.fn((data) => ({ ...data, id: 'new-id' })),
            save: jest.fn((data) => Promise.resolve(data)),
          })),
        };
        return callback(manager);
      });

      mockDataSource.transaction = transactionMock;

      const result = await service.assignCollaboratorToTeam(userId, teamMember);

      expect(result).toBeDefined();
      expect(transactionMock).toHaveBeenCalled();
    });
  });

  describe('getTeamMembers', () => {
    it('should return team members successfully', async () => {
      const userId = 'landlord-id';
      const mockTeam = {
        id: 'team-id',
        creatorId: userId,
      };

      const mockMembers = [
        {
          id: 'member-1',
          email: 'member1@example.com',
          teamId: 'team-id',
        },
        {
          id: 'member-2',
          email: 'member2@example.com',
          teamId: 'team-id',
        },
      ];

      mockRepository.findOne.mockResolvedValue(mockTeam);
      mockRepository.find.mockResolvedValue(mockMembers);

      const result = await service.getTeamMembers(userId);

      expect(result).toEqual(mockMembers);
      expect(result).toHaveLength(2);
    });

    it('should throw error if team not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.getTeamMembers('invalid-id')).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('getWaitlist', () => {
    it('should return waitlist entries', async () => {
      const mockWaitlist = [
        {
          id: '1',
          full_name: 'John Doe',
          phone_number: '1234567890',
          option: 'tenant',
        },
        {
          id: '2',
          full_name: 'Jane Smith',
          phone_number: '0987654321',
          option: 'landlord',
        },
      ];

      mockRepository.find.mockResolvedValue(mockWaitlist);

      const result = await service.getWaitlist();

      expect(result).toEqual(mockWaitlist);
      expect(mockRepository.find).toHaveBeenCalled();
    });
  });

  describe('getLandlords', () => {
    it('should return all landlords', async () => {
      const mockLandlords = [
        {
          id: '1',
          first_name: 'John',
          last_name: 'Landlord',
          role: RolesEnum.LANDLORD,
        },
        {
          id: '2',
          first_name: 'Jane',
          last_name: 'Owner',
          role: RolesEnum.LANDLORD,
        },
      ];

      mockRepository.find.mockResolvedValue(mockLandlords);

      const result = await service.getLandlords();

      expect(result).toEqual(mockLandlords);
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { role: RolesEnum.LANDLORD },
      });
    });
  });

  describe('getTenantAndPropertyInfo', () => {
    it('should return tenant with property info', async () => {
      const tenantId = 'tenant-id';
      const mockTenant = {
        id: tenantId,
        role: RolesEnum.TENANT,
        user: {
          first_name: 'John',
          last_name: 'Tenant',
        },
        property_tenants: [
          {
            property: {
              id: 'property-id',
              name: 'Test Property',
            },
          },
        ],
      };

      mockRepository.findOne.mockResolvedValue(mockTenant);

      const result = await service.getTenantAndPropertyInfo(tenantId);

      expect(result).toEqual(mockTenant);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: tenantId,
          role: RolesEnum.TENANT,
        },
        relations: [
          'user',
          'property_tenants',
          'property_tenants.property.rents',
        ],
      });
    });

    it('should throw error if tenant not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getTenantAndPropertyInfo('invalid-id'),
      ).rejects.toThrow(HttpException);
    });
  });
});

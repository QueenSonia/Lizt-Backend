import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CreateAdminDto,
  CreateCustomerRepDto,
  CreateLandlordDto,
  CreateTenantDto,
  CreateTenantKycDto,
  CreateUserDto,
  IUser,
  LoginDto,
  UserFilter,
} from 'src/users/dto/create-user.dto';
import { UpdateUserDto } from 'src/users/dto/update-user.dto';
import { getRepositoryToken, InjectRepository } from '@nestjs/typeorm';
import { Users } from 'src/users/entities/user.entity';
import { DataSource, Not, QueryRunner, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AuthService } from 'src/auth/auth.service';
import { RolesEnum } from 'src/base.entity';
import { UtilService } from 'src/utils/utility-service';
import {
  clientForgotPasswordTemplate,
  clientSignUpEmailTemplate,
  clientSignUpWhatsappTemplate,
  EmailSubject,
} from 'src/utils/email-template';
import { buildUserFilter, buildUserFilterQB } from 'src/filters/query-filter';
import { Response } from 'express';
import moment from 'moment';
import { config } from 'src/config';
import {
  RentPaymentStatusEnum,
  RentStatusEnum,
} from 'src/rents/dto/create-rent.dto';
import { Rent } from 'src/rents/entities/rent.entity';
import { v4 as uuidv4 } from 'uuid';
import { PasswordResetToken } from 'src/users/entities/password-reset-token.entity';
import { Property } from 'src/properties/entities/property.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import {
  PropertyStatusEnum,
  TenantStatusEnum,
} from 'src/properties/dto/create-property.dto';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { DateService } from 'src/utils/date.helper';
import { FileUploadService } from 'src/utils/cloudinary';
import { KYC } from 'src/users/entities/kyc.entity';
import { CreateKycDto } from 'src/users/dto/create-kyc.dto';
import { UpdateKycDto } from 'src/users/dto/update-kyc.dto';
import bcrypt from 'bcryptjs/umd/types';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Account } from 'src/users/entities/account.entity';
import { AnyAaaaRecord } from 'node:dns';
import { ResetPasswordDto } from 'src/users/dto/reset-password.dto';
import { Team } from 'src/users/entities/team.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { WhatsappBotService } from 'src/whatsapp-bot/whatsapp-bot.service';
import { CacheService } from 'src/lib/cache';
import { Waitlist } from 'src/users/entities/waitlist.entity';
import { UsersService } from 'src/users/users.service';
import { Test, TestingModule } from '@nestjs/testing';

// Mock TypeORM Repository
const mockRepository = {
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  exists: jest.fn(),
  findAndCount: jest.fn(),
  createQueryBuilder: jest.fn(() => ({
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
    getManyAndCount: jest.fn(),
  })),
};

// Mock DataSource
const mockDataSource = {
  createQueryRunner: jest.fn(),
  transaction: jest.fn(),
};

// Mock QueryRunner
const mockQueryRunner = {
  connect: jest.fn(),
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(),
  release: jest.fn(),
  manager: {
    getRepository: jest.fn((entity) => mockRepository),
    findOne: jest.fn(), // Specific mock for manager.findOne
    save: jest.fn(), // Specific mock for manager.save
    exists: jest.fn(), // Specific mock for manager.exists
    update: jest.fn(), // Specific mock for manager.update
  },
};

// Mock other services
const mockConfigService = {
  get: jest.fn(),
};

const mockUtilService = {
  normalizePhoneNumber: jest.fn(),
  toSentenceCase: jest.fn(),
  generatePassword: jest.fn(),
  validatePassword: jest.fn(),
  hashPassword: jest.fn(),
  sendEmail: jest.fn(),
  generateOTP: jest.fn(),
};
const mockEventEmitter = {
  emit: jest.fn(),
};
const mockFileUploadService = {
  uploadFile: jest.fn(),
};
const mockWhatsappBotService = {
  sendTenantWelcomeTemplate: jest.fn(),
  sendUserAddedTemplate: jest.fn(),
  sendToFacilityManagerWithTemplate: jest.fn(),
  sendText: jest.fn(),
  sendToPropertiesCreatedTemplate: jest.fn(),
  sendToUserWithTemplate: jest.fn(),
};
const mockCacheService = {
  get: jest.fn(),
  set: jest.fn(),
};

describe('UsersService', () => {
  let service: UsersService;
  let usersRepository: Repository<Users>;
  let accountRepository: Repository<Account>;
  let propertyTenantRepository: Repository<PropertyTenant>;
  let rentRepository: Repository<Rent>;
  let passwordResetRepository: Repository<PasswordResetToken>;
  let kycRepository: Repository<KYC>;
  let teamRepository: Repository<Team>;
  let teamMemberRepository: Repository<TeamMember>;
  let waitlistRepository: Repository<Waitlist>;
  let propertyRepository: Repository<Property>;
  let propertyHistoryRepository: Repository<PropertyHistory>;
  let authService: AuthService;
  let whatsappBotService: WhatsappBotService;
  let fileUploadService: FileUploadService;
  let eventEmitter: EventEmitter2;
  let configService: ConfigService;
  let dataSource: DataSource;

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
          provide: getRepositoryToken(PropertyHistory),
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
        { provide: DataSource, useValue: mockDataSource },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: AuthService,
          useValue: {
            generateToken: jest.fn(),
          },
        },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: FileUploadService, useValue: mockFileUploadService },
        { provide: WhatsappBotService, useValue: mockWhatsappBotService },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    usersRepository = module.get<Repository<Users>>(getRepositoryToken(Users));
    accountRepository = module.get<Repository<Account>>(
      getRepositoryToken(Account),
    );
    propertyTenantRepository = module.get<Repository<PropertyTenant>>(
      getRepositoryToken(PropertyTenant),
    );
    rentRepository = module.get<Repository<Rent>>(getRepositoryToken(Rent));
    passwordResetRepository = module.get<Repository<PasswordResetToken>>(
      getRepositoryToken(PasswordResetToken),
    );
    kycRepository = module.get<Repository<KYC>>(getRepositoryToken(KYC));
    teamRepository = module.get<Repository<Team>>(getRepositoryToken(Team));
    teamMemberRepository = module.get<Repository<TeamMember>>(
      getRepositoryToken(TeamMember),
    );
    waitlistRepository = module.get<Repository<Waitlist>>(
      getRepositoryToken(Waitlist),
    );
    propertyRepository = module.get<Repository<Property>>(
      getRepositoryToken(Property),
    );
    propertyHistoryRepository = module.get<Repository<PropertyHistory>>(
      getRepositoryToken(PropertyHistory),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addTenant', () => {
    const landlordId = 'landlord-123';
    const mockDto: CreateTenantDto = {
      phone_number: '08012345678',
      full_name: 'John Doe',
      rent_amount: 100000,
      due_date: new Date('2024-12-31'),
      email: 'john.doe@example.com',
      property_id: 'prop-123',
    };

    const mockLandlordAccount = {
      id: landlordId,
      role: RolesEnum.LANDLORD,
      user: { phone_number: '08098765432' },
    };
    const mockTenantUser = {
      id: 'tenant-123',
      first_name: 'John',
      last_name: 'Doe',
      email: 'john.doe@example.com',
      phone_number: '2348012345678',
      role: RolesEnum.TENANT,
      is_verified: true,
    };
    const mockTenantAccount = {
      id: 'account-123',
      user: mockTenantUser,
      email: 'john.doe@example.com',
      is_verified: true,
      profile_name: 'John Doe',
      role: RolesEnum.TENANT,
      creator_id: landlordId,
    };
    const mockProperty = {
      id: 'prop-123',
      name: 'Sample Property',
      owner_id: landlordId,
      property_status: PropertyStatusEnum.VACANT,
    };

    it('should create tenant and related entities successfully', async () => {
      const mockNormalizedPhone = '2348012345678';
      const mockGeneratedPassword = 'genPass123';

      mockUtilService.normalizePhoneNumber.mockReturnValue(mockNormalizedPhone);
      mockUtilService.toSentenceCase.mockImplementation(
        (str) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase(),
      );
      mockUtilService.generatePassword.mockResolvedValue(mockGeneratedPassword);

      mockDataSource.createQueryRunner.mockReturnValue(mockQueryRunner);
      (mockQueryRunner.manager.getRepository as jest.Mock).mockImplementation(
        (entity) => {
          if (entity === Users) return mockRepository;
          if (entity === Account) return mockRepository;
          if (entity === Property) return mockRepository;
          if (entity === Rent) return mockRepository;
          if (entity === PropertyTenant) return mockRepository;
          return mockRepository; // fallback
        },
      );
      mockQueryRunner.manager.findOne
        .mockResolvedValueOnce(null) // User not found initially
        .mockResolvedValueOnce(mockLandlordAccount) // Landlord found
        .mockResolvedValueOnce(mockProperty) // Property found
        .mockResolvedValueOnce(null); // No active rent found
      mockQueryRunner.manager.save
        .mockResolvedValueOnce(mockTenantUser) // Save user
        .mockResolvedValueOnce(mockTenantAccount) // Save account
        .mockResolvedValueOnce(mockProperty) // Save property
        .mockResolvedValueOnce({ id: 'rent-123' }) // Save rent
        .mockResolvedValueOnce({ id: 'pt-123' }); // Save property tenant

      const result = await service.addTenant(landlordId, mockDto);

      expect(mockUtilService.normalizePhoneNumber).toHaveBeenCalledWith(
        mockDto.phone_number,
      );
      expect(mockQueryRunner.manager.findOne).toHaveBeenCalledWith(Users, {
        where: { phone_number: mockNormalizedPhone },
      });
      expect(mockQueryRunner.manager.findOne).toHaveBeenCalledWith(Account, {
        where: { id: landlordId, role: RolesEnum.LANDLORD },
        relations: ['user'],
      });
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(
        Users,
        expect.objectContaining({
          phone_number: mockNormalizedPhone,
          first_name: 'John',
          last_name: 'Doe',
          email: mockDto.email,
          role: RolesEnum.TENANT,
          is_verified: true,
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'user.added',
        expect.objectContaining({
          user_id: landlordId,
          property_id: mockDto.property_id,
          profile_name: 'John Doe',
          role: RolesEnum.TENANT,
        }),
      );
      expect(
        mockWhatsappBotService.sendTenantWelcomeTemplate,
      ).toHaveBeenCalledWith({
        phone_number: mockNormalizedPhone,
        tenant_name: 'John Doe',
        landlord_name: mockLandlordAccount.profile_name,
      });
      expect(result).toEqual(mockTenantUser);
    });

    it('should throw an error if landlord account is not found', async () => {
      (mockQueryRunner.manager.findOne as jest.Mock).mockResolvedValueOnce(
        null,
      ); // Landlord not found

      await expect(service.addTenant(landlordId, mockDto)).rejects.toThrow(
        HttpException,
      );
      await expect(service.addTenant(landlordId, mockDto)).rejects.toThrow(
        'admin account not found',
      );
    });

    it('should throw an error if tenant phone number already exists', async () => {
      const mockNormalizedPhone = '2348012345678';
      (mockUtilService.normalizePhoneNumber as jest.Mock).mockReturnValue(
        mockNormalizedPhone,
      );
      (mockQueryRunner.manager.findOne as jest.Mock)
        .mockResolvedValueOnce({ id: 'existing-user-id' }) // User found with phone
        .mockResolvedValueOnce(mockLandlordAccount); // Landlord found

      await expect(service.addTenant(landlordId, mockDto)).rejects.toThrow(
        HttpException,
      );
      await expect(service.addTenant(landlordId, mockDto)).rejects.toThrow(
        'already exists',
      );
    });

    it('should throw an error if property is already rented', async () => {
      const mockNormalizedPhone = '2348012345678';
      (mockUtilService.normalizePhoneNumber as jest.Mock).mockReturnValue(
        mockNormalizedPhone,
      );
      (mockQueryRunner.manager.findOne as jest.Mock)
        .mockResolvedValueOnce(null) // User not found
        .mockResolvedValueOnce(mockLandlordAccount) // Landlord found
        .mockResolvedValueOnce(mockProperty) // Property found
        .mockResolvedValueOnce({ id: 'active-rent-id' }); // Active rent found

      await expect(service.addTenant(landlordId, mockDto)).rejects.toThrow(
        HttpException,
      );
      await expect(service.addTenant(landlordId, mockDto)).rejects.toThrow(
        'Property is already rented out',
      );
    });

    it('should handle transaction rollback on error', async () => {
      const mockNormalizedPhone = '2348012345678';
      (mockUtilService.normalizePhoneNumber as jest.Mock).mockReturnValue(
        mockNormalizedPhone,
      );
      (mockQueryRunner.manager.findOne as jest.Mock)
        .mockResolvedValueOnce(null) // User not found
        .mockResolvedValueOnce(mockLandlordAccount) // Landlord found
        .mockResolvedValueOnce(mockProperty) // Property found
        .mockResolvedValueOnce(null); // No active rent found
      (mockQueryRunner.manager.save as jest.Mock).mockRejectedValueOnce(
        new Error('DB Error'),
      );

      await expect(service.addTenant(landlordId, mockDto)).rejects.toThrow(
        HttpException,
      );
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('createUser', () => {
    const creatorId = 'creator-123';
    const mockCreateUserDto: CreateUserDto = {
      email: 'newtenant@example.com',
      phone_number: '08011111111',
      first_name: 'Jane',
      last_name: 'Doe',
      role: RolesEnum.TENANT,
      property_id: 'prop-456',
      lease_start_date: new Date('2024-01-01'),
      lease_end_date: new Date('2024-12-31'),
      rental_price: 120000,
      security_deposit: 100000,
      service_charge: 20000,

      // Required fields from DTO
      date_of_birth: '1995-05-20',
      gender: Gender.FEMALE,
      state_of_origin: 'Lagos',
      lga: 'Ikeja',
      nationality: 'Nigerian',
      employment_status: EmploymentStatus.UNEMPLOYED,
      marital_status: MaritalStatus.SINGLE,
    };

    const mockNewUser = {
      id: 'user-456',
      email: 'newtenant@example.com',
      phone_number: '2348011111111',
      first_name: 'Jane',
      last_name: 'Doe',
      role: RolesEnum.TENANT,
      creator_id: creatorId,
    };
    const mockNewAccount = {
      id: 'account-456',
      user: mockNewUser,
      email: 'newtenant@example.com',
      role: RolesEnum.TENANT,
      profile_name: 'Jane Doe',
      is_verified: false,
      creator_id: creatorId,
    };
    const mockProperty = {
      id: 'prop-456',
      name: 'Another Property',
      owner_id: 'owner-789',
    };
    const mockToken = 'mock-token-123';

    beforeEach(() => {
      (mockUtilService.normalizePhoneNumber as jest.Mock).mockImplementation(
        (str) => `234${str.slice(1)}`,
      );
      (mockUtilService.toSentenceCase as jest.Mock).mockImplementation(
        (str) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase(),
      );
      (mockConfigService.get as jest.Mock).mockReturnValue(
        'https://frontend.example.com',
      );
      (mockUtilService.sendEmail as jest.Mock).mockResolvedValue(undefined);
    });

    it('should successfully create a new user account and related entities', async () => {
      const mockNormalizedPhone = '2348011111111';
      (mockDataSource.createQueryRunner as jest.Mock).mockReturnValue(
        mockQueryRunner,
      );
      (mockQueryRunner.manager.findOne as jest.Mock)
        .mockResolvedValueOnce(null) // User not found initially
        .mockResolvedValueOnce(null) // Account not found
        .mockResolvedValueOnce(mockProperty); // Property found
      (mockQueryRunner.manager.exists as jest.Mock).mockResolvedValue(false); // No active rent
      (mockQueryRunner.manager.getRepository as jest.Mock).mockImplementation(
        (entity) => {
          if (entity === Users) return mockRepository;
          if (entity === Account) return mockRepository;
          if (entity === Rent) return mockRepository;
          if (entity === PropertyTenant) return mockRepository;
          if (entity === PropertyHistory) return mockRepository;
          if (entity === Property) return mockRepository;
          return mockRepository; // fallback
        },
      );
      (mockQueryRunner.manager.save as jest.Mock)
        .mockResolvedValueOnce(mockNewUser) // Save user
        .mockResolvedValueOnce(mockNewAccount) // Save account
        .mockResolvedValueOnce({ id: 'rent-456' }) // Save rent
        .mockResolvedValueOnce({ id: 'pt-456' }) // Save property tenant
        .mockResolvedValueOnce({ id: 'ph-456' }); // Save property history
      (mockQueryRunner.manager.update as jest.Mock).mockResolvedValue({
        affected: 1,
      }); // Update property status

      const result = await service.createUser(mockCreateUserDto, creatorId);

      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.manager.findOne).toHaveBeenCalledWith(Users, {
        where: { email: mockCreateUserDto.email },
      });
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(
        Users,
        expect.objectContaining({
          email: mockCreateUserDto.email,
          phone_number: mockNormalizedPhone,
          first_name: mockCreateUserDto.first_name,
          creator_id: creatorId,
        }),
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'user.added',
        expect.objectContaining({
          user_id: mockProperty.owner_id,
          property_id: mockCreateUserDto.property_id,
          property_name: mockProperty.name,
          role: RolesEnum.TENANT,
        }),
      );
      expect(result.id).toEqual(mockNewAccount.id);
      expect(result.password_link).toContain(mockToken);
    });

    it('should throw an error if user with email already exists', async () => {
      (mockQueryRunner.manager.findOne as jest.Mock).mockResolvedValueOnce(
        mockNewUser,
      ); // User found

      await expect(
        service.createUser(mockCreateUserDto, creatorId),
      ).rejects.toThrow(HttpException);
      await expect(
        service.createUser(mockCreateUserDto, creatorId),
      ).rejects.toThrow('already exists');
    });

    it('should throw an error if account with email and role already exists', async () => {
      (mockQueryRunner.manager.findOne as jest.Mock)
        .mockResolvedValueOnce(null) // User not found
        .mockResolvedValueOnce({ id: 'existing-account-id' }); // Account found

      await expect(
        service.createUser(mockCreateUserDto, creatorId),
      ).rejects.toThrow(HttpException);
      await expect(
        service.createUser(mockCreateUserDto, creatorId),
      ).rejects.toThrow('already exists');
    });

    it('should throw an error if property is not found', async () => {
      (mockQueryRunner.manager.findOne as jest.Mock)
        .mockResolvedValueOnce(null) // User not found
        .mockResolvedValueOnce(null) // Account not found
        .mockResolvedValueOnce(null); // Property not found

      await expect(
        service.createUser(mockCreateUserDto, creatorId),
      ).rejects.toThrow(HttpException);
      await expect(
        service.createUser(mockCreateUserDto, creatorId),
      ).rejects.toThrow('not found');
    });

    it('should throw an error if property is already rented', async () => {
      (mockQueryRunner.manager.findOne as jest.Mock)
        .mockResolvedValueOnce(null) // User not found
        .mockResolvedValueOnce(null) // Account not found
        .mockResolvedValueOnce(mockProperty); // Property found
      (mockQueryRunner.manager.exists as jest.Mock).mockResolvedValue(true); // Active rent exists

      await expect(
        service.createUser(mockCreateUserDto, creatorId),
      ).rejects.toThrow(HttpException);
      await expect(
        service.createUser(mockCreateUserDto, creatorId),
      ).rejects.toThrow('already rented out');
    });

    it('should rollback transaction and throw error on DB failure', async () => {
      (mockQueryRunner.manager.findOne as jest.Mock)
        .mockResolvedValueOnce(null) // User not found
        .mockResolvedValueOnce(null) // Account not found
        .mockResolvedValueOnce(mockProperty); // Property found
      (mockQueryRunner.manager.exists as jest.Mock).mockResolvedValue(false); // No active rent
      (mockQueryRunner.manager.save as jest.Mock).mockRejectedValue(
        new Error('DB Error'),
      );

      await expect(
        service.createUser(mockCreateUserDto, creatorId),
      ).rejects.toThrow(HttpException);
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('loginUser', () => {
    const mockLoginDto: LoginDto = {
      email: 'test@example.com',
      password: 'password123',
    };
    const mockAccount = {
      id: 'account-123',
      email: 'test@example.com',
      password: 'hashedPassword',
      role: RolesEnum.TENANT,
      is_verified: true,
      user: {
        id: 'user-123',
        first_name: 'Test',
        last_name: 'User',
        phone_number: '2348012345678',
      },
    };
    const mockToken = 'jwt-token-123';

    beforeEach(() => {
      (mockUtilService.validatePassword as jest.Mock).mockResolvedValue(true);
      (mockAuthService.generateToken as jest.Mock).mockResolvedValue(mockToken);
    });

    it('should successfully log in a tenant user', async () => {
      const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      (accountRepository.findOne as jest.Mock).mockResolvedValueOnce(
        mockAccount,
      );

      await service.loginUser(mockLoginDto, mockRes);

      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { email: mockLoginDto.email, role: RolesEnum.TENANT },
        relations: ['user'],
      });
      expect(mockUtilService.validatePassword).toHaveBeenCalledWith(
        mockLoginDto.password,
        mockAccount.password,
      );
      expect(mockAuthService.generateToken).toHaveBeenCalledWith({
        id: mockAccount.id,
        first_name: mockAccount.user.first_name,
        last_name: mockAccount.user.last_name,
        email: mockAccount.email,
        phone_number: mockAccount.user.phone_number,
        role: mockAccount.role,
      });
      expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockRes.json).toHaveBeenCalledWith({
        user: expect.objectContaining({
          id: mockAccount.id,
          email: mockAccount.email,
        }),
        access_token: mockToken,
        sub_access_token: null,
        parent_access_token: null,
      });
    });

    it('should throw an error if no account is found', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.loginUser(mockLoginDto, {} as any)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.loginUser(mockLoginDto, {} as any)).rejects.toThrow(
        'not found',
      );
    });

    it('should throw an error if account is not verified', async () => {
      const unverifiedAccount = { ...mockAccount, is_verified: false };
      (accountRepository.findOne as jest.Mock).mockResolvedValue(
        unverifiedAccount,
      );

      await expect(service.loginUser(mockLoginDto, {} as any)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.loginUser(mockLoginDto, {} as any)).rejects.toThrow(
        'not verified',
      );
    });

    it('should throw an error if password is invalid', async () => {
      (mockUtilService.validatePassword as jest.Mock).mockResolvedValue(false);
      (accountRepository.findOne as jest.Mock).mockResolvedValue(mockAccount);

      await expect(service.loginUser(mockLoginDto, {} as any)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.loginUser(mockLoginDto, {} as any)).rejects.toThrow(
        'Invalid password',
      );
    });

    it('should generate parent_access_token for tenant logging into landlord account', async () => {
      const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const mockLandlordAccount = { ...mockAccount, role: RolesEnum.LANDLORD };
      const mockTenantAccount = {
        ...mockAccount,
        id: 'tenant-account-123',
        role: RolesEnum.TENANT,
        email: mockAccount.email,
      };
      (accountRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(null) // Admin
        .mockResolvedValueOnce(mockLandlordAccount) // Landlord
        .mockResolvedValueOnce(mockTenantAccount) // Tenant
        .mockResolvedValueOnce(null); // Rep

      await service.loginUser(mockLoginDto, mockRes);

      expect(mockAuthService.generateToken).toHaveBeenCalledWith({
        id: mockTenantAccount.id,
        first_name: mockTenantAccount.user.first_name,
        last_name: mockTenantAccount.user.last_name,
        email: mockTenantAccount.email,
        phone_number: mockTenantAccount.user.phone_number,
        property_id: expect.any(String), // Assuming property_tenants relation has property_id
        role: mockTenantAccount.role,
      });
    });

    it('should generate sub_access_token for landlord logging into tenant account', async () => {
      const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const mockLandlordAccount = { ...mockAccount, role: RolesEnum.LANDLORD };
      const mockTenantAccount = {
        ...mockAccount,
        id: 'tenant-account-123',
        role: RolesEnum.TENANT,
        email: mockAccount.email,
      };
      (accountRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(null) // Admin
        .mockResolvedValueOnce(mockLandlordAccount) // Landlord
        .mockResolvedValueOnce(null) // Tenant
        .mockResolvedValueOnce(null); // Rep
      // Simulate landlord finding tenant sub-account
      (accountRepository.findOne as jest.Mock).mockResolvedValueOnce(
        mockTenantAccount,
      );

      await service.loginUser(mockLoginDto, mockRes);

      expect(mockAuthService.generateToken).toHaveBeenCalledWith({
        id: mockTenantAccount.id,
        first_name: mockTenantAccount.user.first_name,
        last_name: mockTenantAccount.user.last_name,
        email: mockTenantAccount.email,
        phone_number: mockTenantAccount.user.phone_number,
        property_id: expect.any(String), // Assuming property_tenants relation has property_id
        role: mockTenantAccount.role,
      });
    });
  });

  describe('forgotPassword', () => {
    const email = 'test@example.com';
    const mockAccount = { id: 'user-123', email };
    const mockOtp = '123456';
    const mockToken = 'reset-token-123';

    beforeEach(() => {
      (mockUtilService.generateOTP as jest.Mock).mockReturnValue(mockOtp);
    });

    it('should send OTP if user exists', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue(mockAccount);
      (passwordResetRepository.save as jest.Mock).mockResolvedValue({
        id: 'token-123',
        user_id: mockAccount.id,
        token: mockToken,
        otp: mockOtp,
      });
      (mockUtilService.sendEmail as jest.Mock).mockResolvedValue(undefined);

      const result = await service.forgotPassword(email);

      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { email },
      });
      expect(passwordResetRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: mockAccount.id,
          otp: mockOtp,
        }),
      );
      expect(mockUtilService.sendEmail).toHaveBeenCalledWith(
        email,
        expect.any(String), // EmailSubject
        expect.any(String), // emailContent
      );
      expect(result).toEqual({
        message: 'OTP sent to email',
        token: mockToken,
      });
    });

    it('should throw an error if user does not exist', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.forgotPassword(email)).rejects.toThrow(
        HttpException,
      );
      await expect(service.forgotPassword(email)).rejects.toThrow(
        'User not found',
      );
    });
  });

  describe('resetPassword', () => {
    const mockResetDto: ResetPasswordDto = {
      token: 'valid-token-123',
      newPassword: 'newSecurePassword',
    };
    const mockTokenEntry = {
      id: 'token-123',
      user_id: 'user-123',
      token: 'valid-token-123',
      expires_at: new Date(Date.now() + 10000),
    };
    const mockAccount = {
      id: 'user-123',
      password: 'oldHashedPassword',
      is_verified: false,
      profile_name: 'Test User',
      property_tenants: [{ property_id: 'prop-123' }],
    };

    beforeEach(() => {
      (mockUtilService.hashPassword as jest.Mock).mockResolvedValue(
        'newHashedPassword',
      );
    });

    it('should successfully reset password and verify user if not verified', async () => {
      const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      (passwordResetRepository.findOne as jest.Mock).mockResolvedValue(
        mockTokenEntry,
      );
      (accountRepository.findOne as jest.Mock).mockResolvedValue(mockAccount);

      const result = await service.resetPassword(mockResetDto, mockRes);

      expect(passwordResetRepository.findOne).toHaveBeenCalledWith({
        where: { token: mockResetDto.token },
      });
      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockTokenEntry.user_id },
        relations: ['property_tenants'],
      });
      expect(mockUtilService.hashPassword).toHaveBeenCalledWith(
        mockResetDto.newPassword,
      );
      expect(accountRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          password: 'newHashedPassword',
          is_verified: true,
        }),
      );
      expect(passwordResetRepository.delete).toHaveBeenCalledWith({
        id: mockTokenEntry.id,
      });
      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Password reset successful',
        user_id: mockAccount.id,
      });
    });

    it('should throw an error if token is invalid', async () => {
      (passwordResetRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.resetPassword(mockResetDto, {} as any),
      ).rejects.toThrow(HttpException);
      await expect(
        service.resetPassword(mockResetDto, {} as any),
      ).rejects.toThrow('Invalid token');
    });

    it('should throw an error if token is expired', async () => {
      const expiredTokenEntry = {
        ...mockTokenEntry,
        expires_at: new Date(Date.now() - 1000),
      };
      (passwordResetRepository.findOne as jest.Mock).mockResolvedValue(
        expiredTokenEntry,
      );

      await expect(
        service.resetPassword(mockResetDto, {} as any),
      ).rejects.toThrow(HttpException);
      await expect(
        service.resetPassword(mockResetDto, {} as any),
      ).rejects.toThrow('Token has expired');
    });

    it('should throw an error if user is not found', async () => {
      (passwordResetRepository.findOne as jest.Mock).mockResolvedValue(
        mockTokenEntry,
      );
      (accountRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.resetPassword(mockResetDto, {} as any),
      ).rejects.toThrow(HttpException);
      await expect(
        service.resetPassword(mockResetDto, {} as any),
      ).rejects.toThrow('User not found');
    });
  });

  describe('createLandlord', () => {
    const mockCreateLandlordDto: CreateLandlordDto = {
      email: 'landlord@example.com',
      phone_number: '08022222222',
      first_name: 'Land',
      last_name: 'Lord',
      agency_name: 'Lord Agency',
      password: 'securePassword',
    };
    const mockNewUser = {
      id: 'user-789',
      email: 'landlord@example.com',
      phone_number: '2348022222222',
      first_name: 'Land',
      last_name: 'Lord',
      role: RolesEnum.LANDLORD,
      is_verified: true,
    };
    const mockNewAccount = {
      id: 'account-789',
      user: mockNewUser,
      email: 'landlord@example.com',
      role: RolesEnum.LANDLORD,
      profile_name: 'Lord Agency',
      is_verified: true,
    };

    beforeEach(() => {
      (mockUtilService.hashPassword as jest.Mock).mockResolvedValue(
        'hashedSecurePassword',
      );
    });

    it('should successfully create a new landlord account', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue(null); // No existing account
      (usersRepository.findOne as jest.Mock).mockResolvedValue(null); // User doesn't exist
      (usersRepository.save as jest.Mock).mockResolvedValue(mockNewUser);
      (accountRepository.save as jest.Mock).mockResolvedValue(mockNewAccount);

      const result = await service.createLandlord(mockCreateLandlordDto);

      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { email: mockCreateLandlordDto.email, role: RolesEnum.LANDLORD },
      });
      expect(usersRepository.findOne).toHaveBeenCalledWith({
        where: { phone_number: mockCreateLandlordDto.phone_number },
      });
      expect(usersRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          phone_number: '2348022222222',
          first_name: mockCreateLandlordDto.first_name,
          last_name: mockCreateLandlordDto.last_name,
          role: RolesEnum.LANDLORD,
        }),
      );
      expect(accountRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: mockCreateLandlordDto.email,
          password: 'hashedSecurePassword',
          role: RolesEnum.LANDLORD,
          profile_name: mockCreateLandlordDto.agency_name,
        }),
      );
      expect(result).toEqual({ ...mockNewUser, password: undefined }); // Password should be omitted
    });

    it('should throw an error if landlord account with email already exists', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue(
        mockNewAccount,
      );

      await expect(
        service.createLandlord(mockCreateLandlordDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createLandlord(mockCreateLandlordDto),
      ).rejects.toThrow('already exists');
    });

    it('should throw an error if password is not provided', async () => {
      const dtoWithoutPassword = {
        ...mockCreateLandlordDto,
        password: undefined,
      };

      await expect(service.createLandlord(dtoWithoutPassword)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createLandlord(dtoWithoutPassword)).rejects.toThrow(
        'Password is required',
      );
    });
  });

  // Add more tests for other methods like createUserKyc, getSubAccounts, etc.
  // Example for createUserKyc:
  describe('createUserKyc', () => {
    const userId = 'user-123';
    const mockCreateKycDto: CreateKycDto = {
      // Add fields as per your CreateKycDto
      id: 'kyc-123',
      user_id: userId,
      // ... other fields
    };
    const mockUserAccount = { id: userId, kyc: null, is_verified: false };
    const mockNewKyc = { ...mockCreateKycDto, user: mockUserAccount };

    it('should successfully create KYC and verify user', async () => {
      (mockDataSource.createQueryRunner as jest.Mock).mockReturnValue(
        mockQueryRunner,
      );
      (mockQueryRunner.manager.findOne as jest.Mock).mockResolvedValue(
        mockUserAccount,
      );
      (mockQueryRunner.manager.save as jest.Mock)
        .mockResolvedValueOnce(mockNewKyc) // Save KYC
        .mockResolvedValueOnce({ ...mockUserAccount, is_verified: true }); // Save Account

      const result = await service.createUserKyc(userId, mockCreateKycDto);

      expect(mockQueryRunner.manager.findOne).toHaveBeenCalledWith(Account, {
        where: { id: userId },
        relations: ['kyc'],
      });
      expect(kycRepository.create).toHaveBeenCalledWith({
        ...mockCreateKycDto,
        user: mockUserAccount,
      });
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(
        Account,
        expect.objectContaining({
          id: userId,
          is_verified: true,
        }),
      );
      expect(result).toEqual(mockNewKyc);
    });

    it('should throw an error if user is not found', async () => {
      (mockQueryRunner.manager.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createUserKyc(userId, mockCreateKycDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw an error if KYC already exists', async () => {
      const userWithKyc = { ...mockUserAccount, kyc: { id: 'existing-kyc' } };
      (mockQueryRunner.manager.findOne as jest.Mock).mockResolvedValue(
        userWithKyc,
      );

      await expect(
        service.createUserKyc(userId, mockCreateKycDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createUserKyc(userId, mockCreateKycDto),
      ).rejects.toThrow('KYC already submitted');
    });
  });

  describe('getSubAccounts', () => {
    const adminId = 'admin-123';
    const mockSubAccounts = [
      {
        id: 'sub-1',
        user: { id: 'u1', first_name: 'Sub1' },
        creator_id: adminId,
      },
      {
        id: 'sub-2',
        user: { id: 'u2', first_name: 'Sub2' },
        creator_id: adminId,
      },
    ];

    it('should return sub-accounts for an admin', async () => {
      (accountRepository.find as jest.Mock).mockResolvedValue(mockSubAccounts);

      const result = await service.getSubAccounts(adminId);

      expect(accountRepository.find).toHaveBeenCalledWith({
        where: { creator_id: adminId },
        relations: ['user'],
      });
      expect(result).toEqual(mockSubAccounts);
    });
  });

  describe('assignCollaboratorToTeam', () => {
    const landlordId = 'landlord-123';
    const mockTeamMember = {
      email: 'collab@example.com',
      permissions: ['read', 'write'],
      role: RolesEnum.REP,
      first_name: 'Col',
      last_name: 'Lab',
      phone_number: '08033333333',
    };
    const mockLandlordAccount = {
      id: landlordId,
      profile_name: 'Land Lord',
      role: RolesEnum.LANDLORD,
    };
    const mockTeam = {
      id: 'team-123',
      creatorId: landlordId,
      name: 'Land Lord Team',
    };
    const mockNewUser = {
      id: 'user-456',
      email: 'collab@example.com',
      role: RolesEnum.REP,
    };
    const mockNewAccount = {
      id: 'account-456',
      email: 'collab@example.com',
      role: RolesEnum.REP,
      profile_name: 'Col Lab',
    };
    const mockNewTeamMember = {
      id: 'tm-123',
      accountId: 'account-456',
      teamId: 'team-123',
    };

    beforeEach(() => {
      (mockUtilService.generatePassword as jest.Mock).mockResolvedValue(
        'genPass456',
      );
      (mockDataSource.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          return await callback(mockQueryRunner.manager);
        },
      );
      (mockQueryRunner.manager.getRepository as jest.Mock).mockImplementation(
        (entity) => {
          if (entity === Team) return mockRepository;
          if (entity === Account) return mockRepository;
          if (entity === Users) return mockRepository;
          if (entity === TeamMember) return mockRepository;
          return mockRepository; // fallback
        },
      );
    });

    it('should successfully assign a collaborator to a team', async () => {
      (mockQueryRunner.manager.findOne as jest.Mock)
        .mockResolvedValueOnce(null) // Team not found initially
        .mockResolvedValueOnce(mockLandlordAccount) // Landlord found
        .mockResolvedValueOnce(null) // User not found
        .mockResolvedValueOnce(null); // Team member not found
      (mockQueryRunner.manager.save as jest.Mock)
        .mockResolvedValueOnce(mockTeam) // Save new team
        .mockResolvedValueOnce(mockNewUser) // Save new user
        .mockResolvedValueOnce(mockNewAccount) // Save new account
        .mockResolvedValueOnce(mockNewTeamMember); // Save team member

      const result = await service.assignCollaboratorToTeam(
        landlordId,
        mockTeamMember,
      );

      expect(mockQueryRunner.manager.findOne).toHaveBeenCalledWith(Team, {
        where: { creatorId: landlordId },
      });
      expect(mockQueryRunner.manager.findOne).toHaveBeenCalledWith(Account, {
        where: { id: landlordId, role: RolesEnum.LANDLORD },
      });
      expect(mockQueryRunner.manager.findOne).toHaveBeenCalledWith(Users, {
        where: { email: mockTeamMember.email },
      });
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(
        Team,
        expect.objectContaining({ creatorId: landlordId }),
      );
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(
        Account,
        expect.objectContaining({
          email: mockTeamMember.email,
          role: mockTeamMember.role,
          profile_name: 'Col Lab',
        }),
      );
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(
        TeamMember,
        expect.objectContaining({
          email: mockTeamMember.email,
          teamId: mockTeam.id,
          accountId: mockNewAccount.id,
        }),
      );
      expect(
        mockWhatsappBotService.sendToFacilityManagerWithTemplate,
      ).toHaveBeenCalledWith({
        phone_number: '2348033333333',
        name: 'Col',
        team: mockTeam.name,
        role: 'Facility Manager',
      });
      expect(result).toEqual(mockNewTeamMember);
    });

    it('should throw an error if landlord account is not found', async () => {
      (mockQueryRunner.manager.findOne as jest.Mock)
        .mockResolvedValueOnce(null) // Team not found initially
        .mockResolvedValueOnce(null); // Landlord not found

      await expect(
        service.assignCollaboratorToTeam(landlordId, mockTeamMember),
      ).rejects.toThrow(HttpException);
      await expect(
        service.assignCollaboratorToTeam(landlordId, mockTeamMember),
      ).rejects.toThrow('Team admin account not found');
    });

    it('should throw an error if collaborator is already in the team', async () => {
      (mockQueryRunner.manager.findOne as jest.Mock)
        .mockResolvedValueOnce(mockTeam) // Team found
        .mockResolvedValueOnce(null) // User not found
        .mockResolvedValueOnce({ id: 'existing-tm-id' }); // Team member found

      await expect(
        service.assignCollaboratorToTeam(landlordId, mockTeamMember),
      ).rejects.toThrow(HttpException);
      await expect(
        service.assignCollaboratorToTeam(landlordId, mockTeamMember),
      ).rejects.toThrow('Collaborator already in team');
    });
  });

  describe('addTenantKyc', () => {
    const landlordId = 'landlord-123';
    const mockDto: CreateTenantKycDto = {
      phone_number: '08012345678',
      first_name: 'John',
      last_name: 'Doe',
      email: 'john.doe@example.com',
      property_id: 'prop-123',
      rent_amount: 100000,
      tenancy_start_date: '2024-01-01',
      tenancy_end_date: '2024-12-31',
      // ... other KYC fields
      date_of_birth: '1990-01-01',
      gender: 'male',
      state_of_origin: 'Lagos',
      lga: 'Ikeja',
      nationality: 'Nigerian',
      employment_status: 'Employed',
      marital_status: 'Single',
      employer_name: 'Acme Corp',
      job_title: 'Engineer',
      employer_address: '123 Work St',
      monthly_income: 50000,
      work_email: 'j.doe@acme.com',
      // ... more fields as needed
    };
    const mockLandlordAccount = {
      id: landlordId,
      role: RolesEnum.LANDLORD,
      user: { phone_number: '08098765432', first_name: 'Landlord' },
      profile_name: 'Landlord Agency',
    };
    const mockTenantUser = {
      id: 'tenant-123',
      first_name: 'John',
      last_name: 'Doe',
      email: 'john.doe@example.com',
      phone_number: '2348012345678',
      role: RolesEnum.TENANT,
      is_verified: true,
    };
    const mockTenantAccount = {
      id: 'account-123',
      user: mockTenantUser,
      email: 'john.doe@example.com',
      is_verified: true,
      profile_name: 'John Doe',
      role: RolesEnum.TENANT,
      creator_id: landlordId,
    };
    const mockProperty = {
      id: 'prop-123',
      name: 'Sample Property',
      owner_id: landlordId,
      property_status: PropertyStatusEnum.VACANT,
    };

    it('should successfully add a tenant with KYC details', async () => {
      const mockNormalizedPhone = '2348012345678';
      const mockGeneratedPassword = 'genPass123';

      (mockUtilService.normalizePhoneNumber as jest.Mock).mockReturnValue(
        mockNormalizedPhone,
      );
      (mockUtilService.toSentenceCase as jest.Mock).mockImplementation(
        (str) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase(),
      );
      (mockUtilService.generatePassword as jest.Mock).mockResolvedValue(
        mockGeneratedPassword,
      );

      (mockDataSource.createQueryRunner as jest.Mock).mockReturnValue(
        mockQueryRunner,
      );
      (mockQueryRunner.manager.getRepository as jest.Mock).mockImplementation(
        (entity) => {
          if (entity === Users) return mockRepository;
          if (entity === Account) return mockRepository;
          if (entity === Property) return mockRepository;
          if (entity === Rent) return mockRepository;
          if (entity === PropertyTenant) return mockRepository;
          return mockRepository; // fallback
        },
      );
      (mockQueryRunner.manager.findOne as jest.Mock)
        .mockResolvedValueOnce(null) // User not found initially
        .mockResolvedValueOnce(mockLandlordAccount) // Landlord found
        .mockResolvedValueOnce(mockProperty) // Property found
        .mockResolvedValueOnce(null); // No active rent found
      (mockQueryRunner.manager.save as jest.Mock)
        .mockResolvedValueOnce(mockTenantUser) // Save user
        .mockResolvedValueOnce(mockTenantAccount) // Save account
        .mockResolvedValueOnce(mockProperty) // Save property
        .mockResolvedValueOnce({ id: 'rent-123' }) // Save rent
        .mockResolvedValueOnce({ id: 'pt-123' }); // Save property tenant

      const result = await service.addTenantKyc(landlordId, mockDto);

      expect(mockUtilService.normalizePhoneNumber).toHaveBeenCalledWith(
        mockDto.phone_number,
      );
      expect(mockQueryRunner.manager.findOne).toHaveBeenCalledWith(Users, {
        where: { phone_number: mockNormalizedPhone },
      });
      expect(mockQueryRunner.manager.findOne).toHaveBeenCalledWith(Account, {
        where: { id: landlordId, role: RolesEnum.LANDLORD },
        relations: ['user'],
      });
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(
        Users,
        expect.objectContaining({
          phone_number: mockNormalizedPhone,
          first_name: 'John',
          last_name: 'Doe',
          email: mockDto.email,
          role: RolesEnum.TENANT,
          is_verified: true,
          employer_name: mockDto.employer_name,
          job_title: mockDto.job_title,
          // ... check other KYC fields
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'user.added',
        expect.objectContaining({
          user_id: landlordId,
          property_id: mockDto.property_id,
          profile_name: 'John Doe',
          role: RolesEnum.TENANT,
        }),
      );
      expect(
        mockWhatsappBotService.sendToUserWithTemplate,
      ).toHaveBeenCalledWith(mockNormalizedPhone, 'John Doe');
      expect(result).toEqual(mockTenantUser);
    });

    it('should throw an error if landlord account is not found', async () => {
      (mockQueryRunner.manager.findOne as jest.Mock).mockResolvedValueOnce(
        null,
      ); // Landlord not found

      await expect(service.addTenantKyc(landlordId, mockDto)).rejects.toThrow(
        HttpException,
      );
      await expect(service.addTenantKyc(landlordId, mockDto)).rejects.toThrow(
        'admin account not found',
      );
    });

    it('should throw an error if tenant phone number already exists', async () => {
      const mockNormalizedPhone = '2348012345678';
      (mockUtilService.normalizePhoneNumber as jest.Mock).mockReturnValue(
        mockNormalizedPhone,
      );
      (mockQueryRunner.manager.findOne as jest.Mock)
        .mockResolvedValueOnce({ id: 'existing-user-id' }) // User found with phone
        .mockResolvedValueOnce(mockLandlordAccount); // Landlord found

      await expect(service.addTenantKyc(landlordId, mockDto)).rejects.toThrow(
        HttpException,
      );
      await expect(service.addTenantKyc(landlordId, mockDto)).rejects.toThrow(
        'already exists',
      );
    });

    it('should throw an error if property is already rented', async () => {
      const mockNormalizedPhone = '2348012345678';
      (mockUtilService.normalizePhoneNumber as jest.Mock).mockReturnValue(
        mockNormalizedPhone,
      );
      (mockQueryRunner.manager.findOne as jest.Mock)
        .mockResolvedValueOnce(null) // User not found
        .mockResolvedValueOnce(mockLandlordAccount) // Landlord found
        .mockResolvedValueOnce(mockProperty) // Property found
        .mockResolvedValueOnce({ id: 'active-rent-id' }); // Active rent found

      await expect(service.addTenantKyc(landlordId, mockDto)).rejects.toThrow(
        HttpException,
      );
      await expect(service.addTenantKyc(landlordId, mockDto)).rejects.toThrow(
        'Property is already rented out',
      );
    });

    it('should handle transaction rollback on error', async () => {
      const mockNormalizedPhone = '2348012345678';
      (mockUtilService.normalizePhoneNumber as jest.Mock).mockReturnValue(
        mockNormalizedPhone,
      );
      (mockQueryRunner.manager.findOne as jest.Mock)
        .mockResolvedValueOnce(null) // User not found
        .mockResolvedValueOnce(mockLandlordAccount) // Landlord found
        .mockResolvedValueOnce(mockProperty) // Property found
        .mockResolvedValueOnce(null); // No active rent found
      (mockQueryRunner.manager.save as jest.Mock).mockRejectedValueOnce(
        new Error('DB Error'),
      );

      await expect(service.addTenantKyc(landlordId, mockDto)).rejects.toThrow(
        HttpException,
      );
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('generatePasswordResetToken', () => {
    const userId = 'user-123';
    const mockToken = 'mock-uuid-token-123';
    const mockTokenEntity = {
      id: 'token-123',
      user_id: userId,
      token: mockToken,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
    };

    it('should generate and save a password reset token', async () => {
      (mockQueryRunner.manager.create as jest.Mock).mockReturnValue(
        mockTokenEntity,
      );
      (mockQueryRunner.manager.save as jest.Mock).mockResolvedValue(
        mockTokenEntity,
      );

      const result = await service.generatePasswordResetToken(
        userId,
        mockQueryRunner,
      );

      expect(mockQueryRunner.manager.create).toHaveBeenCalledWith(
        PasswordResetToken,
        expect.objectContaining({
          user_id: userId,
          token: mockToken,
        }),
      );
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(
        PasswordResetToken,
        mockTokenEntity,
      );
      expect(result).toBe(mockToken);
    });
  });

  describe('getAllUsers', () => {
    const mockQueryParams: UserFilter = { page: '1', size: '10' };
    const mockUsers = [{ id: 'user-1', first_name: 'John' }];
    const mockCount = 1;

    it('should return paginated users', async () => {
      (usersRepository.findAndCount as jest.Mock).mockResolvedValue([
        mockUsers,
        mockCount,
      ]);

      const result = await service.getAllUsers(mockQueryParams);

      expect(usersRepository.findAndCount).toHaveBeenCalledWith({
        where: expect.any(Object), // The result of buildUserFilter
        skip: 0,
        take: 10,
        order: { created_at: 'DESC' },
        relations: ['property_tenants', 'property_tenants.property'],
      });
      expect(result).toEqual({
        users: mockUsers,
        pagination: {
          totalRows: mockCount,
          perPage: 10,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      });
    });
  });

  describe('getAllTenants', () => {
    const mockQueryParams: UserFilter = {
      page: '1',
      size: '10',
      role: RolesEnum.TENANT,
    };
    const mockUsers = [
      { id: 'user-1', first_name: 'John', role: RolesEnum.TENANT },
    ];
    const mockCount = 1;

    it('should return paginated tenants', async () => {
      (usersRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockUsers, mockCount]),
        orderBy: jest.fn().mockReturnThis(),
      });

      const result = await service.getAllTenants(mockQueryParams);

      expect(usersRepository.createQueryBuilder).toHaveBeenCalledWith('user');
      expect(result).toEqual({
        users: mockUsers,
        pagination: {
          totalRows: mockCount,
          perPage: 10,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      });
    });
  });

  describe('getUserById', () => {
    const userId = 'user-123';
    const mockUser = { id: userId, first_name: 'John' };

    it('should return a user if found', async () => {
      (usersRepository.findOne as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.getUserById(userId);

      expect(usersRepository.findOne).toHaveBeenCalledWith({
        where: { id: userId },
      });
      expect(result).toEqual(mockUser);
    });

    it('should throw an error if user is not found', async () => {
      (usersRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.getUserById(userId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getUserById(userId)).rejects.toThrow('not found');
    });
  });

  describe('getAccountById', () => {
    const accountId = 'account-123';
    const mockAccount = { id: accountId, email: 'test@example.com' };

    it('should return an account if found', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue(mockAccount);

      const result = await service.getAccountById(accountId);

      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { id: accountId },
      });
      expect(result).toEqual(mockAccount);
    });

    it('should throw an error if account is not found', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.getAccountById(accountId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getAccountById(accountId)).rejects.toThrow(
        'not found',
      );
    });
  });

  describe('getUserFields', () => {
    const userId = 'user-123';
    const fields = ['first_name', 'last_name'];
    const mockUser = { id: userId, first_name: 'John', last_name: 'Doe' };

    it('should return requested user fields', async () => {
      (usersRepository.findOne as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.getUserFields(userId, fields);

      expect(usersRepository.findOne).toHaveBeenCalledWith({
        where: { id: userId },
        select: { first_name: true, last_name: true },
      });
      expect(result).toEqual({ first_name: 'John', last_name: 'Doe' });
    });

    it('should throw an error if user is not found', async () => {
      (usersRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.getUserFields(userId, fields)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getUserFields(userId, fields)).rejects.toThrow(
        'not found',
      );
    });
  });

  describe('updateUserById', () => {
    const accountId = 'account-123';
    const mockAccount = {
      id: accountId,
      userId: 'user-123',
      profile_name: 'Old Name',
    };
    const mockUpdateData: UpdateUserDto = {
      first_name: 'Jane',
      last_name: 'Doe',
    };

    it('should update user and account profile name', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue(mockAccount);
      (usersRepository.update as jest.Mock).mockResolvedValue({ affected: 1 });

      const result = await service.updateUserById(accountId, mockUpdateData);

      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { id: accountId },
      });
      expect(accountRepository.update).toHaveBeenCalledWith(accountId, {
        profile_name: 'Jane Doe',
      });
      expect(usersRepository.update).toHaveBeenCalledWith(
        'user-123',
        mockUpdateData,
      );
      expect(result).toEqual({ affected: 1 });
    });

    it('should throw an error if account is not found', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateUserById(accountId, mockUpdateData),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updateUserById(accountId, mockUpdateData),
      ).rejects.toThrow('not found');
    });
  });

  describe('deleteUserById', () => {
    const userId = 'user-123';

    it('should delete a user', async () => {
      (usersRepository.delete as jest.Mock).mockResolvedValue({ affected: 1 });

      await service.deleteUserById(userId);

      expect(usersRepository.delete).toHaveBeenCalledWith(userId);
    });
  });

  describe('getTenantAndPropertyInfo', () => {
    const tenantId = 'tenant-123';
    const mockTenant = {
      id: tenantId,
      role: RolesEnum.TENANT,
      user: { id: 'user-123' },
      property_tenants: [
        { property: { id: 'prop-123', rents: [{ id: 'rent-123' }] } },
      ],
    };

    it('should return tenant and property info if found', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue(mockTenant);

      const result = await service.getTenantAndPropertyInfo(tenantId);

      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { id: tenantId, role: RolesEnum.TENANT },
        relations: [
          'user',
          'property_tenants',
          'property_tenants.property.rents',
        ],
      });
      expect(result).toEqual(mockTenant);
    });

    it('should throw an error if tenant is not found', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.getTenantAndPropertyInfo(tenantId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getTenantAndPropertyInfo(tenantId)).rejects.toThrow(
        'not found',
      );
    });
  });

  describe('validateOtp', () => {
    const otp = '123456';
    const mockTokenEntry = {
      id: 'token-123',
      token: 'valid-token-123',
      expires_at: new Date(Date.now() + 10000),
    };

    it('should validate OTP and return token if valid', async () => {
      (passwordResetRepository.findOne as jest.Mock).mockResolvedValue(
        mockTokenEntry,
      );

      const result = await service.validateOtp(otp);

      expect(passwordResetRepository.findOne).toHaveBeenCalledWith({
        where: { otp },
      });
      expect(result).toEqual({
        message: 'OTP validated successfully',
        token: 'valid-token-123',
      });
    });

    it('should throw an error if OTP is invalid or expired', async () => {
      const expiredTokenEntry = {
        ...mockTokenEntry,
        expires_at: new Date(Date.now() - 1000),
      };
      (passwordResetRepository.findOne as jest.Mock).mockResolvedValue(
        expiredTokenEntry,
      );

      await expect(service.validateOtp(otp)).rejects.toThrow(HttpException);
      await expect(service.validateOtp(otp)).rejects.toThrow(
        'Invalid or expired OTP',
      );
    });
  });

  describe('resendOtp', () => {
    const oldToken = 'old-token-123';
    const mockExistingEntry = {
      id: 'token-123',
      user_id: 'user-123',
      expires_at: new Date(Date.now() - 1000),
    }; // Expired
    const mockUser = { id: 'user-123', email: 'test@example.com' };
    const mockNewOtp = '654321';
    const mockNewToken = 'new-token-456';

    beforeEach(() => {
      (mockUtilService.generateOTP as jest.Mock).mockReturnValue(mockNewOtp);
    });

    it('should resend OTP if token is valid and not recently sent', async () => {
      (passwordResetRepository.findOne as jest.Mock).mockResolvedValue(
        mockExistingEntry,
      );
      (accountRepository.findOne as jest.Mock).mockResolvedValue(mockUser);
      (passwordResetRepository.save as jest.Mock).mockResolvedValue({
        id: 'token-456',
        token: mockNewToken,
        otp: mockNewOtp,
        expires_at: expect.any(Date),
      });
      (mockUtilService.sendEmail as jest.Mock).mockResolvedValue(undefined);

      const result = await service.resendOtp(oldToken);

      expect(passwordResetRepository.findOne).toHaveBeenCalledWith({
        where: { token: oldToken },
      });
      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockExistingEntry.user_id },
      });
      expect(passwordResetRepository.delete).toHaveBeenCalledWith({
        id: mockExistingEntry.id,
      });
      expect(passwordResetRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: mockUser.id,
          otp: mockNewOtp,
        }),
      );
      expect(mockUtilService.sendEmail).toHaveBeenCalledWith(
        mockUser.email,
        expect.any(String), // EmailSubject
        expect.any(String), // emailContent
      );
      expect(result).toEqual({
        message: 'OTP resent successfully',
        token: mockNewToken,
      });
    });

    it('should throw an error if old token is invalid', async () => {
      (passwordResetRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.resendOtp(oldToken)).rejects.toThrow(HttpException);
      await expect(service.resendOtp(oldToken)).rejects.toThrow(
        'Invalid token',
      );
    });

    it('should throw an error if user is not found', async () => {
      (passwordResetRepository.findOne as jest.Mock).mockResolvedValue(
        mockExistingEntry,
      );
      (accountRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.resendOtp(oldToken)).rejects.toThrow(HttpException);
      await expect(service.resendOtp(oldToken)).rejects.toThrow(
        'User not found',
      );
    });

    it('should throw an error if OTP was sent recently', async () => {
      const recentEntry = {
        ...mockExistingEntry,
        expires_at: new Date(Date.now() + 15 * 60 * 1000 - 1000),
      }; // Expires in 14:59 min
      (passwordResetRepository.findOne as jest.Mock).mockResolvedValue(
        recentEntry,
      );
      (accountRepository.findOne as jest.Mock).mockResolvedValue(mockUser);

      await expect(service.resendOtp(oldToken)).rejects.toThrow(HttpException);
      await expect(service.resendOtp(oldToken)).rejects.toThrow(
        'OTP already sent recently',
      );
    });
  });

  describe('getTenantsOfAnAdmin', () => {
    const creatorId = 'admin-123';
    const mockQueryParams: UserFilter = { page: '1', size: '10' };
    const mockTenants = [
      { id: 'acc-1', user: { id: 'u1' }, rents: [{ property: { id: 'p1' } }] },
    ];
    const mockCount = 1;

    it('should return paginated tenants for an admin', async () => {
      (accountRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockTenants, mockCount]),
        orderBy: jest.fn().mockReturnThis(),
      });

      const result = await service.getTenantsOfAnAdmin(
        creatorId,
        mockQueryParams,
      );

      expect(accountRepository.createQueryBuilder).toHaveBeenCalledWith(
        'accounts',
      );
      expect(result).toEqual({
        users: mockTenants,
        pagination: {
          totalRows: mockCount,
          perPage: 10,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      });
    });
  });

  describe('getSingleTenantOfAnAdmin', () => {
    const tenantId = 'tenant-123';
    const mockTenant = {
      id: tenantId,
      user: { id: 'u1' },
      rents: [{ property: { id: 'p1' } }],
    };

    it('should return a single tenant if found', async () => {
      (accountRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockTenant),
      });

      const result = await service.getSingleTenantOfAnAdmin(tenantId);

      expect(accountRepository.createQueryBuilder).toHaveBeenCalledWith(
        'accounts',
      );
      expect(result).toEqual(mockTenant);
    });

    it('should throw an error if tenant is not found', async () => {
      (accountRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });

      await expect(service.getSingleTenantOfAnAdmin(tenantId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getSingleTenantOfAnAdmin(tenantId)).rejects.toThrow(
        'Tenant not found',
      );
    });
  });

  describe('uploadLogos', () => {
    const userId = 'user-123';
    const mockFile1 = {
      originalname: 'logo1.png',
      buffer: Buffer.from('...'),
    } as Express.Multer.File;
    const mockFile2 = {
      originalname: 'logo2.png',
      buffer: Buffer.from('...'),
    } as Express.Multer.File;
    const mockFiles = [mockFile1, mockFile2];
    const mockUser = { id: userId, role: RolesEnum.LANDLORD, logo_urls: [] };
    const mockUploadResult1 = {
      secure_url: 'https://cloudinary.com/logo1.png',
    };
    const mockUploadResult2 = {
      secure_url: 'https://cloudinary.com/logo2.png',
    };
    const expectedUrls = [
      mockUploadResult1.secure_url,
      mockUploadResult2.secure_url,
    ];

    it('should successfully upload logos and update user', async () => {
      (usersRepository.findOne as jest.Mock).mockResolvedValue(mockUser);
      (mockFileUploadService.uploadFile as jest.Mock)
        .mockResolvedValueOnce(mockUploadResult1)
        .mockResolvedValueOnce(mockUploadResult2);
      (usersRepository.save as jest.Mock).mockResolvedValue({
        ...mockUser,
        logo_urls: expectedUrls,
      });

      const result = await service.uploadLogos(userId, mockFiles);

      expect(usersRepository.findOne).toHaveBeenCalledWith({
        where: { id: userId, role: RolesEnum.LANDLORD },
      });
      expect(mockFileUploadService.uploadFile).toHaveBeenCalledWith(
        mockFile1,
        'admin-logos',
      );
      expect(mockFileUploadService.uploadFile).toHaveBeenCalledWith(
        mockFile2,
        'admin-logos',
      );
      expect(usersRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          ...mockUser,
          logo_urls: expectedUrls,
        }),
      );
      expect(result.logo_urls).toEqual(expectedUrls);
    });

    it('should throw an error if user is not found or not a landlord', async () => {
      (usersRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.uploadLogos(userId, mockFiles)).rejects.toThrow(
        HttpException,
      );
      await expect(service.uploadLogos(userId, mockFiles)).rejects.toThrow(
        'Admin not found',
      );
    });

    it('should throw an error if file upload fails', async () => {
      (usersRepository.findOne as jest.Mock).mockResolvedValue(mockUser);
      (mockFileUploadService.uploadFile as jest.Mock).mockRejectedValue(
        new Error('Upload failed'),
      );

      await expect(service.uploadLogos(userId, mockFiles)).rejects.toThrow(
        HttpException,
      );
      await expect(service.uploadLogos(userId, mockFiles)).rejects.toThrow(
        'Error uploading logos',
      );
    });
  });

  describe('update', () => {
    const userId = 'user-123';
    const mockKyc = { id: 'kyc-123', user_id: userId };
    const mockUser = { id: userId, kyc: mockKyc };
    const mockUpdateKycDto: UpdateKycDto = { id_card_type: 'Voter ID' };
    const mockUpdatedKyc = { ...mockKyc, id_card_type: 'Voter ID' };

    it('should update KYC if found', async () => {
      (usersRepository.findOne as jest.Mock).mockResolvedValue(mockUser);
      (kycRepository.merge as jest.Mock).mockReturnValue(mockUpdatedKyc);
      (kycRepository.save as jest.Mock).mockResolvedValue(mockUpdatedKyc);

      const result = await service.update(userId, mockUpdateKycDto);

      expect(usersRepository.findOne).toHaveBeenCalledWith({
        where: { id: userId },
        relations: ['kyc'],
      });
      expect(kycRepository.merge).toHaveBeenCalledWith(
        mockKyc,
        mockUpdateKycDto,
      );
      expect(kycRepository.save).toHaveBeenCalledWith(mockUpdatedKyc);
      expect(result).toEqual(mockUpdatedKyc);
    });

    it('should throw an error if user or KYC is not found', async () => {
      const userWithoutKyc = { id: userId, kyc: null };
      (usersRepository.findOne as jest.Mock).mockResolvedValue(userWithoutKyc);

      await expect(service.update(userId, mockUpdateKycDto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.update(userId, mockUpdateKycDto)).rejects.toThrow(
        'KYC record not found for this user',
      );
    });
  });

  describe('createLandlord', () => {
    const mockCreateLandlordDto: CreateLandlordDto = {
      email: 'landlord@example.com',
      phone_number: '08022222222',
      first_name: 'Land',
      last_name: 'Lord',
      agency_name: 'Lord Agency',
      password: 'securePassword',
    };
    const mockNewUser = {
      id: 'user-789',
      email: 'landlord@example.com',
      phone_number: '2348022222222',
      first_name: 'Land',
      last_name: 'Lord',
      role: RolesEnum.LANDLORD,
      is_verified: true,
    };
    const mockNewAccount = {
      id: 'account-789',
      user: mockNewUser,
      email: 'landlord@example.com',
      role: RolesEnum.LANDLORD,
      profile_name: 'Lord Agency',
      is_verified: true,
    };

    beforeEach(() => {
      (mockUtilService.hashPassword as jest.Mock).mockResolvedValue(
        'hashedSecurePassword',
      );
    });

    it('should successfully create a new landlord account', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue(null); // No existing account
      (usersRepository.findOne as jest.Mock).mockResolvedValue(null); // User doesn't exist
      (usersRepository.save as jest.Mock).mockResolvedValue(mockNewUser);
      (accountRepository.save as jest.Mock).mockResolvedValue(mockNewAccount);

      const result = await service.createLandlord(mockCreateLandlordDto);

      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { email: mockCreateLandlordDto.email, role: RolesEnum.LANDLORD },
      });
      expect(usersRepository.findOne).toHaveBeenCalledWith({
        where: { phone_number: mockCreateLandlordDto.phone_number },
      });
      expect(usersRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          phone_number: '2348022222222',
          first_name: mockCreateLandlordDto.first_name,
          last_name: mockCreateLandlordDto.last_name,
          role: RolesEnum.LANDLORD,
        }),
      );
      expect(accountRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: mockCreateLandlordDto.email,
          password: 'hashedSecurePassword',
          role: RolesEnum.LANDLORD,
          profile_name: mockCreateLandlordDto.agency_name,
        }),
      );
      expect(result).toEqual({ ...mockNewUser, password: undefined }); // Password should be omitted
    });

    it('should throw an error if landlord account with email already exists', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue(
        mockNewAccount,
      );

      await expect(
        service.createLandlord(mockCreateLandlordDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createLandlord(mockCreateLandlordDto),
      ).rejects.toThrow('already exists');
    });

    it('should throw an error if password is not provided', async () => {
      const dtoWithoutPassword = {
        ...mockCreateLandlordDto,
        password: undefined,
      };

      await expect(service.createLandlord(dtoWithoutPassword)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createLandlord(dtoWithoutPassword)).rejects.toThrow(
        'Password is required',
      );
    });
  });

  describe('createAdmin', () => {
    const mockCreateAdminDto: CreateAdminDto = {
      email: 'admin@example.com',
      phone_number: '08033333333',
      first_name: 'Admin',
      last_name: 'User',
      password: 'adminPassword',
    };
    const mockNewUser = {
      id: 'user-890',
      email: 'admin@example.com',
      phone_number: '2348033333333',
      first_name: 'Admin',
      last_name: 'User',
      role: RolesEnum.ADMIN,
      is_verified: true,
    };
    const mockNewAccount = {
      id: 'account-890',
      user: mockNewUser,
      email: 'admin@example.com',
      role: RolesEnum.ADMIN,
      profile_name: "Admin User's Admin Account",
      is_verified: true,
    };

    beforeEach(() => {
      (mockUtilService.hashPassword as jest.Mock).mockResolvedValue(
        'hashedAdminPassword',
      );
    });

    it('should successfully create a new admin account', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue(null); // No existing account
      (usersRepository.findOne as jest.Mock).mockResolvedValue(null); // User doesn't exist
      (usersRepository.save as jest.Mock).mockResolvedValue(mockNewUser);
      (accountRepository.save as jest.Mock).mockResolvedValue(mockNewAccount);

      const result = await service.createAdmin(mockCreateAdminDto);

      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { email: mockCreateAdminDto.email, role: RolesEnum.ADMIN },
      });
      expect(usersRepository.findOne).toHaveBeenCalledWith({
        where: { phone_number: mockCreateAdminDto.phone_number },
      });
      expect(usersRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          phone_number: '2348033333333',
          first_name: mockCreateAdminDto.first_name,
          last_name: mockCreateAdminDto.last_name,
          role: RolesEnum.ADMIN,
        }),
      );
      expect(accountRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: mockCreateAdminDto.email,
          password: 'hashedAdminPassword',
          role: RolesEnum.ADMIN,
          profile_name: "Admin User's Admin Account",
        }),
      );
      expect(result).toEqual({ ...mockNewUser, password: undefined }); // Password should be omitted
    });

    it('should throw an error if admin account with email already exists', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue(
        mockNewAccount,
      );

      await expect(service.createAdmin(mockCreateAdminDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createAdmin(mockCreateAdminDto)).rejects.toThrow(
        'already exists',
      );
    });

    it('should throw an error if password is not provided', async () => {
      const dtoWithoutPassword = { ...mockCreateAdminDto, password: undefined };

      await expect(service.createAdmin(dtoWithoutPassword)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createAdmin(dtoWithoutPassword)).rejects.toThrow(
        'Password is required',
      );
    });
  });

  describe('createCustomerRep', () => {
    const mockCreateCustomerRepDto: CreateCustomerRepDto = {
      email: 'rep@example.com',
      phone_number: '08044444444',
      first_name: 'Rep',
      last_name: 'User',
      password: 'repPassword', // Optional
    };
    const mockNewUser = {
      id: 'user-901',
      email: 'rep@example.com',
      phone_number: '2348044444444',
      first_name: 'Rep',
      last_name: 'User',
      role: RolesEnum.REP,
      is_verified: true,
    };
    const mockNewAccount = {
      id: 'account-901',
      user: mockNewUser,
      email: 'rep@example.com',
      role: RolesEnum.REP,
      profile_name: 'Rep User',
      is_verified: true,
    };
    const mockToken = 'reset-token-456';

    beforeEach(() => {
      (mockUtilService.hashPassword as jest.Mock).mockResolvedValue(
        'hashedRepPassword',
      );
      (mockConfigService.get as jest.Mock).mockReturnValue(
        'https://frontend.example.com',
      );
      (mockUtilService.sendEmail as jest.Mock).mockResolvedValue(undefined);
    });

    it('should successfully create a new customer rep account', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue(null); // No existing account
      (usersRepository.findOne as jest.Mock).mockResolvedValue(null); // User doesn't exist
      (usersRepository.save as jest.Mock).mockResolvedValue(mockNewUser);
      (accountRepository.save as jest.Mock).mockResolvedValue(mockNewAccount);
      (service as any).generatePasswordResetToken = jest
        .fn()
        .mockResolvedValue(mockToken);

      const result = await service.createCustomerRep(mockCreateCustomerRepDto);

      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { email: mockCreateCustomerRepDto.email, role: RolesEnum.REP },
      });
      expect(usersRepository.findOne).toHaveBeenCalledWith({
        where: { email: mockCreateCustomerRepDto.email },
      });
      expect(usersRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          phone_number: '2348044444444',
          first_name: mockCreateCustomerRepDto.first_name,
          last_name: mockCreateCustomerRepDto.last_name,
          role: RolesEnum.REP,
        }),
      );
      expect(accountRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: mockCreateCustomerRepDto.email,
          password: 'hashedRepPassword', // Or '' if password was undefined
          role: RolesEnum.REP,
          profile_name: 'Rep User',
        }),
      );
      expect((service as any).generatePasswordResetToken).toHaveBeenCalledWith(
        mockNewAccount.id,
        expect.anything(),
      ); // QueryRunner instance
      expect(mockUtilService.sendEmail).toHaveBeenCalledWith(
        mockCreateCustomerRepDto.email,
        expect.any(String), // EmailSubject
        expect.any(String), // emailContent
      );
      expect(result).toEqual({ ...mockNewUser, password: undefined }); // Password should be omitted
    });

    it('should throw an error if rep account with email already exists', async () => {
      (accountRepository.findOne as jest.Mock).mockResolvedValue({
        id: 'existing-rep-account',
      });

      await expect(
        service.createCustomerRep(mockCreateCustomerRepDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createCustomerRep(mockCreateCustomerRepDto),
      ).rejects.toThrow('already exists');
    });

    it('should create account with empty password if password is not provided', async () => {
      const dtoWithoutPassword = {
        ...mockCreateCustomerRepDto,
        password: undefined,
      };
      (accountRepository.findOne as jest.Mock).mockResolvedValue(null);
      (usersRepository.findOne as jest.Mock).mockResolvedValue(null);
      (usersRepository.save as jest.Mock).mockResolvedValue(mockNewUser);
      (accountRepository.save as jest.Mock).mockResolvedValue(mockNewAccount);
      (service as any).generatePasswordResetToken = jest
        .fn()
        .mockResolvedValue(mockToken);

      await service.createCustomerRep(dtoWithoutPassword);

      expect(accountRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          password: '', // Should be empty string
        }),
      );
    });
  });

  describe('getSubAccounts', () => {
    const adminId = 'admin-123';
    const mockSubAccounts = [
      {
        id: 'sub-1',
        user: { id: 'u1', first_name: 'Sub1' },
        creator_id: adminId,
      },
      {
        id: 'sub-2',
        user: { id: 'u2', first_name: 'Sub2' },
        creator_id: adminId,
      },
    ];

    it('should return sub-accounts for an admin', async () => {
      (accountRepository.find as jest.Mock).mockResolvedValue(mockSubAccounts);

      const result = await service.getSubAccounts(adminId);

      expect(accountRepository.find).toHaveBeenCalledWith({
        where: { creator_id: adminId },
        relations: ['user'],
      });
      expect(result).toEqual(mockSubAccounts);
    });
  });

  // Note: switchAccount test requires mocking cookies, which is complex.
  // A simplified test focusing on the token generation logic is shown.
  describe('switchAccount', () => {
    const targetAccountId = 'target-acc-123';
    const currentAccountId = 'current-acc-123';
    const mockCurrentAccount = { id: currentAccountId };
    const mockTargetAccount = {
      id: targetAccountId,
      creator_id: currentAccountId,
      user: {
        id: 'user-123',
        first_name: 'Target',
        last_name: 'User',
        phone_number: '2348055555555',
      },
      email: 'target@example.com',
      role: RolesEnum.TENANT,
    };
    const mockToken = 'switch-token-789';

    beforeEach(() => {
      (mockAuthService.generateToken as jest.Mock).mockResolvedValue(mockToken);
    });

    it('should switch account if authorized', async () => {
      const mockRes = { cookie: jest.fn() };
      (accountRepository.findOne as jest.Mock).mockResolvedValue(
        mockTargetAccount,
      );

      const result = await service.switchAccount({
        targetAccountId,
        currentAccount: mockCurrentAccount,
        res: mockRes,
      });

      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { id: targetAccountId },
        relations: ['user'],
      });
      expect(mockAuthService.generateToken).toHaveBeenCalledWith({
        id: mockTargetAccount.id,
        first_name: mockTargetAccount.user.first_name,
        last_name: mockTargetAccount.user.last_name,
        email: mockTargetAccount.email,
        phone_number: mockTargetAccount.user.phone_number,
        role: mockTargetAccount.role,
      });
      expect(mockRes.cookie).toHaveBeenCalledWith(
        'access_token',
        mockToken,
        expect.any(Object),
      );
      expect(result).toEqual({
        success: true,
        message: 'Switched account successfully',
      });
    });

    it('should throw an error if target account is not found or unauthorized', async () => {
      const mockRes = {};
      (accountRepository.findOne as jest.Mock).mockResolvedValue(null); // Not found

      await expect(
        service.switchAccount({
          targetAccountId,
          currentAccount: mockCurrentAccount,
          res: mockRes,
        }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.switchAccount({
          targetAccountId,
          currentAccount: mockCurrentAccount,
          res: mockRes,
        }),
      ).rejects.toThrow('You cannot switch to this account');
    });
  });

  describe('getTeamMembers', () => {
    const userId = 'landlord-123';
    const mockTeam = { id: 'team-123', creatorId: userId };
    const mockTeamMembers = [
      {
        id: 'tm-1',
        teamId: 'team-123',
        account: { id: 'acc-1', user: { id: 'u1' } },
      },
      {
        id: 'tm-2',
        teamId: 'team-123',
        account: { id: 'acc-2', user: { id: 'u2' } },
      },
    ];

    it('should return team members if user owns the team', async () => {
      (teamRepository.findOne as jest.Mock).mockResolvedValue(mockTeam);
      (teamMemberRepository.find as jest.Mock).mockResolvedValue(
        mockTeamMembers,
      );

      const result = await service.getTeamMembers(userId);

      expect(teamRepository.findOne).toHaveBeenCalledWith({
        where: { creatorId: userId },
      });
      expect(teamMemberRepository.find).toHaveBeenCalledWith({
        where: { teamId: 'team-123' },
        relations: ['account', 'account.user'],
      });
      expect(result).toEqual(mockTeamMembers);
    });

    it('should throw an error if team is not found', async () => {
      (teamRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.getTeamMembers(userId)).rejects.toThrow(
        HttpException,
      );
      await expect(service.getTeamMembers(userId)).rejects.toThrow(
        'Team not found',
      );
    });

    it('should throw an error if user does not own the team', async () => {
      const wrongCreatorId = 'someone-else-123';
      const mockWrongTeam = { id: 'team-123', creatorId: wrongCreatorId };
      (teamRepository.findOne as jest.Mock).mockResolvedValue(mockWrongTeam);

      await expect(service.getTeamMembers(userId)).rejects.toThrow(
        HttpException,
      );
      await expect(service.getTeamMembers(userId)).rejects.toThrow(
        'Not authorized to view members of this team',
      );
    });
  });

  describe('getWaitlist', () => {
    const mockWaitlist = [{ id: 'wl-1', email: 'wait1@example.com' }];

    it('should return the waitlist', async () => {
      (waitlistRepository.find as jest.Mock).mockResolvedValue(mockWaitlist);

      const result = await service.getWaitlist();

      expect(waitlistRepository.find).toHaveBeenCalledWith();
      expect(result).toEqual(mockWaitlist);
    });
  });

  describe('getLandlords', () => {
    const mockLandlords = [
      { id: 'user-123', role: RolesEnum.LANDLORD, first_name: 'Landlord' },
    ];

    it('should return all landlords', async () => {
      (usersRepository.find as jest.Mock).mockResolvedValue(mockLandlords);

      const result = await service.getLandlords();

      expect(usersRepository.find).toHaveBeenCalledWith({
        where: { role: RolesEnum.LANDLORD },
      });
      expect(result).toEqual(mockLandlords);
    });
  });

  // Tests for sendPropertiesNotification, sendUserAddedTemplate, getWhatsappText
  // can be added if they have complex logic, but currently they just delegate.
  // Example for sendPropertiesNotification:
  describe('sendPropertiesNotification', () => {
    const mockData = {
      phone_number: '2348066666666',
      name: 'John',
      property_name: 'My Property',
    };

    it('should call whatsappBotService with correct data', async () => {
      await service.sendPropertiesNotification(mockData);

      expect(
        mockWhatsappBotService.sendToPropertiesCreatedTemplate,
      ).toHaveBeenCalledWith(mockData);
    });
  });

  // Example for sendUserAddedTemplate:
  describe('sendUserAddedTemplate', () => {
    const mockData = {
      phone_number: '2348066666666',
      name: 'Admin',
      user: 'New Tenant',
      property_name: 'My Property',
    };

    it('should call whatsappBotService with correct data', async () => {
      await service.sendUserAddedTemplate(mockData);

      expect(mockWhatsappBotService.sendUserAddedTemplate).toHaveBeenCalledWith(
        mockData,
      );
    });
  });

  // Example for getWhatsappText:
  describe('getWhatsappText', () => {
    const from = '2348066666666';
    const message = 'Hello';

    it('should call whatsappBotService with correct data', async () => {
      await service.getWhatsappText(from, message);

      expect(mockWhatsappBotService.sendText).toHaveBeenCalledWith(
        from,
        message,
      );
    });
  });

  // Tests for logoutUser (if needed, though it's primarily cookie manipulation)
  describe('logoutUser', () => {
    it('should clear the access_token cookie', async () => {
      const mockRes = {
        clearCookie: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await service.logoutUser(mockRes);

      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'access_token',
        expect.any(Object),
      );
      expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Logout successful',
      });
    });
  });
});

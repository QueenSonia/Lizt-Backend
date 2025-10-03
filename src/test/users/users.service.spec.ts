import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClientResponse } from '@sendgrid/mail';
import { Response } from 'express';
import moment from 'moment';
import { AuthService } from 'src/auth/auth.service';
import { RolesEnum } from 'src/base.entity';
import { CacheService } from 'src/lib/cache';
import { PropertyStatusEnum } from 'src/properties/dto/create-property.dto';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Property } from 'src/properties/entities/property.entity';
import { Rent } from 'src/rents/entities/rent.entity';
import {
  EmploymentStatus,
  Gender,
  MaritalStatus,
} from 'src/tenant-kyc/entities/tenant-kyc.entity';
import { CreateKycDto } from 'src/users/dto/create-kyc.dto';
import {
  CreateAdminDto,
  CreateCustomerRepDto,
  CreateLandlordDto,
  CreateTenantDto,
  CreateTenantKycDto,
  CreateUserDto,
  LoginDto,
  UserFilter,
} from 'src/users/dto/create-user.dto';
import { ResetPasswordDto } from 'src/users/dto/reset-password.dto';
import { UpdateKycDto } from 'src/users/dto/update-kyc.dto';
import { UpdateUserDto } from 'src/users/dto/update-user.dto';
import { Account } from 'src/users/entities/account.entity';
import { KYC } from 'src/users/entities/kyc.entity';
import { PasswordResetToken } from 'src/users/entities/password-reset-token.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { Team } from 'src/users/entities/team.entity';
import { Users } from 'src/users/entities/user.entity';
import { Waitlist } from 'src/users/entities/waitlist.entity';
import { UsersService } from 'src/users/users.service';
import { FileUploadService } from 'src/utils/cloudinary';
import { UtilService } from 'src/utils/utility-service';
import { WhatsappBotService } from 'src/whatsapp-bot/whatsapp-bot.service';
import { DataSource, QueryRunner } from 'typeorm';
import * as uuid from 'uuid';

describe('UsersService', () => {
  let service: UsersService;

  const mockUsersRepository = {
    findOne: jest.fn(),
    exists: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    findAndCount: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
    }),
    find: jest.fn(),
  };

  const mockAccountRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    find: jest.fn(),
    exists: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
    }),
  };

  const mockKycRepository = {
    create: jest.fn(),
    save: jest.fn(),
    merge: jest.fn(),
  };

  const mockTeamRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockTeamMemberRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
  };

  const mockPasswordResetRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
  };

  const mockPropertyTenantRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };

  const mockRentRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    exists: jest.fn(),
  };

  const mockWaitlistRepository = {
    find: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockAuthService = {
    generateToken: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockClientResponse: ClientResponse = {
    statusCode: 202,
    headers: {},
    body: {},
  };

  const mockFileUploadService = {
    uploadFile: jest.fn(),
  };

  const mockWhatsappBotService = {
    sendToUserWithTemplate: jest.fn(),
    sendTenantWelcomeTemplate: jest.fn(),
    sendUserAddedTemplate: jest.fn(),
    sendToFacilityManagerWithTemplate: jest.fn(),
    sendText: jest.fn(),
    sendToPropertiesCreatedTemplate: jest.fn(),
  };

  const mockCacheService = {};

  const mockDataSource = {
    transaction: jest.fn(),
    createQueryRunner: jest.fn(),
  };

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      findOne: jest.fn(),
      exists: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest
      .spyOn(mockDataSource, 'createQueryRunner')
      .mockReturnValue(mockQueryRunner);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(Users),
          useValue: mockUsersRepository,
        },
        {
          provide: getRepositoryToken(Account),
          useValue: mockAccountRepository,
        },
        {
          provide: getRepositoryToken(KYC),
          useValue: mockKycRepository,
        },
        {
          provide: getRepositoryToken(Team),
          useValue: mockTeamRepository,
        },
        {
          provide: getRepositoryToken(TeamMember),
          useValue: mockTeamMemberRepository,
        },
        {
          provide: getRepositoryToken(PasswordResetToken),
          useValue: mockPasswordResetRepository,
        },
        {
          provide: getRepositoryToken(PropertyTenant),
          useValue: mockPropertyTenantRepository,
        },
        {
          provide: getRepositoryToken(Rent),
          useValue: mockRentRepository,
        },
        {
          provide: getRepositoryToken(Waitlist),
          useValue: mockWaitlistRepository,
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
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: FileUploadService,
          useValue: mockFileUploadService,
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
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addTenant', () => {
    it('should add a new tenant successfully', async () => {
      // Arrange
      const user_id = 'admin_id';
      const dto: CreateTenantDto = {
        phone_number: '1234567890',
        full_name: 'John Doe',
        rent_amount: 1000,
        due_date: new Date('2025-01-01'),
        email: 'john@example.com',
        property_id: 'prop_id',
      };
      const adminAccount = {
        id: user_id,
        role: RolesEnum.ADMIN,
        user: { phone_number: 'admin_phone' },
        profile_name: 'Admin',
      };
      const property = {
        id: 'prop_id',
        name: 'Property',
        property_status: PropertyStatusEnum.VACANT,
      };
      const tenantUser = {
        id: 'tenant_id',
        first_name: 'John',
        last_name: 'Doe',
        phone_number: '1234567890',
        role: RolesEnum.TENANT,
      };
      const tenantAccount = { id: 'tenant_acc_id', role: RolesEnum.TENANT };
      const mockManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === Account)
            return {
              findOne: jest.fn().mockResolvedValue(adminAccount),
              create: jest.fn().mockReturnValue(tenantAccount),
              save: jest.fn(),
            };
          if (entity === Users)
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockReturnValue(tenantUser),
              save: jest.fn(),
            };
          if (entity === Property)
            return {
              findOne: jest.fn().mockResolvedValue(property),
              save: jest.fn(),
            };
          if (entity === Rent)
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn(),
              save: jest.fn(),
            };
          if (entity === PropertyTenant)
            return { create: jest.fn(), save: jest.fn() };
          return {};
        }),
      };
      mockDataSource.transaction.mockImplementation(async (cb) =>
        cb(mockManager),
      );
      jest
        .spyOn(UtilService, 'normalizePhoneNumber')
        .mockReturnValue('1234567890');
      jest
        .spyOn(UtilService, 'toSentenceCase')
        .mockImplementation((str) => str);
      jest.spyOn(UtilService, 'generatePassword').mockResolvedValue('password');
      mockWhatsappBotService.sendTenantWelcomeTemplate.mockResolvedValue(
        undefined,
      );
      mockWhatsappBotService.sendUserAddedTemplate.mockResolvedValue(undefined);

      // Act
      const result = await service.addTenant(user_id, dto);

      // Assert
      expect(result).toEqual(tenantUser);
      expect(mockDataSource.transaction).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'user.added',
        expect.any(Object),
      );
      expect(
        mockWhatsappBotService.sendTenantWelcomeTemplate,
      ).toHaveBeenCalled();
      expect(mockWhatsappBotService.sendUserAddedTemplate).toHaveBeenCalled();
    });

    it('should throw if admin is not found', async () => {
      // Arrange
      const user_id = 'admin_id';
      const dto: CreateTenantDto = {
        phone_number: '1234567890',
        full_name: 'John Doe',
        rent_amount: 1000,
        due_date: new Date('2025-01-01'),
        email: 'john@example.com',
        property_id: 'prop_id',
      };
      const mockManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === Account)
            return { findOne: jest.fn().mockResolvedValue(null) };
          return {};
        }),
      };
      mockDataSource.transaction.mockImplementation(async (cb) =>
        cb(mockManager),
      );

      // Act
      // Assert
      await expect(service.addTenant(user_id, dto)).rejects.toThrow(
        new HttpException('admin account not found', HttpStatus.NOT_FOUND),
      );
    });

    it('should throw if user already exists', async () => {
      // Arrange
      const user_id = 'admin_id';
      const dto: CreateTenantDto = {
        phone_number: '1234567890',
        full_name: 'John Doe',
      } as CreateTenantDto;
      const adminAccount = { id: user_id, role: RolesEnum.ADMIN };
      const mockManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === Account)
            return { findOne: jest.fn().mockResolvedValue(adminAccount) };
          if (entity === Users)
            return { findOne: jest.fn().mockResolvedValue({}) };
          return {};
        }),
      };
      mockDataSource.transaction.mockImplementation(async (cb) =>
        cb(mockManager),
      );
      jest
        .spyOn(UtilService, 'normalizePhoneNumber')
        .mockReturnValue('1234567890');

      // Act & Assert
      await expect(service.addTenant(user_id, dto)).rejects.toThrow(
        HttpException,
      );
    });

    it('should throw if property not found', async () => {
      // arrange
      const user_id = 'admin_id';
      const dto: CreateTenantDto = {
        property_id: 'prop_id',
        phone_number: '1234567890',
        full_name: 'John Doe',
      } as CreateTenantDto;
      const adminAccount = { id: user_id, role: RolesEnum.ADMIN };
      const mockManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === Account)
            return { findOne: jest.fn().mockResolvedValue(adminAccount) };
          if (entity === Users)
            return { findOne: jest.fn().mockResolvedValue(null) };
          if (entity === Property)
            return { findOne: jest.fn().mockResolvedValue(null) };
          return {};
        }),
      };
      mockDataSource.transaction.mockImplementation(async (cb) =>
        cb(mockManager),
      );

      // act & assert
      await expect(service.addTenant(user_id, dto)).rejects.toThrow(
        HttpException,
      );
    });

    it('should throw if property already rented', async () => {
      // arrange
      const user_id = 'admin_id';
      const dto: CreateTenantDto = {
        property_id: 'prop_id',
        phone_number: '1234567890',
        full_name: 'John Doe',
      } as CreateTenantDto;
      const adminAccount = { id: user_id, role: RolesEnum.ADMIN };
      const property = { id: 'prop_id' };
      const mockManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === Account)
            return { findOne: jest.fn().mockResolvedValue(adminAccount) };
          if (entity === Users)
            return { findOne: jest.fn().mockResolvedValue(null) };
          if (entity === Property)
            return { findOne: jest.fn().mockResolvedValue(property) };
          if (entity === Rent)
            return { findOne: jest.fn().mockResolvedValue({}) };
          return {};
        }),
      };
      mockDataSource.transaction.mockImplementation(async (cb) =>
        cb(mockManager),
      );

      // act & assert
      await expect(service.addTenant(user_id, dto)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('addTenantKyc', () => {
    it('should add tenant with KYC successfully', async () => {
      // arrange
      const user_id = 'landlord_id';
      const dto = {
        phone_number: '+2348148696119',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john.doe@example.com',
      } as unknown as CreateTenantKycDto;
      const landlordAccount = {
        id: user_id,
        role: RolesEnum.LANDLORD,
        user: { phone_number: 'landlord_phone' },
        profile_name: 'Landlord',
      };
      const property = {
        id: 'prop_id',
        name: 'Property',
        property_status: PropertyStatusEnum.VACANT,
      };
      const tenantUser = {
        id: 'tenant_id',
        phone_number: '1234567890',
        role: RolesEnum.TENANT,
      };
      const tenantAccount = { id: 'tenant_acc_id', role: RolesEnum.TENANT };
      const mockManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === Account)
            return {
              findOne: jest.fn().mockResolvedValue(landlordAccount),
              create: jest.fn().mockReturnValue(tenantAccount),
              save: jest.fn(),
            };
          if (entity === Users)
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockReturnValue(tenantUser),
              save: jest.fn(),
            };
          if (entity === Property)
            return {
              findOne: jest.fn().mockResolvedValue(property),
              save: jest.fn(),
            };
          if (entity === Rent)
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn(),
              save: jest.fn(),
            };
          if (entity === PropertyTenant)
            return { create: jest.fn(), save: jest.fn() };
          return {};
        }),
      };
      mockDataSource.transaction.mockImplementation(async (cb) =>
        cb(mockManager),
      );
      jest
        .spyOn(UtilService, 'normalizePhoneNumber')
        .mockReturnValue('1234567890');
      jest
        .spyOn(UtilService, 'toSentenceCase')
        .mockImplementation((str) => str);
      jest.spyOn(UtilService, 'generatePassword').mockResolvedValue('password');
      mockWhatsappBotService.sendToUserWithTemplate.mockResolvedValue(
        undefined,
      );
      mockWhatsappBotService.sendTenantWelcomeTemplate.mockResolvedValue(
        undefined,
      );
      mockWhatsappBotService.sendUserAddedTemplate.mockResolvedValue(undefined);

      // act
      const result = await service.addTenantKyc(user_id, dto);

      // assert
      expect(result).toEqual(tenantUser);
      expect(mockDataSource.transaction).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'user.added',
        expect.any(Object),
      );
      expect(mockWhatsappBotService.sendToUserWithTemplate).toHaveBeenCalled();
      expect(
        mockWhatsappBotService.sendTenantWelcomeTemplate,
      ).toHaveBeenCalled();
      expect(mockWhatsappBotService.sendUserAddedTemplate).toHaveBeenCalled();
    });

    it('should throw if landlord not found', async () => {
      // arrange
      const user_id = 'landlord_id';
      const dto: CreateTenantKycDto = {} as CreateTenantKycDto;
      const mockManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === Account)
            return { findOne: jest.fn().mockResolvedValue(null) };
          return {};
        }),
      };
      mockDataSource.transaction.mockImplementation(async (cb) =>
        cb(mockManager),
      );

      // act & assert
      await expect(service.addTenantKyc(user_id, dto)).rejects.toThrow(
        new HttpException('admin account not found', HttpStatus.NOT_FOUND),
      );
    });
  });
  describe('createUser', () => {
    it('should create a new user successfully', async () => {
      // arrange
      const data = {
        email: 'test@example.com',
        phone_number: '1234567890',
        first_name: 'Test',
        last_name: 'User',
        role: 'tenant',
        property_id: 'prop_id',
        rental_price: 1000,
        lease_start_date: '2024-01-01',
        lease_end_date: '2025-01-01',
        security_deposit: 500,
        service_charge: 200,
      } as unknown as CreateUserDto;
      const creatorId = 'creator_id';
      const user = { id: 'user_id', first_name: 'Test', last_name: 'User' };
      const property = {
        id: 'prop_id',
        name: 'Property',
        owner_id: 'owner_id',
      };
      const account = {
        id: 'acc_id',
        profile_name: 'Test User',
        role: RolesEnum.TENANT,
      };
      mockQueryRunner.connect.mockResolvedValue(undefined);
      mockQueryRunner.startTransaction.mockResolvedValue(undefined);
      mockQueryRunner.commitTransaction.mockResolvedValue(undefined);
      mockQueryRunner.rollbackTransaction.mockResolvedValue(undefined);
      mockQueryRunner.release.mockResolvedValue(undefined);
      mockQueryRunner.manager.findOne.mockImplementation((entity, options) => {
        if (entity === Users && options.where.email)
          return Promise.resolve(null);
        if (entity === Account) return Promise.resolve(null);
        if (entity === Property) return Promise.resolve(property);
        return Promise.resolve(user);
      });
      mockQueryRunner.manager.exists.mockImplementation((entity) => {
        if (entity === Rent) return Promise.resolve(false);
        return Promise.resolve(false);
      });
      mockQueryRunner.manager.save.mockResolvedValue(account);
      mockQueryRunner.manager.create.mockReturnValue(account);
      mockQueryRunner.manager.update.mockResolvedValue(undefined);
      jest
        .spyOn(service as any, 'generatePasswordResetToken')
        .mockResolvedValue('token');
      jest
        .spyOn(UtilService, 'sendEmail')
        .mockResolvedValue([mockClientResponse, {}]);

      jest
        .spyOn(UtilService, 'toSentenceCase')
        .mockImplementation((str) => str);
      mockConfigService.get.mockImplementation((key) => {
        if (key === 'FRONTEND_URL') return 'http://frontend';
        if (key === 'GMAIL_USER') return 'panda@gmail.com';
      });

      // act
      const result = await service.createUser(data, creatorId);

      // assert
      expect(result).toMatchObject({
        ...account,
        password_link: expect.any(String),
      });
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'user.added',
        expect.any(Object),
      );
      expect(UtilService.sendEmail).toHaveBeenCalledTimes(2);
    });

    it('should throw if existing account', async () => {
      // arrange
      const data: CreateUserDto = {
        email: 'test@example.com',
        role: 'tenant',
      } as CreateUserDto;
      const creatorId = 'creator_id';
      mockQueryRunner.connect.mockResolvedValue(undefined);
      mockQueryRunner.startTransaction.mockResolvedValue(undefined);
      mockQueryRunner.manager.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({}); // existing account

      // act & assert
      await expect(service.createUser(data, creatorId)).rejects.toThrow(
        new HttpException(
          `Account with email: ${data.email} already exists`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        ),
      );
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should throw if property not found', async () => {
      // arrange
      const data: CreateUserDto = {
        property_id: 'prop_id',
        role: 'tenant',
      } as CreateUserDto;
      const creatorId = 'creator_id';
      mockQueryRunner.connect.mockResolvedValue(undefined);
      mockQueryRunner.startTransaction.mockResolvedValue(undefined);
      mockQueryRunner.manager.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      // act & assert
      await expect(service.createUser(data, creatorId)).rejects.toThrow(
        HttpException,
      );
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should throw if property already rented', async () => {
      // arrange
      const data: CreateUserDto = {
        property_id: 'prop_id',
        role: 'tenant',
      } as CreateUserDto;
      const creatorId = 'creator_id';
      mockQueryRunner.connect.mockResolvedValue(undefined);
      mockQueryRunner.startTransaction.mockResolvedValue(undefined);
      mockQueryRunner.manager.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'prop_id' });
      mockQueryRunner.manager.exists.mockResolvedValue(true);

      // act & assert
      await expect(service.createUser(data, creatorId)).rejects.toThrow(
        HttpException,
      );
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should handle transaction error', async () => {
      // arrange
      const data: CreateUserDto = { role: 'tenant' } as CreateUserDto;
      const creatorId = 'creator_id';
      mockQueryRunner.connect.mockResolvedValue(undefined);
      mockQueryRunner.startTransaction.mockResolvedValue(undefined);
      mockQueryRunner.manager.findOne.mockRejectedValue(new Error('error'));

      // act & assert
      await expect(service.createUser(data, creatorId)).rejects.toThrow(
        HttpException,
      );
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });

  describe('generatePasswordResetToken', () => {
    it('should generate reset token successfully', async () => {
      // arrange
      const userId = 'user_id';
      const token = 'mocked-token';
      jest
        .spyOn(uuid, 'v4')
        .mockReturnValue(token as unknown as ReturnType<typeof uuid.v4>);
      mockQueryRunner.manager.create.mockReturnValue({ token });
      mockQueryRunner.manager.save.mockResolvedValue(undefined);

      // act
      const result = await service.generatePasswordResetToken(
        userId,
        mockQueryRunner as any,
      );

      // assert
      expect(result).toEqual(token);
      expect(mockQueryRunner.manager.save).toHaveBeenCalled();
    });

    it('should throw on error', async () => {
      // arrange
      const userId = 'user_id';
      mockQueryRunner.manager.save.mockRejectedValue(new Error('error'));

      // act & assert
      await expect(
        service.generatePasswordResetToken(userId, mockQueryRunner as any),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('getAllUsers', () => {
    it('should return paginated users', async () => {
      // arrange
      const query: UserFilter = { page: 1, size: 10 };
      const users = [{ id: '1' }];
      const count = 1;
      mockUsersRepository.findAndCount.mockResolvedValue([users, count]);

      // act
      const result = await service.getAllUsers(query);

      // assert
      expect(mockUsersRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
          order: { created_at: 'DESC' },
          relations: ['property_tenants', 'property_tenants.property'],
        }),
      );
      expect(result).toEqual({
        users,
        pagination: {
          totalRows: count,
          perPage: 10,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      });
    });

    it('should use default pagination', async () => {
      // arrange
      const query: UserFilter = {};
      mockUsersRepository.findAndCount.mockResolvedValue([[], 0]);

      // act
      await service.getAllUsers(query);

      // assert
      expect(mockUsersRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
        }),
      );
    });

    it('should throw on error', async () => {
      // arrange
      const query: UserFilter = {};
      mockUsersRepository.findAndCount.mockRejectedValue(new Error('error'));

      // act & assert
      await expect(service.getAllUsers(query)).rejects.toThrow(HttpException);
    });
  });

  describe('getAllTenants', () => {
    it('should return paginated tenants', async () => {
      // arrange
      const query: UserFilter = { page: 1, size: 10 };
      const users = [{ id: '1' }];
      const count = 1;
      const qb = mockUsersRepository.createQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([users, count]);

      // act
      const result = await service.getAllTenants(query);

      // assert
      expect(result).toEqual({
        users,
        pagination: {
          totalRows: count,
          perPage: 10,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      });
      expect(qb.where).toHaveBeenCalledWith('user.role = :role', {
        role: 'tenant',
      });
      expect(qb.getManyAndCount).toHaveBeenCalled();
    });

    it('should throw on error', async () => {
      // arrange
      const query: UserFilter = {};
      const qb = mockUsersRepository.createQueryBuilder();
      qb.getManyAndCount.mockRejectedValue(new Error('error'));

      // act & assert
      await expect(service.getAllTenants(query)).rejects.toThrow(HttpException);
    });
  });

  describe('getUserById', () => {
    it('should return user by id', async () => {
      // arrange
      const id = 'user_id';
      const user = { id };
      mockUsersRepository.findOne.mockResolvedValue(user);

      // act
      const result = await service.getUserById(id);

      // assert
      expect(mockUsersRepository.findOne).toHaveBeenCalledWith({
        where: { id },
      });
      expect(result).toEqual(user);
    });

    it('should throw if not found', async () => {
      // arrange
      const id = 'user_id';
      mockUsersRepository.findOne.mockResolvedValue(null);

      // act & assert
      await expect(service.getUserById(id)).rejects.toThrow(
        new HttpException(
          `User with id: ${id} not found`,
          HttpStatus.NOT_FOUND,
        ),
      );
    });
  });

  describe('getAccountById', () => {
    it('should return account by id', async () => {
      // arrange
      const id = 'acc_id';
      const account = { id };
      mockAccountRepository.findOne.mockResolvedValue(account);

      // act
      const result = await service.getAccountById(id);

      // assert
      expect(mockAccountRepository.findOne).toHaveBeenCalledWith({
        where: { id },
      });
      expect(result).toEqual(account);
    });

    it('should throw if not found', async () => {
      // arrange
      const id = 'acc_id';
      mockAccountRepository.findOne.mockResolvedValue(null);

      // act & assert
      await expect(service.getAccountById(id)).rejects.toThrow(
        new HttpException(
          `User with id: ${id} not found`,
          HttpStatus.NOT_FOUND,
        ),
      );
    });
  });

  describe('getUserFields', () => {
    it('should return selected fields', async () => {
      // arrange
      const user_id = 'user_id';
      const fields = ['id', 'email'];
      const user = { id: user_id, email: 'test@example.com' };
      mockUsersRepository.findOne.mockResolvedValue(user);

      // act
      const result = await service.getUserFields(user_id, fields);

      // assert
      expect(mockUsersRepository.findOne).toHaveBeenCalledWith({
        where: { id: user_id },
        select: { id: true, email: true },
      });
      expect(result).toEqual(user);
    });

    it('should throw if no fields', async () => {
      // arrange
      const user_id = 'user_id';
      const fields = [];

      // act & assert
      await expect(service.getUserFields(user_id, fields)).rejects.toThrow(
        new HttpException(
          'Fields query parameter is required',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should throw if user not found', async () => {
      // arrange
      const user_id = 'user_id';
      const fields = ['id'];
      mockUsersRepository.findOne.mockResolvedValue(null);

      // act & assert
      await expect(service.getUserFields(user_id, fields)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('updateUserById', () => {
    it('should update user and account', async () => {
      // arrange
      const id = 'acc_id';
      const data: UpdateUserDto = { first_name: 'Updated', last_name: 'User' };
      const account = { id, userId: 'user_id' };
      mockAccountRepository.findOne.mockResolvedValue(account);
      mockAccountRepository.update.mockResolvedValue(undefined);
      mockUsersRepository.update.mockResolvedValue({ affected: 1 });

      // act
      const result = await service.updateUserById(id, data);

      // assert
      expect(mockAccountRepository.update).toHaveBeenCalledWith(id, {
        profile_name: 'Updated User',
      });
      expect(mockUsersRepository.update).toHaveBeenCalledWith('user_id', data);
      expect(result).toEqual({ affected: 1 });
    });

    it('should throw if account not found', async () => {
      // arrange
      const id = 'acc_id';
      const data: UpdateUserDto = {};
      mockAccountRepository.findOne.mockResolvedValue(null);

      // act & assert
      await expect(service.updateUserById(id, data)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteUserById', () => {
    it('should delete user', async () => {
      // arrange
      const id = 'user_id';
      mockUsersRepository.delete.mockResolvedValue({ affected: 1 });

      // act
      const result = await service.deleteUserById(id);

      // assert
      expect(mockUsersRepository.delete).toHaveBeenCalledWith(id);
      expect(result).toEqual({ affected: 1 });
    });
  });

  describe('loginUser', () => {
    it('should login admin successfully', async () => {
      // arrange
      const data: LoginDto = {
        email: 'test@example.com',
        password: 'password',
      };
      const mockRes = {} as Response;
      const account = {
        id: 'acc_id',
        user: { first_name: 'Test', last_name: 'User', phone_number: '123' },
        email: 'test@example.com',
        role: RolesEnum.ADMIN,
        password: 'hashed',
        is_verified: true,
      };
      mockAccountRepository.findOne
        .mockResolvedValueOnce(account) // admin
        .mockResolvedValueOnce(null) // landlord
        .mockResolvedValueOnce(null) // tenant
        .mockResolvedValueOnce(null); // rep
      jest.spyOn(UtilService, 'validatePassword').mockResolvedValue(true);
      mockAuthService.generateToken.mockResolvedValue('token');

      // act
      const result = await service.loginUser(data, mockRes);

      // assert
      expect(result).toMatchObject({
        user: expect.any(Object),
        access_token: 'token',
      });
      expect(mockAuthService.generateToken).toHaveBeenCalled();
    });

    it('should login with sub account', async () => {
      // arrange
      const data: LoginDto = {
        email: 'test@example.com',
        password: 'password',
      };
      const mockRes = {} as Response;
      const landlordAccount = {
        id: 'land_id',
        user: { first_name: 'Land', last_name: 'Lord', phone_number: '456' },
        email: 'test@example.com',
        role: RolesEnum.LANDLORD,
        password: 'hashed',
        is_verified: true,
      };
      const subAccount = {
        id: 'sub_id',
        user: { first_name: 'Sub', last_name: 'User', phone_number: '789' },
        role: RolesEnum.TENANT,
        property_tenants: [{ property_id: 'prop_id' }],
      };
      mockAccountRepository.findOne
        .mockResolvedValueOnce(null) // admin
        .mockResolvedValueOnce(landlordAccount) // landlord
        .mockResolvedValueOnce(null) // tenant
        .mockResolvedValueOnce(null); // rep
      jest.spyOn(UtilService, 'validatePassword').mockResolvedValue(true);
      mockAuthService.generateToken.mockResolvedValue('token');

      // act
      await service.loginUser(data, mockRes);

      // assert
      expect(mockAccountRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: expect.not.stringContaining(landlordAccount.id),
            email: data.email,
            role: RolesEnum.TENANT,
          },
        }),
      );
    });

    it('should throw if no accounts found', async () => {
      // arrange
      const data: LoginDto = {
        email: 'test@example.com',
        password: 'password',
      };
      const mockRes = {} as Response;
      mockAccountRepository.findOne.mockResolvedValue(null);

      // act & assert
      await expect(service.loginUser(data, mockRes)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw if not verified', async () => {
      // arrange
      const data: LoginDto = {
        email: 'test@example.com',
        password: 'password',
      };
      const mockRes = {} as Response;
      const account = { is_verified: false };
      mockAccountRepository.findOne.mockResolvedValue(account);

      // act & assert
      await expect(service.loginUser(data, mockRes)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw if invalid password', async () => {
      // arrange
      const data: LoginDto = {
        email: 'test@example.com',
        password: 'password',
      };
      const mockRes = {} as Response;
      const account = { password: 'hashed', is_verified: true };
      mockAccountRepository.findOne.mockResolvedValue(account);
      jest.spyOn(UtilService, 'validatePassword').mockResolvedValue(false);

      // act & assert
      await expect(service.loginUser(data, mockRes)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logoutUser', () => {
    it('should logout successfully', async () => {
      // arrange
      const mockRes = {
        clearCookie: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;
      mockConfigService.get.mockReturnValue('development');

      const clearCookieSpy = jest.spyOn(mockRes, 'clearCookie');
      const mockResStatusSpy = jest.spyOn(mockRes, 'status');

      // act
      const result = await service.logoutUser(mockRes);

      // assert
      expect(clearCookieSpy).toHaveBeenCalledWith(
        'access_token',
        expect.objectContaining({ secure: false }),
      );
      expect(mockResStatusSpy).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Logout successful',
      });
      expect(result).toEqual({ message: 'Logout successful' });
    });

    it('should use secure cookie in production', async () => {
      // arrange
      const mockRes = {
        clearCookie: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;
      mockConfigService.get.mockReturnValue('production');

      const clearCookieSpy = jest.spyOn(mockRes, 'clearCookie');

      // act
      await service.logoutUser(mockRes);

      // assert
      expect(clearCookieSpy).toHaveBeenCalledWith(
        'access_token',
        expect.objectContaining({ secure: true }),
      );
    });
  });

  describe('getTenantAndPropertyInfo', () => {
    it('should return tenant and property info', async () => {
      // arrange
      const tenant_id = 'tenant_id';
      const tenant = { id: tenant_id, role: RolesEnum.TENANT };
      mockAccountRepository.findOne.mockResolvedValue(tenant);

      // act
      const result = await service.getTenantAndPropertyInfo(tenant_id);

      // assert
      expect(mockAccountRepository.findOne).toHaveBeenCalledWith({
        where: { id: tenant_id, role: RolesEnum.TENANT },
        relations: [
          'user',
          'property_tenants',
          'property_tenants.property.rents',
        ],
      });
      expect(result).toEqual(tenant);
    });

    it('should throw if not found', async () => {
      // arrange
      const tenant_id = 'tenant_id';
      mockAccountRepository.findOne.mockResolvedValue(null);

      // act & assert
      await expect(service.getTenantAndPropertyInfo(tenant_id)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('forgotPassword', () => {
    it('should send OTP successfully', async () => {
      // arrange
      const email = 'test@example.com';
      const account = { id: 'acc_id' };
      mockAccountRepository.findOne.mockResolvedValue(account);
      mockPasswordResetRepository.save.mockResolvedValue(undefined);
      jest.spyOn(UtilService, 'generateOTP').mockReturnValue('123456');
      jest
        .spyOn(uuid, 'v4')
        .mockReturnValue('token' as unknown as ReturnType<typeof uuid.v4>);
      jest
        .spyOn(UtilService, 'sendEmail')
        .mockResolvedValue([mockClientResponse, {}]);
      // act
      const result = await service.forgotPassword(email);

      // assert
      expect(result).toEqual({ message: 'OTP sent to email', token: 'token' });
      expect(mockPasswordResetRepository.save).toHaveBeenCalled();
      expect(UtilService.sendEmail).toHaveBeenCalled();
    });

    it('should throw if user not found', async () => {
      // arrange
      const email = 'test@example.com';
      mockAccountRepository.findOne.mockResolvedValue(null);

      // act & assert
      await expect(service.forgotPassword(email)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('validateOtp', () => {
    it('should validate OTP successfully', async () => {
      // arrange
      const otp = '123456';
      const entry = {
        token: 'token',
        expires_at: new Date(Date.now() + 100000),
      };
      mockPasswordResetRepository.findOne.mockResolvedValue(entry);

      // act
      const result = await service.validateOtp(otp);

      // assert
      expect(result).toEqual({
        message: 'OTP validated successfully',
        token: 'token',
      });
    });

    it('should throw if invalid or expired', async () => {
      // arrange
      const otp = '123456';
      mockPasswordResetRepository.findOne.mockResolvedValue(null);

      // act & assert
      await expect(service.validateOtp(otp)).rejects.toThrow(HttpException);
    });

    it('should throw if expired', async () => {
      // arrange
      const otp = '123456';
      const entry = {
        token: 'token',
        expires_at: new Date(Date.now() - 100000),
      };
      mockPasswordResetRepository.findOne.mockResolvedValue(entry);

      // act & assert
      await expect(service.validateOtp(otp)).rejects.toThrow(HttpException);
    });
  });

  describe('resendOtp', () => {
    it('should resend OTP successfully', async () => {
      // arrange
      const oldToken = 'old_token';
      const resetEntry = {
        id: 'entry_id',
        user_id: 'user_id',
        expires_at: new Date(Date.now() + 100000),
      };
      const account = { email: 'test@example.com' };
      mockPasswordResetRepository.findOne.mockResolvedValue(resetEntry);
      mockAccountRepository.findOne.mockResolvedValue(account);
      mockPasswordResetRepository.delete.mockResolvedValue(undefined);
      mockPasswordResetRepository.save.mockResolvedValue(undefined);
      jest.spyOn(UtilService, 'generateOTP').mockReturnValue('new_otp');
      jest
        .spyOn(uuid, 'v4')
        .mockReturnValue('new-token' as unknown as ReturnType<typeof uuid.v4>);
      jest
        .spyOn(UtilService, 'sendEmail')
        .mockResolvedValue([mockClientResponse, {}]);
      // act
      const result = await service.resendOtp(oldToken);

      // assert
      expect(result).toEqual({
        message: 'OTP resent successfully',
        token: 'new_token',
      });
      expect(mockPasswordResetRepository.delete).toHaveBeenCalledWith({
        id: resetEntry.id,
      });
      expect(mockPasswordResetRepository.save).toHaveBeenCalled();
      expect(UtilService.sendEmail).toHaveBeenCalled();
    });

    it('should throw if invalid token', async () => {
      // arrange
      const oldToken = 'old_token';
      mockPasswordResetRepository.findOne.mockResolvedValue(null);

      // act & assert
      await expect(service.resendOtp(oldToken)).rejects.toThrow(HttpException);
    });

    it('should throw if user not found', async () => {
      // arrange
      const oldToken = 'old_token';
      const resetEntry = { user_id: 'user_id' };
      mockPasswordResetRepository.findOne.mockResolvedValue(resetEntry);
      mockAccountRepository.findOne.mockResolvedValue(null);

      // act & assert
      await expect(service.resendOtp(oldToken)).rejects.toThrow(HttpException);
    });

    it('should throw if recently sent', async () => {
      // arrange
      const oldToken = 'old_token';
      const resetEntry = {
        user_id: 'user_id',
        expires_at: new Date(Date.now() + 900000),
      }; // more than 840 seconds
      mockPasswordResetRepository.findOne.mockResolvedValue(resetEntry);

      // act & assert
      await expect(service.resendOtp(oldToken)).rejects.toThrow(HttpException);
    });
  });

  describe('resetPassword', () => {
    it('should reset password successfully', async () => {
      // arrange
      const payload: ResetPasswordDto = {
        token: 'token',
        newPassword: 'newpass',
      };
      const mockRes = {} as Response;
      const resetEntry = {
        id: 'entry_id',
        user_id: 'user_id',
        expires_at: new Date(Date.now() + 100000),
      };
      const account = {
        id: 'user_id',
        is_verified: false,
        property_tenants: [{ property_id: 'prop_id' }],
        role: RolesEnum.TENANT,
        profile_name: 'Profile',
      };
      mockPasswordResetRepository.findOne.mockResolvedValue(resetEntry);
      mockAccountRepository.findOne.mockResolvedValue(account);
      jest.spyOn(UtilService, 'hashPassword').mockResolvedValue('hashed');
      mockAccountRepository.save.mockResolvedValue(undefined);
      mockPasswordResetRepository.delete.mockResolvedValue(undefined);

      // act
      const result = await service.resetPassword(payload, mockRes);

      // assert
      expect(result).toEqual({
        message: 'Password reset successful',
        user_id: 'user_id',
      });
      expect(mockAccountRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'hashed', is_verified: true }),
      );
      expect(mockPasswordResetRepository.delete).toHaveBeenCalledWith({
        id: resetEntry.id,
      });
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'user.signup',
        expect.any(Object),
      );
    });

    it('should not emit event if already verified', async () => {
      // arrange
      const payload: ResetPasswordDto = {
        token: 'token',
        newPassword: 'newpass',
      };
      const mockRes = {} as Response;
      const resetEntry = {
        id: 'entry_id',
        user_id: 'user_id',
        expires_at: new Date(Date.now() + 100000),
      };
      const account = {
        id: 'user_id',
        is_verified: true,
        property_tenants: [],
      };
      mockPasswordResetRepository.findOne.mockResolvedValue(resetEntry);
      mockAccountRepository.findOne.mockResolvedValue(account);
      jest.spyOn(UtilService, 'hashPassword').mockResolvedValue('hashed');
      mockAccountRepository.save.mockResolvedValue(undefined);
      mockPasswordResetRepository.delete.mockResolvedValue(undefined);

      // act
      await service.resetPassword(payload, mockRes);

      // assert
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should throw if invalid token', async () => {
      // arrange
      const payload: ResetPasswordDto = {
        token: 'token',
        newPassword: 'newpass',
      };
      const mockRes = {} as Response;
      mockPasswordResetRepository.findOne.mockResolvedValue(null);

      // act & assert
      await expect(service.resetPassword(payload, mockRes)).rejects.toThrow(
        new HttpException('Invalid token', HttpStatus.BAD_REQUEST),
      );
    });

    it('should throw if expired', async () => {
      // arrange
      const payload: ResetPasswordDto = {
        token: 'token',
        newPassword: 'newpass',
      };
      const mockRes = {} as Response;
      const resetEntry = {
        id: 'entry_id',
        expires_at: new Date(Date.now() - 100000),
      };
      mockPasswordResetRepository.findOne.mockResolvedValue(resetEntry);

      // act & assert
      await expect(service.resetPassword(payload, mockRes)).rejects.toThrow(
        HttpException,
      );
      expect(mockPasswordResetRepository.delete).toHaveBeenCalled();
    });

    it('should throw if user not found', async () => {
      // arrange
      const payload: ResetPasswordDto = {
        token: 'token',
        newPassword: 'newpass',
      };
      const mockRes = {} as Response;
      const resetEntry = {
        user_id: 'user_id',
        expires_at: new Date(Date.now() + 100000),
      };
      mockPasswordResetRepository.findOne.mockResolvedValue(resetEntry);
      mockAccountRepository.findOne.mockResolvedValue(null);

      // act & assert
      await expect(service.resetPassword(payload, mockRes)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('getTenantsOfAnAdmin', () => {
    it('should return paginated tenants of admin', async () => {
      // arrange
      const creator_id = 'creator_id';
      const query: UserFilter = { page: 1, size: 10 };
      const users = [{ id: '1' }];
      const count = 1;
      const qb = mockAccountRepository.createQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([users, count]);

      // act
      const result = await service.getTenantsOfAnAdmin(creator_id, query);

      // assert
      expect(result).toEqual({
        users,
        pagination: {
          totalRows: count,
          perPage: 10,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      });
      expect(qb.where).toHaveBeenCalledWith(
        'accounts.creator_id = :creator_id',
        { creator_id },
      );
    });

    // Add tests for sorting options
  });

  describe('getSingleTenantOfAnAdmin', () => {
    it('should return single tenant', async () => {
      // arrange
      const tenant_id = 'tenant_id';
      const tenant = { id: tenant_id };
      const qb = mockAccountRepository.createQueryBuilder();
      qb.getOne.mockResolvedValue(tenant);

      // act
      const result = await service.getSingleTenantOfAnAdmin(tenant_id);

      // assert
      expect(result).toEqual(tenant);
      expect(qb.where).toHaveBeenCalledWith('accounts.id = :tenant_id', {
        tenant_id,
      });
    });

    it('should throw if not found', async () => {
      // arrange
      const tenant_id = 'tenant_id';
      const qb = mockAccountRepository.createQueryBuilder();
      qb.getOne.mockResolvedValue(null);

      // act & assert
      await expect(service.getSingleTenantOfAnAdmin(tenant_id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('uploadLogos', () => {
    it('should upload logos successfully', async () => {
      // arrange
      const userId = 'user_id';
      const files = [{ buffer: Buffer.from('file') }] as Express.Multer.File[];
      const user = { id: userId, role: RolesEnum.LANDLORD, logo_urls: [] };
      mockUsersRepository.findOne.mockResolvedValue(user);
      mockFileUploadService.uploadFile.mockResolvedValue({ secure_url: 'url' });
      mockUsersRepository.save.mockResolvedValue({
        ...user,
        logo_urls: ['url'],
      });

      // act
      const result = await service.uploadLogos(userId, files);

      // assert
      expect(result).toEqual({ ...user, logo_urls: ['url'] });
      expect(mockFileUploadService.uploadFile).toHaveBeenCalledTimes(1);
    });

    it('should throw if user not found', async () => {
      // arrange
      const userId = 'user_id';
      const files = [] as Express.Multer.File[];
      mockUsersRepository.findOne.mockResolvedValue(null);

      // act & assert
      await expect(service.uploadLogos(userId, files)).rejects.toThrow(
        HttpException,
      );
    });

    it('should throw on upload error', async () => {
      // arrange
      const userId = 'user_id';
      const files = [{ buffer: Buffer.from('file') }] as Express.Multer.File[];
      const user = { id: userId, role: RolesEnum.LANDLORD };
      mockUsersRepository.findOne.mockResolvedValue(user);
      mockFileUploadService.uploadFile.mockRejectedValue(new Error('error'));

      // act & assert
      await expect(service.uploadLogos(userId, files)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('createUserKyc', () => {
    it('should create KYC successfully', async () => {
      // arrange
      const userId = 'user_id';
      const data: CreateKycDto = {} as CreateKycDto;
      const account = { id: userId, kyc: null };
      const kyc = { id: 'kyc_id' };
      mockQueryRunner.connect.mockResolvedValue(undefined);
      mockQueryRunner.startTransaction.mockResolvedValue(undefined);
      mockQueryRunner.commitTransaction.mockResolvedValue(undefined);
      mockQueryRunner.rollbackTransaction.mockResolvedValue(undefined);
      mockQueryRunner.release.mockResolvedValue(undefined);
      mockQueryRunner.manager.findOne.mockResolvedValue(account);
      mockKycRepository.create.mockReturnValue(kyc);
      mockQueryRunner.manager.save
        .mockResolvedValueOnce(kyc)
        .mockResolvedValueOnce(account);

      // act
      const result = await service.createUserKyc(userId, data);

      // assert
      expect(result).toEqual(kyc);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should throw if user not found', async () => {
      // arrange
      const userId = 'user_id';
      const data: CreateKycDto = {} as CreateKycDto;
      mockQueryRunner.connect.mockResolvedValue(undefined);
      mockQueryRunner.startTransaction.mockResolvedValue(undefined);
      mockQueryRunner.manager.findOne.mockResolvedValue(null);

      // act & assert
      await expect(service.createUserKyc(userId, data)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should throw if KYC already submitted', async () => {
      // arrange
      const userId = 'user_id';
      const data: CreateKycDto = {} as CreateKycDto;
      const account = { kyc: {} };
      mockQueryRunner.connect.mockResolvedValue(undefined);
      mockQueryRunner.startTransaction.mockResolvedValue(undefined);
      mockQueryRunner.manager.findOne.mockResolvedValue(account);

      // act & assert
      await expect(service.createUserKyc(userId, data)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('update (KYC)', () => {
    it('should update KYC', async () => {
      // arrange
      const userId = 'user_id';
      const data: UpdateKycDto = {} as UpdateKycDto;
      const user = { id: userId, kyc: { id: 'kyc_id' } };
      const updatedKyc = { id: 'kyc_id', updated: true };
      mockUsersRepository.findOne.mockResolvedValue(user);
      mockKycRepository.merge.mockReturnValue(updatedKyc);
      mockKycRepository.save.mockResolvedValue(updatedKyc);

      // act
      const result = await service.update(userId, data);

      // assert
      expect(result).toEqual(updatedKyc);
      expect(mockUsersRepository.findOne).toHaveBeenCalledWith({
        where: { id: userId },
        relations: ['kyc'],
      });
    });

    it('should throw if KYC not found', async () => {
      // arrange
      const userId = 'user_id';
      const data: UpdateKycDto = {} as UpdateKycDto;
      mockUsersRepository.findOne.mockResolvedValue({ kyc: null });

      // act & assert
      await expect(service.update(userId, data)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createAdmin', () => {
    it('should create admin successfully', async () => {
      // arrange
      const data: CreateAdminDto = {
        email: 'admin@example.com',
        password: 'pass',
        phone_number: '123',
        first_name: 'Admin',
        last_name: 'User',
      } as CreateAdminDto;
      const user = {
        id: 'user_id',
        password: 'hashed',
        email: data.email,
        role: RolesEnum.ADMIN,
      };
      mockAccountRepository.findOne.mockResolvedValue(null);
      mockUsersRepository.findOne.mockResolvedValue(null);
      mockUsersRepository.save.mockResolvedValue(user);
      const adminAccount = { profile_name: "Admin's Admin Account" };
      mockAccountRepository.create.mockReturnValue(adminAccount);
      mockAccountRepository.save.mockResolvedValue(undefined);
      jest.spyOn(UtilService, 'hashPassword').mockResolvedValue('hashed');

      // act
      const result = await service.createAdmin(data);

      // assert
      expect(result).toEqual({
        id: 'user_id',
        email: data.email,
        role: RolesEnum.ADMIN,
      });
      expect(mockAccountRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ role: RolesEnum.ADMIN }),
      );
    });

    it('should use existing user if phone exists', async () => {
      // arrange
      const data: CreateAdminDto = {
        email: 'admin@example.com',
        password: 'pass',
        phone_number: '123',
        first_name: 'Admin',
        last_name: 'User',
      } as CreateAdminDto;
      const existingUser = { id: 'user_id' };
      mockAccountRepository.findOne.mockResolvedValue(null);
      mockUsersRepository.findOne.mockResolvedValue(existingUser);
      mockAccountRepository.create.mockReturnValue({});
      mockAccountRepository.save.mockResolvedValue(undefined);
      jest.spyOn(UtilService, 'hashPassword').mockResolvedValue('hashed');

      // act
      await service.createAdmin(data);

      // assert
      expect(mockUsersRepository.save).not.toHaveBeenCalled();
      expect(mockAccountRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ user: existingUser }),
      );
    });

    it('should throw if existing account', async () => {
      // arrange
      const data: CreateAdminDto = {
        email: 'admin@example.com',
        password: 'pass',
      } as CreateAdminDto;
      mockAccountRepository.findOne.mockResolvedValue({});

      // act & assert
      await expect(service.createAdmin(data)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw if no password', async () => {
      // arrange
      const data: CreateAdminDto = {
        email: 'admin@example.com',
      } as CreateAdminDto;
      mockAccountRepository.findOne.mockResolvedValue(null);

      // act & assert
      await expect(service.createAdmin(data)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('createLandlord', () => {
    it('should create landlord successfully', async () => {
      // arrange
      const data: CreateLandlordDto = {
        email: 'landlord@example.com',
        password: 'pass',
        phone_number: '123',
        first_name: 'Land',
        last_name: 'Lord',
        agency_name: 'Agency',
      } as CreateLandlordDto;
      const user = {
        id: 'user_id',
        password: 'hashed',
        email: data.email,
        role: RolesEnum.LANDLORD,
      };
      mockAccountRepository.findOne.mockResolvedValue(null);
      mockUsersRepository.findOne.mockResolvedValue(null);
      mockUsersRepository.save.mockResolvedValue(user);
      const landlordAccount = { profile_name: 'Agency' };
      mockAccountRepository.create.mockReturnValue(landlordAccount);
      mockAccountRepository.save.mockResolvedValue(undefined);
      jest.spyOn(UtilService, 'hashPassword').mockResolvedValue('hashed');

      // act
      const result = await service.createLandlord(data);

      // assert
      expect(result).toEqual({
        id: 'user_id',
        email: data.email,
        role: RolesEnum.LANDLORD,
      });
      expect(mockAccountRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          role: RolesEnum.LANDLORD,
          profile_name: 'Agency',
        }),
      );
    });

    // Similar error tests as createAdmin
  });

  describe('createCustomerRep', () => {
    it('should create customer rep successfully', async () => {
      // arrange
      const data: CreateCustomerRepDto = {
        email: 'rep@example.com',
        password: 'pass',
        phone_number: '123',
        first_name: 'Rep',
        last_name: 'User',
      } as CreateCustomerRepDto;
      const user = { id: 'user_id', password: 'hashed' };
      mockQueryRunner.connect.mockResolvedValue(undefined);
      mockQueryRunner.startTransaction.mockResolvedValue(undefined);
      mockQueryRunner.commitTransaction.mockResolvedValue(undefined);
      mockQueryRunner.rollbackTransaction.mockResolvedValue(undefined);
      mockQueryRunner.release.mockResolvedValue(undefined);
      mockQueryRunner.manager.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockQueryRunner.manager.save
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce({});
      jest
        .spyOn(service as any, 'generatePasswordResetToken')
        .mockResolvedValue('token');
      jest.spyOn(UtilService, 'hashPassword').mockResolvedValue('hashed');
      jest
        .spyOn(UtilService, 'sendEmail')
        .mockResolvedValue([mockClientResponse, {}]);
      mockConfigService.get.mockReturnValue('http://frontend');

      // act
      const result = await service.createCustomerRep(data);

      // assert
      expect(result).toEqual({ id: 'user_id' });
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(UtilService.sendEmail).toHaveBeenCalled();
    });

    it('should throw if existing account', async () => {
      // arrange
      const data: CreateCustomerRepDto = {
        email: 'rep@example.com',
      } as CreateCustomerRepDto;
      mockQueryRunner.connect.mockResolvedValue(undefined);
      mockQueryRunner.startTransaction.mockResolvedValue(undefined);
      mockQueryRunner.manager.findOne.mockResolvedValueOnce({});

      // act & assert
      await expect(service.createCustomerRep(data)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('getSubAccounts', () => {
    it('should return sub accounts', async () => {
      // arrange
      const adminId = 'admin_id';
      const subAccounts = [{ id: 'sub_id' }];
      mockAccountRepository.find.mockResolvedValue(subAccounts);

      // act
      const result = await service.getSubAccounts(adminId);

      // assert
      expect(result).toEqual(subAccounts);
      expect(mockAccountRepository.find).toHaveBeenCalledWith({
        where: { creator_id: adminId },
        relations: ['user'],
      });
    });
  });

  describe('switchAccount', () => {
    it('should switch account successfully', async () => {
      // arrange
      const res = {
        cookie: jest.fn().mockImplementation(function (name, val, options) {
          return this; // mimic Express behavior (chainable)
        }),
      } as unknown as Response;
      const params = {
        targetAccountId: 'target_id',
        currentAccount: { id: 'current_id' },
        res,
      };
      const target = {
        id: 'target_id',
        creator_id: 'current_id',
        user: { first_name: 'Target', last_name: 'User', phone_number: '123' },
        email: 'target@example.com',
        role: RolesEnum.TENANT,
      };
      mockAccountRepository.findOne.mockResolvedValue(target);
      mockAuthService.generateToken.mockResolvedValue('new_token');
      jest.mock('moment', () => {
        return () => ({
          add: jest.fn().mockReturnThis(),
          toDate: jest.fn().mockReturnValue(new Date()),
        });
      });
      mockConfigService.get.mockReturnValue('development');
      const cookieSpy = jest.spyOn(params.res, 'cookie');

      // act
      const result = await service.switchAccount(params);

      // assert
      expect(result).toEqual({
        success: true,
        message: 'Switched account successfully',
      });
      expect(cookieSpy).toHaveBeenCalledWith(
        'access_token',
        'new_token',
        expect.any(Object),
      );
      expect(mockAuthService.generateToken).toHaveBeenCalled();
    });

    it('should throw if not authorized', async () => {
      // arrange
      const params = {
        targetAccountId: 'target_id',
        currentAccount: { id: 'current_id' },
        res: {} as Response,
      };
      mockAccountRepository.findOne.mockResolvedValue(null);

      // act & assert
      await expect(service.switchAccount(params)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('assignCollaboratorToTeam', () => {
    it('should assign collaborator successfully', async () => {
      // arrange
      const user_id = 'user_id';
      const team_member = {
        email: 'collab@example.com',
        permissions: ['read'],
        role: RolesEnum.REP,
        first_name: 'Collab',
        last_name: 'User',
        phone_number: '1234567890',
      };
      const teamAdminAccount = { id: user_id, profile_name: 'Team Admin' };
      const team = { id: 'team_id', creatorId: user_id };
      const user = { id: 'user_id' };
      const userAccount = { id: 'acc_id' };
      const newTeamMember = { id: 'member_id' };
      const mockManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === Team)
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockReturnValue(team),
              save: jest.fn(),
            };
          if (entity === Account)
            return {
              findOne: jest.fn().mockResolvedValue(teamAdminAccount),
              create: jest.fn().mockReturnValue(userAccount),
              save: jest.fn(),
            };
          if (entity === Users)
            return {
              findOne: jest.fn().mockResolvedValue(null),
              save: jest.fn().mockResolvedValue(user),
            };
          if (entity === TeamMember)
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockReturnValue(newTeamMember),
              save: jest.fn(),
            };
          return {};
        }),
      };
      mockDataSource.transaction.mockImplementation(async (cb) =>
        cb(mockManager),
      );
      jest.spyOn(UtilService, 'generatePassword').mockResolvedValue('password');
      mockWhatsappBotService.sendToFacilityManagerWithTemplate.mockResolvedValue(
        undefined,
      );

      // act
      const result = await service.assignCollaboratorToTeam(
        user_id,
        team_member,
      );

      // assert
      expect(result).toEqual(newTeamMember);
      expect(
        mockWhatsappBotService.sendToFacilityManagerWithTemplate,
      ).toHaveBeenCalled();
    });

    it('should use existing team if exists', async () => {
      // arrange
      const user_id = 'user_id';
      const team_member = {
        email: 'collab@example.com',
        permissions: [],
        role: RolesEnum.REP,
        first_name: 'Collab',
        last_name: 'User',
        phone_number: '123',
      };
      const team = { id: 'team_id', creatorId: user_id };
      const mockManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === Team)
            return { findOne: jest.fn().mockResolvedValue(team) };
          if (entity === TeamMember)
            return { findOne: jest.fn().mockResolvedValue(null) };
          if (entity === Users)
            return {
              findOne: jest.fn().mockResolvedValue(null),
              save: jest.fn(),
            };
          if (entity === Account)
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn(),
              save: jest.fn(),
            };
          return {};
        }),
      };
      mockDataSource.transaction.mockImplementation(async (cb) =>
        cb(mockManager),
      );

      // act
      await service.assignCollaboratorToTeam(user_id, team_member);

      // assert
      expect(mockManager.getRepository(Team).create).not.toHaveBeenCalled();
    });

    it('should throw if not authorized', async () => {
      // arrange
      const user_id = 'user_id';
      const team_member = {
        email: 'collab@example.com',
        permissions: [],
        role: RolesEnum.REP,
        first_name: 'Collab',
        last_name: 'User',
        phone_number: '123',
      };
      const team = { creatorId: 'other_id' };
      const mockManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === Team)
            return { findOne: jest.fn().mockResolvedValue(team) };
          return {};
        }),
      };
      mockDataSource.transaction.mockImplementation(async (cb) =>
        cb(mockManager),
      );

      // act & assert
      await expect(
        service.assignCollaboratorToTeam(user_id, team_member),
      ).rejects.toThrow(HttpException);
    });

    it('should throw if already member', async () => {
      // arrange
      const user_id = 'user_id';
      const team_member = {
        email: 'collab@example.com',
        permissions: [],
        role: RolesEnum.REP,
        first_name: 'Collab',
        last_name: 'User',
        phone_number: '123',
      };
      const team = { id: 'team_id', creatorId: user_id };
      const mockManager = {
        getRepository: jest.fn().mockImplementation((entity) => {
          if (entity === Team)
            return { findOne: jest.fn().mockResolvedValue(team) };
          if (entity === TeamMember)
            return { findOne: jest.fn().mockResolvedValue({}) };
          return {};
        }),
      };
      mockDataSource.transaction.mockImplementation(async (cb) =>
        cb(mockManager),
      );

      // act & assert
      await expect(
        service.assignCollaboratorToTeam(user_id, team_member),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('getTeamMembers', () => {
    it('should return team members', async () => {
      // arrange
      const user_id = 'user_id';
      const team = { id: 'team_id', creatorId: user_id };
      const members = [{ id: 'member_id' }];
      mockTeamRepository.findOne.mockResolvedValue(team);
      mockTeamMemberRepository.find.mockResolvedValue(members);

      // act
      const result = await service.getTeamMembers(user_id);

      // assert
      expect(result).toEqual(members);
      expect(mockTeamMemberRepository.find).toHaveBeenCalledWith({
        where: { teamId: team.id },
        relations: ['account', 'account.user'],
      });
    });

    it('should throw if team not found', async () => {
      // arrange
      const user_id = 'user_id';
      mockTeamRepository.findOne.mockResolvedValue(null);

      // act & assert
      await expect(service.getTeamMembers(user_id)).rejects.toThrow(
        HttpException,
      );
    });

    it('should throw if not authorized', async () => {
      // arrange
      const user_id = 'user_id';
      const team = { creatorId: 'other_id' };
      mockTeamRepository.findOne.mockResolvedValue(team);

      // act & assert
      await expect(service.getTeamMembers(user_id)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('getWhatsappText', () => {
    it('should send text via whatsapp', async () => {
      // arrange
      const from = 'from';
      const message = 'message';
      const response = 'sent';
      mockWhatsappBotService.sendText.mockResolvedValue(response);

      // act
      const result = await service.getWhatsappText(from, message);

      // assert
      expect(result).toEqual(response);
      expect(mockWhatsappBotService.sendText).toHaveBeenCalledWith(
        from,
        message,
      );
    });
  });

  describe('sendPropertiesNotification', () => {
    it('should send properties notification', async () => {
      // arrange
      const params = {
        phone_number: '123',
        name: 'Name',
        property_name: 'Prop',
      };
      const response = 'sent';
      mockWhatsappBotService.sendToPropertiesCreatedTemplate.mockResolvedValue(
        response,
      );

      // act
      const result = await service.sendPropertiesNotification(params);

      // assert
      expect(result).toEqual(response);
      expect(
        mockWhatsappBotService.sendToPropertiesCreatedTemplate,
      ).toHaveBeenCalledWith(params);
    });
  });

  describe('sendUserAddedTemplate', () => {
    it('should send user added template', async () => {
      // arrange
      const params = {
        phone_number: '123',
        name: 'Name',
        user: 'User',
        property_name: 'Prop',
      };
      const response = 'sent';
      mockWhatsappBotService.sendUserAddedTemplate.mockResolvedValue(response);

      // act
      const result = await service.sendUserAddedTemplate(params);

      // assert
      expect(result).toEqual(response);
      expect(mockWhatsappBotService.sendUserAddedTemplate).toHaveBeenCalledWith(
        params,
      );
    });
  });

  describe('getWaitlist', () => {
    it('should return waitlist', async () => {
      // arrange
      const waitlist = [{ id: '1' }];
      mockWaitlistRepository.find.mockResolvedValue(waitlist);

      // act
      const result = await service.getWaitlist();

      // assert
      expect(result).toEqual(waitlist);
      expect(mockWaitlistRepository.find).toHaveBeenCalled();
    });

    it('should throw on error', async () => {
      // arrange
      mockWaitlistRepository.find.mockRejectedValue(new Error('error'));

      // act & assert
      await expect(service.getWaitlist()).rejects.toThrow(HttpException);
    });
  });

  describe('getLandlords', () => {
    it('should return landlords', async () => {
      // arrange
      const landlords = [{ id: '1', role: RolesEnum.LANDLORD }];
      mockUsersRepository.find.mockResolvedValue(landlords);

      // act
      const result = await service.getLandlords();

      // assert
      expect(result).toEqual(landlords);
      expect(mockUsersRepository.find).toHaveBeenCalledWith({
        where: { role: RolesEnum.LANDLORD },
      });
    });

    it('should throw on error', async () => {
      // arrange
      mockUsersRepository.find.mockRejectedValue(new Error('error'));

      // act & assert
      await expect(service.getLandlords()).rejects.toThrow(HttpException);
    });
  });
});

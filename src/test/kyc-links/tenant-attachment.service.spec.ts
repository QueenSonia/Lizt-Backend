import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { TenantAttachmentService } from '../../kyc-links/tenant-attachment.service';
import {
  KYCApplication,
  ApplicationStatus,
} from '../../kyc-links/entities/kyc-application.entity';
import { KYCLink } from '../../kyc-links/entities/kyc-link.entity';
import { Property } from '../../properties/entities/property.entity';
import { PropertyTenant } from '../../properties/entities/property-tenants.entity';
import { PropertyHistory } from '../../property-history/entities/property-history.entity';
import { Rent } from '../../rents/entities/rent.entity';
import { Account } from '../../users/entities/account.entity';
import { Users } from '../../users/entities/user.entity';
import {
  AttachTenantDto,
  RentFrequency,
} from '../../kyc-links/dto/attach-tenant.dto';
import {
  PropertyStatusEnum,
  TenantStatusEnum,
} from '../../properties/dto/create-property.dto';
import {
  RentStatusEnum,
  RentPaymentStatusEnum,
} from '../../rents/dto/create-rent.dto';
import {
  Gender,
  MaritalStatus,
  EmploymentStatus,
} from '../../tenant-kyc/entities/tenant-kyc.entity';
import { RolesEnum } from '../../base.entity';

describe('TenantAttachmentService', () => {
  let service: TenantAttachmentService;
  let dataSource: DataSource;

  const mockKycApplicationRepository = {
    findOne: jest.fn(),
  };

  const mockKycLinkRepository = {
    findOne: jest.fn(),
  };

  const mockPropertyRepository = {
    findOne: jest.fn(),
  };

  const mockPropertyTenantRepository = {
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockPropertyHistoryRepository = {
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockRentRepository = {
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockAccountRepository = {
    findOne: jest.fn(),
  };

  const mockUsersRepository = {
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    },
  };

  const mockQueryBuilder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn(),
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantAttachmentService,
        {
          provide: getRepositoryToken(KYCApplication),
          useValue: mockKycApplicationRepository,
        },
        {
          provide: getRepositoryToken(KYCLink),
          useValue: mockKycLinkRepository,
        },
        {
          provide: getRepositoryToken(Property),
          useValue: mockPropertyRepository,
        },
        {
          provide: getRepositoryToken(PropertyTenant),
          useValue: mockPropertyTenantRepository,
        },
        {
          provide: getRepositoryToken(PropertyHistory),
          useValue: mockPropertyHistoryRepository,
        },
        {
          provide: getRepositoryToken(Rent),
          useValue: mockRentRepository,
        },
        {
          provide: getRepositoryToken(Account),
          useValue: mockAccountRepository,
        },
        {
          provide: getRepositoryToken(Users),
          useValue: mockUsersRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<TenantAttachmentService>(TenantAttachmentService);
    dataSource = module.get<DataSource>(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('attachTenantToProperty', () => {
    const applicationId = 'app-123';
    const landlordId = 'landlord-123';
    const propertyId = 'property-123';
    const tenantId = 'tenant-123';

    const mockTenancyDetails: AttachTenantDto = {
      rentAmount: 500000,
      rentDueDate: 15,
      rentFrequency: RentFrequency.MONTHLY,
      tenancyStartDate: '2025-12-01', // Future date
      securityDeposit: 100000,
      serviceCharge: 50000,
    };

    const mockApplication = {
      id: applicationId,
      property_id: propertyId,
      status: ApplicationStatus.PENDING,
      first_name: 'John',
      last_name: 'Doe',
      email: 'john.doe@example.com',
      phone_number: '+2348012345678',
      date_of_birth: new Date('1990-01-01'),
      gender: Gender.MALE,
      nationality: 'Nigerian',
      state_of_origin: 'Lagos',
      marital_status: MaritalStatus.SINGLE,
      property: {
        id: propertyId,
        owner_id: landlordId,
        property_status: PropertyStatusEnum.VACANT,
      },
      kyc_link: {
        id: 'kyc-link-123',
        token: 'valid-token',
      },
    };

    const mockTenantAccount = {
      id: tenantId,
      email: 'john.doe@example.com',
      role: RolesEnum.TENANT,
      user: {
        id: 'user-123',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john.doe@example.com',
      },
    };

    beforeEach(() => {
      mockQueryRunner.manager.createQueryBuilder.mockReturnValue(
        mockQueryBuilder,
      );
    });

    it('should successfully attach tenant to property', async () => {
      // Arrange
      mockQueryRunner.manager.findOne
        .mockResolvedValueOnce(mockApplication) // Application lookup
        .mockResolvedValueOnce(mockTenantAccount); // Tenant account lookup

      const mockRent = { id: 'rent-123', ...mockTenancyDetails };
      const mockPropertyTenant = {
        id: 'pt-123',
        property_id: propertyId,
        tenant_id: tenantId,
      };
      const mockPropertyHistory = {
        id: 'ph-123',
        property_id: propertyId,
        tenant_id: tenantId,
      };

      mockQueryRunner.manager.create
        .mockReturnValueOnce(mockRent)
        .mockReturnValueOnce(mockPropertyTenant)
        .mockReturnValueOnce(mockPropertyHistory);

      mockQueryRunner.manager.save
        .mockResolvedValueOnce(mockRent)
        .mockResolvedValueOnce(mockPropertyTenant)
        .mockResolvedValueOnce(mockPropertyHistory);

      // Act
      const result = await service.attachTenantToProperty(
        applicationId,
        mockTenancyDetails,
        landlordId,
      );

      // Assert
      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();

      expect(result).toEqual({
        success: true,
        tenantId: mockTenantAccount.id,
        propertyId: propertyId,
        message: 'Tenant successfully attached to property',
      });

      // Verify rent creation
      expect(mockQueryRunner.manager.create).toHaveBeenCalledWith(
        Rent,
        expect.objectContaining({
          tenant_id: tenantId,
          property_id: propertyId,
          rental_price: mockTenancyDetails.rentAmount,
          security_deposit: mockTenancyDetails.securityDeposit,
          service_charge: mockTenancyDetails.serviceCharge,
          payment_frequency: 'Monthly',
          rent_status: RentStatusEnum.ACTIVE,
          payment_status: RentPaymentStatusEnum.PENDING,
        }),
      );

      // Verify property-tenant relationship creation
      expect(mockQueryRunner.manager.create).toHaveBeenCalledWith(
        PropertyTenant,
        {
          property_id: propertyId,
          tenant_id: tenantId,
          status: TenantStatusEnum.ACTIVE,
        },
      );

      // Verify property status update
      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
        Property,
        propertyId,
        {
          property_status: PropertyStatusEnum.OCCUPIED,
        },
      );

      // Verify application status update
      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
        KYCApplication,
        applicationId,
        {
          status: ApplicationStatus.APPROVED,
          tenant_id: tenantId,
        },
      );
    });

    it('should throw NotFoundException when application does not exist', async () => {
      // Arrange
      mockQueryRunner.manager.findOne.mockResolvedValueOnce(null); // Application not found

      // Act & Assert
      await expect(
        service.attachTenantToProperty(
          applicationId,
          mockTenancyDetails,
          landlordId,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when landlord does not own property', async () => {
      // Arrange
      const unauthorizedApplication = {
        ...mockApplication,
        property: {
          ...mockApplication.property,
          owner_id: 'different-landlord',
        },
      };
      mockQueryRunner.manager.findOne.mockResolvedValueOnce(
        unauthorizedApplication,
      );

      // Act & Assert
      await expect(
        service.attachTenantToProperty(
          applicationId,
          mockTenancyDetails,
          landlordId,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException when application is not pending', async () => {
      // Arrange
      const approvedApplication = {
        ...mockApplication,
        status: ApplicationStatus.APPROVED,
        property: {
          ...mockApplication.property,
          owner_id: landlordId, // Ensure ownership is correct
        },
      };
      mockQueryRunner.manager.findOne.mockResolvedValueOnce(
        approvedApplication,
      );

      // Act & Assert
      await expect(
        service.attachTenantToProperty(
          applicationId,
          mockTenancyDetails,
          landlordId,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should throw ConflictException when property is already occupied', async () => {
      // Arrange
      const occupiedPropertyApplication = {
        ...mockApplication,
        status: ApplicationStatus.PENDING, // Ensure status is correct
        property: {
          ...mockApplication.property,
          owner_id: landlordId, // Ensure ownership is correct
          property_status: PropertyStatusEnum.OCCUPIED,
        },
      };
      mockQueryRunner.manager.findOne.mockResolvedValueOnce(
        occupiedPropertyApplication,
      );

      // Act & Assert
      await expect(
        service.attachTenantToProperty(
          applicationId,
          mockTenancyDetails,
          landlordId,
        ),
      ).rejects.toThrow(ConflictException);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid rent amount', async () => {
      // Arrange
      const invalidTenancyDetails = {
        ...mockTenancyDetails,
        rentAmount: 0,
      };

      const validApplication = {
        ...mockApplication,
        status: ApplicationStatus.PENDING,
        property: {
          ...mockApplication.property,
          owner_id: landlordId,
          property_status: PropertyStatusEnum.VACANT,
        },
      };
      mockQueryRunner.manager.findOne.mockResolvedValueOnce(validApplication);

      // Act & Assert
      await expect(
        service.attachTenantToProperty(
          applicationId,
          invalidTenancyDetails,
          landlordId,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid rent due date', async () => {
      // Arrange
      const invalidTenancyDetails = {
        ...mockTenancyDetails,
        rentDueDate: 35, // Invalid: greater than 31
      };

      const validApplication = {
        ...mockApplication,
        status: ApplicationStatus.PENDING,
        property: {
          ...mockApplication.property,
          owner_id: landlordId,
          property_status: PropertyStatusEnum.VACANT,
        },
      };
      mockQueryRunner.manager.findOne.mockResolvedValueOnce(validApplication);

      // Act & Assert
      await expect(
        service.attachTenantToProperty(
          applicationId,
          invalidTenancyDetails,
          landlordId,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException for past tenancy start date', async () => {
      // Arrange
      const invalidTenancyDetails = {
        ...mockTenancyDetails,
        tenancyStartDate: '2020-01-01', // Past date
      };

      const validApplication = {
        ...mockApplication,
        status: ApplicationStatus.PENDING,
        property: {
          ...mockApplication.property,
          owner_id: landlordId,
          property_status: PropertyStatusEnum.VACANT,
        },
      };
      mockQueryRunner.manager.findOne.mockResolvedValueOnce(validApplication);

      // Act & Assert
      await expect(
        service.attachTenantToProperty(
          applicationId,
          invalidTenancyDetails,
          landlordId,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should create new tenant account when account does not exist', async () => {
      // Arrange
      mockQueryRunner.manager.findOne
        .mockResolvedValueOnce(mockApplication) // Application lookup
        .mockResolvedValueOnce(null); // No existing account

      const mockNewUser = {
        id: 'new-user-123',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john.doe@example.com',
      };

      const mockNewAccount = {
        id: 'new-account-123',
        email: 'john.doe@example.com',
        userId: mockNewUser.id,
        role: RolesEnum.TENANT,
        user: mockNewUser,
      };

      mockQueryRunner.manager.create
        .mockReturnValueOnce(mockNewUser) // User creation
        .mockReturnValueOnce(mockNewAccount) // Account creation
        .mockReturnValueOnce({ id: 'rent-123' }) // Rent creation
        .mockReturnValueOnce({ id: 'pt-123' }) // PropertyTenant creation
        .mockReturnValueOnce({ id: 'ph-123' }); // PropertyHistory creation

      mockQueryRunner.manager.save
        .mockResolvedValueOnce(mockNewUser) // User save
        .mockResolvedValueOnce(mockNewAccount) // Account save
        .mockResolvedValueOnce({ id: 'rent-123' }) // Rent save
        .mockResolvedValueOnce({ id: 'pt-123' }) // PropertyTenant save
        .mockResolvedValueOnce({ id: 'ph-123' }); // PropertyHistory save

      // Act
      const result = await service.attachTenantToProperty(
        applicationId,
        mockTenancyDetails,
        landlordId,
      );

      // Assert
      expect(mockQueryRunner.manager.create).toHaveBeenCalledWith(
        Users,
        expect.objectContaining({
          first_name: mockApplication.first_name,
          last_name: mockApplication.last_name,
          email: mockApplication.email,
          phone_number: mockApplication.phone_number,
          date_of_birth: mockApplication.date_of_birth,
          gender: mockApplication.gender,
          nationality: mockApplication.nationality,
          state_of_origin: mockApplication.state_of_origin,
          marital_status: mockApplication.marital_status,
          role: RolesEnum.TENANT,
          is_verified: false,
        }),
      );

      expect(mockQueryRunner.manager.create).toHaveBeenCalledWith(
        Account,
        expect.objectContaining({
          email: mockApplication.email,
          userId: mockNewUser.id,
          role: RolesEnum.TENANT,
          is_verified: false,
          password: null,
        }),
      );

      expect(result.success).toBe(true);
      expect(result.tenantId).toBe(mockNewAccount.id);
    });

    it('should reject other applications and deactivate KYC links', async () => {
      // Arrange
      mockQueryRunner.manager.findOne
        .mockResolvedValueOnce(mockApplication)
        .mockResolvedValueOnce(mockTenantAccount);

      mockQueryRunner.manager.create
        .mockReturnValueOnce({ id: 'rent-123' })
        .mockReturnValueOnce({ id: 'pt-123' })
        .mockReturnValueOnce({ id: 'ph-123' });

      mockQueryRunner.manager.save
        .mockResolvedValueOnce({ id: 'rent-123' })
        .mockResolvedValueOnce({ id: 'pt-123' })
        .mockResolvedValueOnce({ id: 'ph-123' });

      // Act
      await service.attachTenantToProperty(
        applicationId,
        mockTenancyDetails,
        landlordId,
      );

      // Assert
      // Verify rejection of other applications
      expect(mockQueryRunner.manager.createQueryBuilder).toHaveBeenCalledTimes(
        2,
      );
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(KYCApplication);
      expect(mockQueryBuilder.set).toHaveBeenCalledWith({
        status: ApplicationStatus.REJECTED,
      });
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'property_id = :propertyId',
        { propertyId },
      );

      // Verify KYC link deactivation
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(KYCLink);
      expect(mockQueryBuilder.set).toHaveBeenCalledWith({ is_active: false });
    });

    it('should handle different rent frequencies correctly', async () => {
      // Arrange
      const quarterlyTenancyDetails = {
        ...mockTenancyDetails,
        rentFrequency: RentFrequency.QUARTERLY,
      };

      mockQueryRunner.manager.findOne
        .mockResolvedValueOnce(mockApplication)
        .mockResolvedValueOnce(mockTenantAccount);

      mockQueryRunner.manager.create
        .mockReturnValueOnce({ id: 'rent-123' })
        .mockReturnValueOnce({ id: 'pt-123' })
        .mockReturnValueOnce({ id: 'ph-123' });

      mockQueryRunner.manager.save
        .mockResolvedValueOnce({ id: 'rent-123' })
        .mockResolvedValueOnce({ id: 'pt-123' })
        .mockResolvedValueOnce({ id: 'ph-123' });

      // Act
      await service.attachTenantToProperty(
        applicationId,
        quarterlyTenancyDetails,
        landlordId,
      );

      // Assert
      expect(mockQueryRunner.manager.create).toHaveBeenCalledWith(
        Rent,
        expect.objectContaining({
          payment_frequency: 'Quarterly',
        }),
      );
    });
  });
});

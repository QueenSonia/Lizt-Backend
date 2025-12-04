import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { KYCApplicationService } from '../../kyc-links/kyc-application.service';
import {
  KYCApplication,
  ApplicationStatus,
} from '../../kyc-links/entities/kyc-application.entity';
import { KYCLink } from '../../kyc-links/entities/kyc-link.entity';
import { Property } from '../../properties/entities/property.entity';
import { PropertyTenant } from '../../properties/entities/property-tenants.entity';
import { CreateKYCApplicationDto } from '../../kyc-links/dto/create-kyc-application.dto';
import {
  PropertyStatusEnum,
  TenantStatusEnum,
} from '../../properties/dto/create-property.dto';
import {
  Gender,
  MaritalStatus,
  EmploymentStatus,
} from '../../tenant-kyc/entities/tenant-kyc.entity';

describe('KYCApplicationService', () => {
  let service: KYCApplicationService;
  let kycApplicationRepository: Repository<KYCApplication>;
  let kycLinkRepository: Repository<KYCLink>;
  let propertyRepository: Repository<Property>;
  let propertyTenantRepository: Repository<PropertyTenant>;

  const mockKycApplicationRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockKycLinkRepository = {
    findOne: jest.fn(),
    update: jest.fn(),
  };

  const mockPropertyRepository = {
    findOne: jest.fn(),
  };

  const mockPropertyTenantRepository = {
    findOne: jest.fn(),
  };

  const mockQueryBuilder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KYCApplicationService,
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
      ],
    }).compile();

    service = module.get<KYCApplicationService>(KYCApplicationService);
    kycApplicationRepository = module.get<Repository<KYCApplication>>(
      getRepositoryToken(KYCApplication),
    );
    kycLinkRepository = module.get<Repository<KYCLink>>(
      getRepositoryToken(KYCLink),
    );
    propertyRepository = module.get<Repository<Property>>(
      getRepositoryToken(Property),
    );
    propertyTenantRepository = module.get<Repository<PropertyTenant>>(
      getRepositoryToken(PropertyTenant),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('submitKYCApplication', () => {
    const token = 'valid-token';
    const mockKycData: CreateKYCApplicationDto = {
      property_id: 'property-123', // Add property selection
      first_name: 'John',
      last_name: 'Doe',
      email: 'john.doe@example.com',
      phone_number: '+2348012345678',
      date_of_birth: '1990-01-01',
      gender: Gender.MALE,
      nationality: 'Nigerian',
      state_of_origin: 'Lagos',
      marital_status: MaritalStatus.SINGLE,
      employment_status: EmploymentStatus.EMPLOYED,
      occupation: 'Software Engineer',
      job_title: 'Senior Developer',
      employer_name: 'Tech Company',
      employer_address: '123 Tech Street',
      monthly_net_income: '500000',
      reference1_name: 'Jane Smith',
      reference1_address: '456 Reference Ave',
      reference1_relationship: 'Friend',
      reference1_phone_number: '+2348087654321',
      reference2_name: 'Bob Johnson',
      reference2_address: '789 Reference Blvd',
      reference2_relationship: 'Colleague',
      reference2_phone_number: '+2348098765432',
      passport_photo_url: 'https://cloudinary.com/passport.jpg',
      id_document_url: 'https://cloudinary.com/id.jpg',
      employment_proof_url: 'https://cloudinary.com/employment.jpg',
    };

    const mockKycLink = {
      id: 'kyc-link-123',
      token,
      landlord_id: 'landlord-123',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      is_active: true,
    };

    it('should submit KYC application successfully', async () => {
      // Arrange
      mockKycLinkRepository.findOne.mockResolvedValue(mockKycLink);
      mockPropertyRepository.findOne.mockResolvedValue({
        id: 'property-123',
        property_status: PropertyStatusEnum.VACANT,
        owner_id: 'landlord-123',
      });
      mockKycApplicationRepository.findOne
        .mockResolvedValueOnce(null) // No existing application
        .mockResolvedValueOnce({
          // Return saved application with relations
          id: 'application-123',
          status: ApplicationStatus.PENDING,
          ...mockKycData,
          property: {
            id: 'property-123',
            property_status: PropertyStatusEnum.VACANT,
          },
          kyc_link: mockKycLink,
        });

      const mockCreatedApplication = {
        id: 'application-123',
        kyc_link_id: mockKycLink.id,
        status: ApplicationStatus.PENDING,
        ...mockKycData,
      };

      mockKycApplicationRepository.create.mockReturnValue(
        mockCreatedApplication,
      );
      mockKycApplicationRepository.save.mockResolvedValue(
        mockCreatedApplication,
      );

      // Act
      const result = await service.submitKYCApplication(token, mockKycData);

      // Assert
      expect(mockKycLinkRepository.findOne).toHaveBeenCalledWith({
        where: { token },
        relations: ['landlord'],
      });
      expect(mockPropertyRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: mockKycData.property_id,
          owner_id: mockKycLink.landlord_id,
        },
      });
      expect(mockKycApplicationRepository.findOne).toHaveBeenCalledWith({
        where: {
          property_id: mockKycData.property_id,
          phone_number: mockKycData.phone_number,
        },
      });
      expect(mockKycApplicationRepository.create).toHaveBeenCalled();
      expect(result.status).toBe(ApplicationStatus.PENDING);
    });

    it('should throw ConflictException when user has pending application', async () => {
      // Arrange
      mockKycLinkRepository.findOne.mockResolvedValue(mockKycLink);
      mockPropertyRepository.findOne.mockResolvedValue({
        id: 'property-123',
        property_status: PropertyStatusEnum.VACANT,
        owner_id: 'landlord-123',
      });
      mockKycApplicationRepository.findOne.mockResolvedValue({
        id: 'existing-application',
        phone_number: mockKycData.phone_number,
        property_id: mockKycData.property_id,
        status: ApplicationStatus.PENDING,
      });

      // Act & Assert
      await expect(
        service.submitKYCApplication(token, mockKycData),
      ).rejects.toThrow(ConflictException);
      expect(mockKycApplicationRepository.findOne).toHaveBeenCalledWith({
        where: {
          property_id: mockKycData.property_id,
          phone_number: mockKycData.phone_number,
        },
      });
    });

    it('should throw ConflictException when user has active tenancy', async () => {
      // Arrange
      mockKycLinkRepository.findOne.mockResolvedValue(mockKycLink);
      mockPropertyRepository.findOne.mockResolvedValue({
        id: 'property-123',
        property_status: PropertyStatusEnum.VACANT,
        owner_id: 'landlord-123',
      });
      mockKycApplicationRepository.findOne.mockResolvedValue({
        id: 'existing-application',
        phone_number: mockKycData.phone_number,
        property_id: mockKycData.property_id,
        status: ApplicationStatus.APPROVED,
        tenant_id: 'tenant-123',
      });
      mockPropertyTenantRepository.findOne.mockResolvedValue({
        id: 'property-tenant-123',
        property_id: mockKycData.property_id,
        tenant_id: 'tenant-123',
        status: TenantStatusEnum.ACTIVE,
      });

      // Act & Assert
      await expect(
        service.submitKYCApplication(token, mockKycData),
      ).rejects.toThrow(ConflictException);
      expect(mockPropertyTenantRepository.findOne).toHaveBeenCalledWith({
        where: {
          property_id: mockKycData.property_id,
          tenant_id: 'tenant-123',
          status: TenantStatusEnum.ACTIVE,
        },
      });
    });

    it('should allow reapplication when previous tenancy ended', async () => {
      // Arrange
      mockKycLinkRepository.findOne.mockResolvedValue(mockKycLink);
      mockPropertyRepository.findOne.mockResolvedValue({
        id: 'property-123',
        property_status: PropertyStatusEnum.VACANT,
        owner_id: 'landlord-123',
      });

      // First call: existing application found
      // Second call: after deletion, no application found
      mockKycApplicationRepository.findOne
        .mockResolvedValueOnce({
          id: 'existing-application',
          phone_number: mockKycData.phone_number,
          property_id: mockKycData.property_id,
          status: ApplicationStatus.APPROVED,
          tenant_id: 'tenant-123',
        })
        .mockResolvedValueOnce(null); // After deletion

      // No active tenancy (tenancy was ended)
      mockPropertyTenantRepository.findOne.mockResolvedValue(null);

      mockKycApplicationRepository.delete.mockResolvedValue({ affected: 1 });
      mockKycApplicationRepository.create.mockReturnValue({
        id: 'new-application-123',
        status: ApplicationStatus.PENDING,
        ...mockKycData,
      });
      mockKycApplicationRepository.save.mockResolvedValue({
        id: 'new-application-123',
        status: ApplicationStatus.PENDING,
        ...mockKycData,
      });

      // Act
      const result = await service.submitKYCApplication(token, mockKycData);

      // Assert
      expect(mockKycApplicationRepository.delete).toHaveBeenCalledWith(
        'existing-application',
      );
      expect(mockKycApplicationRepository.create).toHaveBeenCalled();
      expect(result.status).toBe(ApplicationStatus.PENDING);
    });

    it('should allow reapplication when previous application was rejected', async () => {
      // Arrange
      mockKycLinkRepository.findOne.mockResolvedValue(mockKycLink);
      mockPropertyRepository.findOne.mockResolvedValue({
        id: 'property-123',
        property_status: PropertyStatusEnum.VACANT,
        owner_id: 'landlord-123',
      });

      // First call: rejected application found
      // Second call: after deletion, no application found
      mockKycApplicationRepository.findOne
        .mockResolvedValueOnce({
          id: 'rejected-application',
          phone_number: mockKycData.phone_number,
          property_id: mockKycData.property_id,
          status: ApplicationStatus.REJECTED,
        })
        .mockResolvedValueOnce(null); // After deletion

      mockKycApplicationRepository.delete.mockResolvedValue({ affected: 1 });
      mockKycApplicationRepository.create.mockReturnValue({
        id: 'new-application-123',
        status: ApplicationStatus.PENDING,
        ...mockKycData,
      });
      mockKycApplicationRepository.save.mockResolvedValue({
        id: 'new-application-123',
        status: ApplicationStatus.PENDING,
        ...mockKycData,
      });

      // Act
      const result = await service.submitKYCApplication(token, mockKycData);

      // Assert
      expect(mockKycApplicationRepository.delete).toHaveBeenCalledWith(
        'rejected-application',
      );
      expect(mockKycApplicationRepository.create).toHaveBeenCalled();
      expect(result.status).toBe(ApplicationStatus.PENDING);
    });

    it('should throw BadRequestException for invalid token', async () => {
      // Arrange
      mockKycLinkRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.submitKYCApplication('invalid-token', mockKycData),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for inactive KYC link', async () => {
      // Arrange
      const inactiveKycLink = { ...mockKycLink, is_active: false };
      mockKycLinkRepository.findOne.mockResolvedValue(inactiveKycLink);

      // Act & Assert
      await expect(
        service.submitKYCApplication(token, mockKycData),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for expired KYC link', async () => {
      // Arrange
      const expiredKycLink = {
        ...mockKycLink,
        expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000),
      };
      mockKycLinkRepository.findOne.mockResolvedValue(expiredKycLink);

      // Act & Assert
      await expect(
        service.submitKYCApplication(token, mockKycData),
      ).rejects.toThrow(BadRequestException);
      expect(mockKycLinkRepository.update).toHaveBeenCalledWith(
        expiredKycLink.id,
        { is_active: false },
      );
    });
  });

  describe('getApplicationsByProperty', () => {
    const propertyId = 'property-123';
    const landlordId = 'landlord-123';
    const mockProperty = {
      id: propertyId,
      owner_id: landlordId,
    };

    const mockApplications = [
      {
        id: 'app-1',
        property_id: propertyId,
        status: ApplicationStatus.PENDING,
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        created_at: new Date(),
      },
      {
        id: 'app-2',
        property_id: propertyId,
        status: ApplicationStatus.APPROVED,
        first_name: 'Jane',
        last_name: 'Smith',
        email: 'jane@example.com',
        created_at: new Date(),
      },
    ];

    it('should return applications for property owner', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(mockProperty);
      mockKycApplicationRepository.find.mockResolvedValue(mockApplications);

      // Act
      const result = await service.getApplicationsByProperty(
        propertyId,
        landlordId,
      );

      // Assert
      expect(mockPropertyRepository.findOne).toHaveBeenCalledWith({
        where: { id: propertyId },
      });
      expect(mockKycApplicationRepository.find).toHaveBeenCalledWith({
        where: { property_id: propertyId },
        relations: ['property', 'kyc_link', 'tenant'],
        order: {
          created_at: 'DESC',
          status: 'ASC',
        },
      });
      expect(result).toEqual(mockApplications);
    });

    it('should throw NotFoundException when property does not exist', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.getApplicationsByProperty(propertyId, landlordId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user is not property owner', async () => {
      // Arrange
      const wrongProperty = { ...mockProperty, owner_id: 'wrong-owner' };
      mockPropertyRepository.findOne.mockResolvedValue(wrongProperty);

      // Act & Assert
      await expect(
        service.getApplicationsByProperty(propertyId, landlordId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getApplicationsByPropertyWithFilters', () => {
    const propertyId = 'property-123';
    const landlordId = 'landlord-123';
    const mockProperty = {
      id: propertyId,
      owner_id: landlordId,
    };

    it('should return filtered applications with custom sorting', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(mockProperty);
      mockKycApplicationRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder,
      );
      const mockApplications = [
        { id: 'app-1', status: ApplicationStatus.PENDING },
      ];
      mockQueryBuilder.getMany.mockResolvedValue(mockApplications);

      const filters = {
        status: ApplicationStatus.PENDING,
        sortBy: 'first_name' as const,
        sortOrder: 'ASC' as const,
      };

      // Act
      const result = await service.getApplicationsByPropertyWithFilters(
        propertyId,
        landlordId,
        filters,
      );

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'application.property_id = :propertyId',
        { propertyId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'application.status = :status',
        { status: ApplicationStatus.PENDING },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'application.first_name',
        'ASC',
      );
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'application.created_at',
        'DESC',
      );
      expect(result).toEqual(mockApplications);
    });

    it('should use default sorting when no filters provided', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(mockProperty);
      mockKycApplicationRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder,
      );
      mockQueryBuilder.getMany.mockResolvedValue([]);

      // Act
      await service.getApplicationsByPropertyWithFilters(
        propertyId,
        landlordId,
      );

      // Assert
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'application.created_at',
        'DESC',
      );
      expect(mockQueryBuilder.addOrderBy).not.toHaveBeenCalled();
    });
  });

  describe('getApplicationById', () => {
    const applicationId = 'app-123';
    const landlordId = 'landlord-123';
    const mockApplication = {
      id: applicationId,
      property_id: 'property-123',
      status: ApplicationStatus.PENDING,
    };
    const mockProperty = {
      id: 'property-123',
      owner_id: landlordId,
    };

    it('should return application for authorized landlord', async () => {
      // Arrange
      mockKycApplicationRepository.findOne.mockResolvedValue(mockApplication);
      mockPropertyRepository.findOne.mockResolvedValue(mockProperty);

      // Act
      const result = await service.getApplicationById(
        applicationId,
        landlordId,
      );

      // Assert
      expect(mockKycApplicationRepository.findOne).toHaveBeenCalledWith({
        where: { id: applicationId },
        relations: ['property', 'kyc_link', 'tenant'],
      });
      expect(result).toEqual(mockApplication);
    });

    it('should throw NotFoundException when application does not exist', async () => {
      // Arrange
      mockKycApplicationRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.getApplicationById(applicationId, landlordId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when landlord does not own property', async () => {
      // Arrange
      mockKycApplicationRepository.findOne.mockResolvedValue(mockApplication);
      const wrongProperty = { ...mockProperty, owner_id: 'wrong-owner' };
      mockPropertyRepository.findOne.mockResolvedValue(wrongProperty);

      // Act & Assert
      await expect(
        service.getApplicationById(applicationId, landlordId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateApplicationStatus', () => {
    const applicationId = 'app-123';
    const tenantId = 'tenant-123';

    it('should update application status successfully', async () => {
      // Arrange
      const mockApplication = {
        id: applicationId,
        status: ApplicationStatus.PENDING,
      };
      const updatedApplication = {
        ...mockApplication,
        status: ApplicationStatus.APPROVED,
        tenant_id: tenantId,
      };

      mockKycApplicationRepository.findOne
        .mockResolvedValueOnce(mockApplication)
        .mockResolvedValueOnce(updatedApplication);

      // Act
      const result = await service.updateApplicationStatus(
        applicationId,
        ApplicationStatus.APPROVED,
        tenantId,
      );

      // Assert
      expect(mockKycApplicationRepository.update).toHaveBeenCalledWith(
        applicationId,
        {
          status: ApplicationStatus.APPROVED,
          tenant_id: tenantId,
        },
      );
      expect(result).toEqual(updatedApplication);
    });

    it('should throw NotFoundException when application does not exist', async () => {
      // Arrange
      mockKycApplicationRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.updateApplicationStatus(
          applicationId,
          ApplicationStatus.APPROVED,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('rejectOtherApplications', () => {
    const propertyId = 'property-123';
    const excludeApplicationId = 'app-123';

    it('should reject other pending applications for property', async () => {
      // Arrange
      mockKycApplicationRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder,
      );

      // Act
      await service.rejectOtherApplications(propertyId, excludeApplicationId);

      // Assert
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(KYCApplication);
      expect(mockQueryBuilder.set).toHaveBeenCalledWith({
        status: ApplicationStatus.REJECTED,
      });
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'property_id = :propertyId',
        { propertyId },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'status = :status',
        { status: ApplicationStatus.PENDING },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'id != :excludeApplicationId',
        { excludeApplicationId },
      );
      expect(mockQueryBuilder.execute).toHaveBeenCalled();
    });
  });

  describe('getApplicationStatistics', () => {
    const propertyId = 'property-123';
    const landlordId = 'landlord-123';
    const mockProperty = {
      id: propertyId,
      owner_id: landlordId,
    };

    it('should return application statistics for property', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(mockProperty);
      mockKycApplicationRepository.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(5) // pending
        .mockResolvedValueOnce(3) // approved
        .mockResolvedValueOnce(2); // rejected

      // Act
      const result = await service.getApplicationStatistics(
        propertyId,
        landlordId,
      );

      // Assert
      expect(mockKycApplicationRepository.count).toHaveBeenCalledTimes(4);
      expect(result).toEqual({
        total: 10,
        pending: 5,
        approved: 3,
        rejected: 2,
      });
    });

    it('should throw ForbiddenException when user is not property owner', async () => {
      // Arrange
      const wrongProperty = { ...mockProperty, owner_id: 'wrong-owner' };
      mockPropertyRepository.findOne.mockResolvedValue(wrongProperty);

      // Act & Assert
      await expect(
        service.getApplicationStatistics(propertyId, landlordId),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});

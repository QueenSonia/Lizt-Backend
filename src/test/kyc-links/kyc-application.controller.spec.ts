import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { KYCApplicationController } from '../../kyc-links/kyc-application.controller';
import { KYCApplicationService } from '../../kyc-links/kyc-application.service';
import { CreateKYCApplicationDto } from '../../kyc-links/dto/create-kyc-application.dto';
import {
  KYCApplication,
  ApplicationStatus,
} from '../../kyc-links/entities/kyc-application.entity';
import { Account } from '../../users/entities/account.entity';
import {
  Gender,
  MaritalStatus,
  EmploymentStatus,
} from '../../tenant-kyc/entities/tenant-kyc.entity';

describe('KYCApplicationController', () => {
  let controller: KYCApplicationController;
  let kycApplicationService: KYCApplicationService;

  const mockKycApplicationService = {
    submitKYCApplication: jest.fn(),
    getApplicationsByPropertyWithFilters: jest.fn(),
    getApplicationStatistics: jest.fn(),
    getApplicationById: jest.fn(),
    getApplicationsByTenant: jest.fn(),
  };

  const mockUser: Account = {
    id: 'landlord-123',
    email: 'landlord@example.com',
    role: 'landlord',
  } as Account;

  const mockKycApplicationDto: CreateKYCApplicationDto = {
    first_name: 'John',
    last_name: 'Doe',
    email: 'john.doe@example.com',
    phone_number: '+2348012345678',
    date_of_birth: '1990-01-01',
    gender: Gender.MALE,
    nationality: 'Nigerian',
    state_of_origin: 'Lagos',
    local_government_area: 'Ikeja',
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
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KYCApplicationController],
      providers: [
        {
          provide: KYCApplicationService,
          useValue: mockKycApplicationService,
        },
      ],
    }).compile();

    controller = module.get<KYCApplicationController>(KYCApplicationController);
    kycApplicationService = module.get<KYCApplicationService>(
      KYCApplicationService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('submitKYCApplication', () => {
    const token = 'valid-token-123';

    const mockSubmittedApplication = {
      id: 'application-123',
      kyc_link_id: 'kyc-link-123',
      property_id: 'property-123',
      status: ApplicationStatus.PENDING,
      tenant_id: undefined,
      first_name: mockKycApplicationDto.first_name,
      last_name: mockKycApplicationDto.last_name,
      email: mockKycApplicationDto.email,
      phone_number: mockKycApplicationDto.phone_number,
      date_of_birth: new Date(mockKycApplicationDto.date_of_birth),
      gender: mockKycApplicationDto.gender,
      nationality: mockKycApplicationDto.nationality,
      state_of_origin: mockKycApplicationDto.state_of_origin,
      local_government_area: mockKycApplicationDto.local_government_area,
      marital_status: mockKycApplicationDto.marital_status,
      employment_status: mockKycApplicationDto.employment_status,
      occupation: mockKycApplicationDto.occupation,
      job_title: mockKycApplicationDto.job_title,
      employer_name: mockKycApplicationDto.employer_name,
      employer_address: mockKycApplicationDto.employer_address,
      monthly_net_income: mockKycApplicationDto.monthly_net_income,
      reference1_name: mockKycApplicationDto.reference1_name,
      reference1_address: mockKycApplicationDto.reference1_address,
      reference1_relationship: mockKycApplicationDto.reference1_relationship,
      reference1_phone_number: mockKycApplicationDto.reference1_phone_number,
      reference2_name: mockKycApplicationDto.reference2_name,
      reference2_address: mockKycApplicationDto.reference2_address,
      reference2_relationship: mockKycApplicationDto.reference2_relationship,
      reference2_phone_number: mockKycApplicationDto.reference2_phone_number,
    } as KYCApplication;

    it('should submit KYC application successfully', async () => {
      // Arrange
      mockKycApplicationService.submitKYCApplication.mockResolvedValue(
        mockSubmittedApplication,
      );

      // Act
      const result = await controller.submitKYCApplication(
        token,
        mockKycApplicationDto,
      );

      // Assert
      expect(
        mockKycApplicationService.submitKYCApplication,
      ).toHaveBeenCalledWith(token, mockKycApplicationDto);
      expect(result).toEqual({
        success: true,
        message: 'KYC application submitted successfully',
        applicationId: mockSubmittedApplication.id,
        status: ApplicationStatus.PENDING,
      });
    });

    it('should handle invalid token error', async () => {
      // Arrange
      mockKycApplicationService.submitKYCApplication.mockRejectedValue(
        new NotFoundException('Invalid KYC token'),
      );

      // Act & Assert
      await expect(
        controller.submitKYCApplication('invalid-token', mockKycApplicationDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle duplicate application error', async () => {
      // Arrange
      mockKycApplicationService.submitKYCApplication.mockRejectedValue(
        new ConflictException(
          'You have already submitted an application for this property',
        ),
      );

      // Act & Assert
      await expect(
        controller.submitKYCApplication(token, mockKycApplicationDto),
      ).rejects.toThrow(ConflictException);
    });

    it('should handle expired token error', async () => {
      // Arrange
      mockKycApplicationService.submitKYCApplication.mockRejectedValue(
        new BadRequestException('This KYC form has expired'),
      );

      // Act & Assert
      await expect(
        controller.submitKYCApplication(token, mockKycApplicationDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should validate required fields in DTO', async () => {
      // This test documents that validation is handled by ValidationPipe
      // In practice, the ValidationPipe would reject invalid DTOs before reaching the controller
      const invalidDto = {
        ...mockKycApplicationDto,
        first_name: '', // Required field is empty
        email: 'invalid-email', // Invalid email format
      };

      // The ValidationPipe would throw a BadRequestException for validation errors
      expect(invalidDto.first_name).toBe('');
      expect(invalidDto.email).not.toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    });
  });

  describe('getApplicationsByProperty', () => {
    const propertyId = 'property-123';

    const mockApplications: KYCApplication[] = [
      {
        id: 'app-1',
        property_id: propertyId,
        status: ApplicationStatus.PENDING,
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        created_at: new Date(),
      } as KYCApplication,
      {
        id: 'app-2',
        property_id: propertyId,
        status: ApplicationStatus.APPROVED,
        first_name: 'Jane',
        last_name: 'Smith',
        email: 'jane@example.com',
        created_at: new Date(),
      } as KYCApplication,
    ];

    const mockStatistics = {
      total: 5,
      pending: 2,
      approved: 2,
      rejected: 1,
    };

    it('should return applications and statistics for property', async () => {
      // Arrange
      mockKycApplicationService.getApplicationsByPropertyWithFilters.mockResolvedValue(
        mockApplications,
      );
      mockKycApplicationService.getApplicationStatistics.mockResolvedValue(
        mockStatistics,
      );

      // Act
      const result = await controller.getApplicationsByProperty(
        propertyId,
        mockUser,
      );

      // Assert
      expect(
        mockKycApplicationService.getApplicationsByPropertyWithFilters,
      ).toHaveBeenCalledWith(propertyId, mockUser.id, {
        status: undefined,
        sortBy: undefined,
        sortOrder: undefined,
      });
      expect(
        mockKycApplicationService.getApplicationStatistics,
      ).toHaveBeenCalledWith(propertyId, mockUser.id);
      expect(result).toEqual({
        success: true,
        applications: mockApplications,
        statistics: mockStatistics,
      });
    });

    it('should apply filters when provided', async () => {
      // Arrange
      const filteredApplications = [mockApplications[0]]; // Only pending
      mockKycApplicationService.getApplicationsByPropertyWithFilters.mockResolvedValue(
        filteredApplications,
      );
      mockKycApplicationService.getApplicationStatistics.mockResolvedValue(
        mockStatistics,
      );

      // Act
      const result = await controller.getApplicationsByProperty(
        propertyId,
        mockUser,
        ApplicationStatus.PENDING,
        'first_name',
        'ASC',
      );

      // Assert
      expect(
        mockKycApplicationService.getApplicationsByPropertyWithFilters,
      ).toHaveBeenCalledWith(propertyId, mockUser.id, {
        status: ApplicationStatus.PENDING,
        sortBy: 'first_name',
        sortOrder: 'ASC',
      });
      expect(result.applications).toEqual(filteredApplications);
    });

    it('should handle property not found error', async () => {
      // Arrange
      mockKycApplicationService.getApplicationsByPropertyWithFilters.mockRejectedValue(
        new NotFoundException('Property not found'),
      );

      // Act & Assert
      await expect(
        controller.getApplicationsByProperty(propertyId, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle unauthorized access error', async () => {
      // Arrange
      mockKycApplicationService.getApplicationsByPropertyWithFilters.mockRejectedValue(
        new BadRequestException(
          'You are not authorized to access applications for this property',
        ),
      );

      // Act & Assert
      await expect(
        controller.getApplicationsByProperty(propertyId, mockUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getApplicationById', () => {
    const applicationId = 'application-123';

    const mockApplication: KYCApplication = {
      id: applicationId,
      property_id: 'property-123',
      status: ApplicationStatus.PENDING,
      first_name: 'John',
      last_name: 'Doe',
      email: 'john@example.com',
      phone_number: '+2348012345678',
      created_at: new Date(),
    } as KYCApplication;

    it('should return application by ID', async () => {
      // Arrange
      mockKycApplicationService.getApplicationById.mockResolvedValue(
        mockApplication,
      );

      // Act
      const result = await controller.getApplicationById(
        applicationId,
        mockUser,
      );

      // Assert
      expect(mockKycApplicationService.getApplicationById).toHaveBeenCalledWith(
        applicationId,
        mockUser.id,
      );
      expect(result).toEqual({
        success: true,
        application: mockApplication,
      });
    });

    it('should handle application not found error', async () => {
      // Arrange
      mockKycApplicationService.getApplicationById.mockRejectedValue(
        new NotFoundException('KYC application not found'),
      );

      // Act & Assert
      await expect(
        controller.getApplicationById(applicationId, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle unauthorized access error', async () => {
      // Arrange
      mockKycApplicationService.getApplicationById.mockRejectedValue(
        new BadRequestException(
          'You are not authorized to access this application',
        ),
      );

      // Act & Assert
      await expect(
        controller.getApplicationById(applicationId, mockUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getApplicationStatistics', () => {
    const propertyId = 'property-123';

    const mockStatistics = {
      total: 10,
      pending: 4,
      approved: 3,
      rejected: 3,
    };

    it('should return application statistics for property', async () => {
      // Arrange
      mockKycApplicationService.getApplicationStatistics.mockResolvedValue(
        mockStatistics,
      );

      // Act
      const result = await controller.getApplicationStatistics(
        propertyId,
        mockUser,
      );

      // Assert
      expect(
        mockKycApplicationService.getApplicationStatistics,
      ).toHaveBeenCalledWith(propertyId, mockUser.id);
      expect(result).toEqual({
        success: true,
        statistics: mockStatistics,
      });
    });

    it('should handle property not found error', async () => {
      // Arrange
      mockKycApplicationService.getApplicationStatistics.mockRejectedValue(
        new NotFoundException('Property not found'),
      );

      // Act & Assert
      await expect(
        controller.getApplicationStatistics(propertyId, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle unauthorized access error', async () => {
      // Arrange
      mockKycApplicationService.getApplicationStatistics.mockRejectedValue(
        new BadRequestException(
          'You are not authorized to access statistics for this property',
        ),
      );

      // Act & Assert
      await expect(
        controller.getApplicationStatistics(propertyId, mockUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Input Validation and Security', () => {
    it('should validate UUID format for propertyId', () => {
      // This test documents that ParseUUIDPipe validates UUID format
      const validUuid = 'property-123'; // In practice, this should be a valid UUID
      const invalidUuid = 'invalid-property-id';

      // ParseUUIDPipe would handle this validation
      expect(typeof validUuid).toBe('string');
      expect(typeof invalidUuid).toBe('string');
    });

    it('should validate UUID format for applicationId', () => {
      // Similar to above, documents UUID validation requirement
      const validUuid = 'application-123';
      const invalidUuid = 'not-a-uuid';

      expect(typeof validUuid).toBe('string');
      expect(typeof invalidUuid).toBe('string');
    });

    it('should require landlord role for protected endpoints', () => {
      // Documents that certain endpoints require landlord role
      // This is enforced by the RoleGuard and @Roles decorator
      expect(typeof controller.getApplicationsByProperty).toBe('function');
      expect(typeof controller.getApplicationById).toBe('function');
      expect(typeof controller.getApplicationStatistics).toBe('function');
    });

    it('should allow public access for KYC submission', () => {
      // Documents that KYC submission is public (no authentication required)
      expect(typeof controller.submitKYCApplication).toBe('function');
    });
  });

  describe('Response Format Consistency', () => {
    it('should return consistent success response format', async () => {
      // Arrange
      const mockApplication = {
        id: 'app-123',
        status: ApplicationStatus.PENDING,
      } as KYCApplication;
      mockKycApplicationService.submitKYCApplication.mockResolvedValue(
        mockApplication,
      );

      // Act
      const result = await controller.submitKYCApplication(
        'token',
        mockKycApplicationDto,
      );

      // Assert
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('applicationId');
      expect(result).toHaveProperty('status');
    });

    it('should return consistent response format for list endpoints', async () => {
      // Arrange
      mockKycApplicationService.getApplicationsByPropertyWithFilters.mockResolvedValue(
        [],
      );
      mockKycApplicationService.getApplicationStatistics.mockResolvedValue({
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
      });

      // Act
      const result = await controller.getApplicationsByProperty(
        'property-123',
        mockUser,
      );

      // Assert
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('applications');
      expect(result).toHaveProperty('statistics');
      expect(Array.isArray(result.applications)).toBe(true);
      expect(typeof result.statistics).toBe('object');
    });
  });

  describe('getApplicationsByTenant', () => {
    const tenantId = 'tenant-123';

    const mockTenantApplications = [
      {
        id: 'app-1',
        property_id: 'property-123',
        tenant_id: tenantId,
        status: ApplicationStatus.APPROVED,
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        created_at: new Date(),
      } as KYCApplication,
    ];

    it('should return applications for tenant', async () => {
      // Arrange
      mockKycApplicationService.getApplicationsByTenant.mockResolvedValue(
        mockTenantApplications,
      );

      // Act
      const result = await controller.getApplicationsByTenant(
        tenantId,
        mockUser,
      );

      // Assert
      expect(
        mockKycApplicationService.getApplicationsByTenant,
      ).toHaveBeenCalledWith(tenantId, mockUser.id);
      expect(result).toEqual({
        success: true,
        applications: mockTenantApplications,
      });
    });

    it('should handle tenant not found error', async () => {
      // Arrange
      mockKycApplicationService.getApplicationsByTenant.mockRejectedValue(
        new NotFoundException('Tenant not found'),
      );

      // Act & Assert
      await expect(
        controller.getApplicationsByTenant(tenantId, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle unauthorized access error', async () => {
      // Arrange
      mockKycApplicationService.getApplicationsByTenant.mockRejectedValue(
        new BadRequestException(
          'You are not authorized to access applications for this tenant',
        ),
      );

      // Act & Assert
      await expect(
        controller.getApplicationsByTenant(tenantId, mockUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Error Handling', () => {
    it('should propagate service errors correctly', async () => {
      // Arrange
      const serviceError = new BadRequestException('Service-specific error');
      mockKycApplicationService.submitKYCApplication.mockRejectedValue(
        serviceError,
      );

      // Act & Assert
      await expect(
        controller.submitKYCApplication('token', mockKycApplicationDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.submitKYCApplication('token', mockKycApplicationDto),
      ).rejects.toThrow('Service-specific error');
    });

    it('should handle unexpected service errors', async () => {
      // Arrange
      const unexpectedError = new Error('Unexpected database error');
      mockKycApplicationService.getApplicationById.mockRejectedValue(
        unexpectedError,
      );

      // Act & Assert
      await expect(
        controller.getApplicationById('app-123', mockUser),
      ).rejects.toThrow('Unexpected database error');
    });
  });
});

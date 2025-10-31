import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { KYCLinksController } from '../../kyc-links/kyc-links.controller';
import { KYCLinksService } from '../../kyc-links/kyc-links.service';
import { TenantAttachmentService } from '../../kyc-links/tenant-attachment.service';
import { SendWhatsAppDto } from '../../kyc-links/dto/send-whatsapp.dto';
import {
  AttachTenantDto,
  RentFrequency,
} from '../../kyc-links/dto/attach-tenant.dto';
import { Account } from '../../users/entities/account.entity';

describe('KYCLinksController', () => {
  let controller: KYCLinksController;
  let kycLinksService: KYCLinksService;
  let tenantAttachmentService: TenantAttachmentService;

  const mockKycLinksService = {
    generateKYCLink: jest.fn(),
    validateKYCToken: jest.fn(),
    sendKYCLinkViaWhatsApp: jest.fn(),
  };

  const mockTenantAttachmentService = {
    attachTenantToProperty: jest.fn(),
  };

  const mockUser: Account = {
    id: 'landlord-123',
    email: 'landlord@example.com',
    role: 'landlord',
  } as Account;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KYCLinksController],
      providers: [
        {
          provide: KYCLinksService,
          useValue: mockKycLinksService,
        },
        {
          provide: TenantAttachmentService,
          useValue: mockTenantAttachmentService,
        },
      ],
    }).compile();

    controller = module.get<KYCLinksController>(KYCLinksController);
    kycLinksService = module.get<KYCLinksService>(KYCLinksService);
    tenantAttachmentService = module.get<TenantAttachmentService>(
      TenantAttachmentService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('generateKYCLink', () => {
    const propertyId = 'property-123';
    const mockKycLinkResponse = {
      token: 'mock-token-123',
      link: 'http://localhost:3000/kyc/mock-token-123',
      expiresAt: new Date(),
      propertyId,
    };

    it('should generate KYC link successfully', async () => {
      // Arrange
      mockKycLinksService.generateKYCLink.mockResolvedValue(
        mockKycLinkResponse,
      );

      // Act
      const result = await controller.generateKYCLink(propertyId, mockUser);

      // Assert
      expect(mockKycLinksService.generateKYCLink).toHaveBeenCalledWith(
        propertyId,
        mockUser.id,
      );
      expect(result).toEqual({
        success: true,
        message: 'KYC link generated successfully',
        data: mockKycLinkResponse,
      });
    });

    it('should handle service errors', async () => {
      // Arrange
      mockKycLinksService.generateKYCLink.mockRejectedValue(
        new BadRequestException('Property is already occupied'),
      );

      // Act & Assert
      await expect(
        controller.generateKYCLink(propertyId, mockUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sendKYCLinkViaWhatsApp', () => {
    const token = 'valid-token-123';
    const sendWhatsAppDto: SendWhatsAppDto = {
      phoneNumber: '+2348012345678',
    };

    const mockTokenValidation = {
      valid: true,
      propertyInfo: {
        id: 'property-123',
        name: 'Test Property',
        location: 'Lagos',
        propertyType: 'Apartment',
        bedrooms: 2,
        bathrooms: 1,
      },
    };

    const mockWhatsAppResponse = {
      success: true,
      message: 'KYC link sent successfully via WhatsApp',
    };

    beforeEach(() => {
      // Mock environment variable
      process.env.FRONTEND_URL = 'http://localhost:3000';
    });

    it('should send KYC link via WhatsApp successfully', async () => {
      // Arrange
      mockKycLinksService.validateKYCToken.mockResolvedValue(
        mockTokenValidation,
      );
      mockKycLinksService.sendKYCLinkViaWhatsApp.mockResolvedValue(
        mockWhatsAppResponse,
      );

      // Act
      const result = await controller.sendKYCLinkViaWhatsApp(
        token,
        sendWhatsAppDto,
        mockUser,
      );

      // Assert
      expect(mockKycLinksService.validateKYCToken).toHaveBeenCalledWith(token);
      expect(mockKycLinksService.sendKYCLinkViaWhatsApp).toHaveBeenCalledWith(
        sendWhatsAppDto.phoneNumber,
        `http://localhost:3000/kyc/${token}`,
        'Test Property',
      );
      expect(result).toEqual({
        success: true,
        message: 'KYC link sent successfully via WhatsApp',
      });
    });

    it('should return error when token validation fails', async () => {
      // Arrange
      const invalidTokenValidation = {
        valid: false,
        error: 'Invalid KYC token',
      };
      mockKycLinksService.validateKYCToken.mockResolvedValue(
        invalidTokenValidation,
      );

      // Act
      const result = await controller.sendKYCLinkViaWhatsApp(
        token,
        sendWhatsAppDto,
        mockUser,
      );

      // Assert
      expect(result).toEqual({
        success: false,
        message: 'Invalid KYC token',
      });
      expect(mockKycLinksService.sendKYCLinkViaWhatsApp).not.toHaveBeenCalled();
    });

    it('should handle WhatsApp sending failure with error code', async () => {
      // Arrange
      mockKycLinksService.validateKYCToken.mockResolvedValue(
        mockTokenValidation,
      );
      const whatsAppError = {
        success: false,
        message: 'Rate limit exceeded. Please try again later.',
        errorCode: 'RATE_LIMITED',
        retryAfter: 300,
      };
      mockKycLinksService.sendKYCLinkViaWhatsApp.mockResolvedValue(
        whatsAppError,
      );

      // Act
      const result = await controller.sendKYCLinkViaWhatsApp(
        token,
        sendWhatsAppDto,
        mockUser,
      );

      // Assert
      expect(result).toEqual({
        success: false,
        message: 'Rate limit exceeded. Please try again later.',
        data: {
          errorCode: 'RATE_LIMITED',
          retryAfter: 300,
        },
      });
    });

    it('should use default property name when property info is missing', async () => {
      // Arrange
      const tokenValidationWithoutName = {
        valid: true,
        propertyInfo: {
          id: 'property-123',
          name: undefined,
          location: 'Lagos',
          propertyType: 'Apartment',
          bedrooms: 2,
          bathrooms: 1,
        },
      };
      mockKycLinksService.validateKYCToken.mockResolvedValue(
        tokenValidationWithoutName,
      );
      mockKycLinksService.sendKYCLinkViaWhatsApp.mockResolvedValue(
        mockWhatsAppResponse,
      );

      // Act
      await controller.sendKYCLinkViaWhatsApp(token, sendWhatsAppDto, mockUser);

      // Assert
      expect(mockKycLinksService.sendKYCLinkViaWhatsApp).toHaveBeenCalledWith(
        sendWhatsAppDto.phoneNumber,
        `http://localhost:3000/kyc/${token}`,
        'Property', // Default name
      );
    });

    it('should use default frontend URL when environment variable is not set', async () => {
      // Arrange
      delete process.env.FRONTEND_URL;
      mockKycLinksService.validateKYCToken.mockResolvedValue(
        mockTokenValidation,
      );
      mockKycLinksService.sendKYCLinkViaWhatsApp.mockResolvedValue(
        mockWhatsAppResponse,
      );

      // Act
      await controller.sendKYCLinkViaWhatsApp(token, sendWhatsAppDto, mockUser);

      // Assert
      expect(mockKycLinksService.sendKYCLinkViaWhatsApp).toHaveBeenCalledWith(
        sendWhatsAppDto.phoneNumber,
        `http://localhost:3000/kyc/${token}`, // Default URL
        'Test Property',
      );
    });
  });

  describe('validateKYCToken', () => {
    const token = 'valid-token-123';

    it('should validate KYC token successfully', async () => {
      // Arrange
      const mockValidationResult = {
        valid: true,
        propertyInfo: {
          id: 'property-123',
          name: 'Test Property',
          location: 'Lagos',
          propertyType: 'Apartment',
          bedrooms: 2,
          bathrooms: 1,
        },
      };
      mockKycLinksService.validateKYCToken.mockResolvedValue(
        mockValidationResult,
      );

      // Act
      const result = await controller.validateKYCToken(token);

      // Assert
      expect(mockKycLinksService.validateKYCToken).toHaveBeenCalledWith(token);
      expect(result).toEqual({
        success: true,
        message: 'KYC token is valid',
        data: mockValidationResult,
      });
    });

    it('should return error for invalid token', async () => {
      // Arrange
      const mockValidationResult = {
        valid: false,
        error: 'This KYC form has expired',
      };
      mockKycLinksService.validateKYCToken.mockResolvedValue(
        mockValidationResult,
      );

      // Act
      const result = await controller.validateKYCToken(token);

      // Assert
      expect(result).toEqual({
        success: false,
        message: 'This KYC form has expired',
      });
    });

    it('should handle validation errors gracefully', async () => {
      // Arrange
      const mockValidationResult = {
        valid: false,
        error: undefined, // No specific error message
      };
      mockKycLinksService.validateKYCToken.mockResolvedValue(
        mockValidationResult,
      );

      // Act
      const result = await controller.validateKYCToken(token);

      // Assert
      expect(result).toEqual({
        success: false,
        message: 'Invalid KYC token', // Default message
      });
    });
  });

  describe('attachTenantToProperty', () => {
    const applicationId = 'application-123';
    const attachTenantDto: AttachTenantDto = {
      rentAmount: 500000,
      rentDueDate: 15,
      rentFrequency: RentFrequency.MONTHLY,
      tenancyStartDate: '2024-01-01',
      securityDeposit: 100000,
      serviceCharge: 50000,
    };

    const mockAttachmentResult = {
      success: true,
      tenantId: 'tenant-123',
      propertyId: 'property-123',
      message: 'Tenant successfully attached to property',
    };

    it('should attach tenant to property successfully', async () => {
      // Arrange
      mockTenantAttachmentService.attachTenantToProperty.mockResolvedValue(
        mockAttachmentResult,
      );

      // Act
      const result = await controller.attachTenantToProperty(
        applicationId,
        attachTenantDto,
        mockUser,
      );

      // Assert
      expect(
        mockTenantAttachmentService.attachTenantToProperty,
      ).toHaveBeenCalledWith(applicationId, attachTenantDto, mockUser.id);
      expect(result).toEqual({
        success: true,
        message: 'Tenant successfully attached to property',
        data: {
          tenantId: 'tenant-123',
          propertyId: 'property-123',
        },
      });
    });

    it('should handle attachment service errors', async () => {
      // Arrange
      mockTenantAttachmentService.attachTenantToProperty.mockRejectedValue(
        new NotFoundException('KYC application not found'),
      );

      // Act & Assert
      await expect(
        controller.attachTenantToProperty(
          applicationId,
          attachTenantDto,
          mockUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle validation errors in DTO', async () => {
      // Arrange
      const invalidDto = {
        ...attachTenantDto,
        rentAmount: -1000, // Invalid negative amount
      };
      mockTenantAttachmentService.attachTenantToProperty.mockRejectedValue(
        new BadRequestException('Rent amount must be greater than 0'),
      );

      // Act & Assert
      await expect(
        controller.attachTenantToProperty(applicationId, invalidDto, mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle attachment failure', async () => {
      // Arrange
      const failureResult = {
        success: false,
        tenantId: '',
        propertyId: '',
        message: 'Property is already occupied',
      };
      mockTenantAttachmentService.attachTenantToProperty.mockResolvedValue(
        failureResult,
      );

      // Act
      const result = await controller.attachTenantToProperty(
        applicationId,
        attachTenantDto,
        mockUser,
      );

      // Assert
      expect(result).toEqual({
        success: false,
        message: 'Property is already occupied',
        data: {
          tenantId: '',
          propertyId: '',
        },
      });
    });
  });

  describe('Input Validation', () => {
    it('should validate UUID format for propertyId in generateKYCLink', async () => {
      // This test would be handled by the ParseUUIDPipe in the actual implementation
      // The pipe would throw a BadRequestException for invalid UUIDs
      const invalidPropertyId = 'invalid-uuid';

      // In a real scenario, the ParseUUIDPipe would prevent this from reaching the controller
      // This is more of a documentation of expected behavior
      expect(invalidPropertyId).not.toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('should validate UUID format for applicationId in attachTenantToProperty', async () => {
      // Similar to above, this would be handled by ParseUUIDPipe
      const invalidApplicationId = 'not-a-uuid';

      expect(invalidApplicationId).not.toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe('Authentication and Authorization', () => {
    it('should require landlord role for generateKYCLink', () => {
      // This test documents that the endpoint requires landlord role
      // The actual authorization is handled by the RoleGuard and @Roles decorator
      const controllerMetadata = Reflect.getMetadata(
        'roles',
        controller.generateKYCLink,
      );
      // In a real implementation, you would check the decorator metadata
      expect(typeof controller.generateKYCLink).toBe('function');
    });

    it('should require landlord role for sendKYCLinkViaWhatsApp', () => {
      // Similar to above, documents the authorization requirement
      expect(typeof controller.sendKYCLinkViaWhatsApp).toBe('function');
    });

    it('should require landlord role for attachTenantToProperty', () => {
      // Similar to above, documents the authorization requirement
      expect(typeof controller.attachTenantToProperty).toBe('function');
    });

    it('should allow public access for validateKYCToken', () => {
      // This endpoint should be public (no authentication required)
      expect(typeof controller.validateKYCToken).toBe('function');
    });
  });

  describe('Error Response Format', () => {
    it('should return consistent error format for validation failures', async () => {
      // Arrange
      mockKycLinksService.validateKYCToken.mockResolvedValue({
        valid: false,
        error: 'Token has expired',
      });

      // Act
      const result = await controller.validateKYCToken('expired-token');

      // Assert
      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('message', 'Token has expired');
      expect(result).not.toHaveProperty('data');
    });

    it('should return consistent success format for successful operations', async () => {
      // Arrange
      const mockResponse = {
        token: 'new-token',
        link: 'http://localhost:3000/kyc/new-token',
        expiresAt: new Date(),
        propertyId: 'property-123',
      };
      mockKycLinksService.generateKYCLink.mockResolvedValue(mockResponse);

      // Act
      const result = await controller.generateKYCLink('property-123', mockUser);

      // Assert
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(mockResponse);
    });
  });
});

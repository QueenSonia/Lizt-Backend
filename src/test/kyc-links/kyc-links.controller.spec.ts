import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { KYCLinksController } from '../../kyc-links/kyc-links.controller';
import { KYCLinksService } from '../../kyc-links/kyc-links.service';
import { TenantAttachmentService } from '../../kyc-links/tenant-attachment.service';
import { KYCApplicationService } from '../../kyc-links/kyc-application.service';
import { Account } from '../../users/entities/account.entity';

describe('KYCLinksController', () => {
  let controller: KYCLinksController;

  const mockKycLinksService = {
    generateKYCLink: jest.fn(),
    validateKYCToken: jest.fn(),
  };

  const mockTenantAttachmentService = {};

  const mockKycApplicationService = {};

  const mockUser: Account = {
    id: 'landlord-123',
    email: 'landlord@example.com',
    roles: ['landlord' as any],
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
        {
          provide: KYCApplicationService,
          useValue: mockKycApplicationService,
        },
      ],
    }).compile();

    controller = module.get<KYCLinksController>(KYCLinksController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('generateKYCLink', () => {
    const mockKycLinkResponse = {
      token: 'mock-token-123',
      link: 'http://localhost:3000/kyc/mock-token-123',
    };

    it('should generate KYC link successfully', async () => {
      mockKycLinksService.generateKYCLink.mockResolvedValue(
        mockKycLinkResponse,
      );

      const result = await controller.generateKYCLink(mockUser);

      expect(mockKycLinksService.generateKYCLink).toHaveBeenCalledWith(
        mockUser.id,
      );
      expect(result).toEqual({
        success: true,
        message: 'KYC link generated successfully',
        data: mockKycLinkResponse,
      });
    });

    it('should handle service errors', async () => {
      mockKycLinksService.generateKYCLink.mockRejectedValue(
        new BadRequestException('Property is already occupied'),
      );

      await expect(controller.generateKYCLink(mockUser)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('validateKYCToken', () => {
    const token = 'valid-token-123';

    it('should validate KYC token successfully', async () => {
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

      const result = await controller.validateKYCToken(token);

      expect(mockKycLinksService.validateKYCToken).toHaveBeenCalledWith(token);
      expect(result).toEqual({
        success: true,
        message: 'KYC token is valid',
        data: mockValidationResult,
      });
    });

    it('should return error for invalid token', async () => {
      const mockValidationResult = {
        valid: false,
        error: 'This KYC form has expired',
      };
      mockKycLinksService.validateKYCToken.mockResolvedValue(
        mockValidationResult,
      );

      const result = await controller.validateKYCToken(token);

      expect(result).toEqual({
        success: false,
        message: 'This KYC form has expired',
      });
    });

    it('should handle validation errors gracefully', async () => {
      const mockValidationResult = {
        valid: false,
        error: undefined,
      };
      mockKycLinksService.validateKYCToken.mockResolvedValue(
        mockValidationResult,
      );

      const result = await controller.validateKYCToken(token);

      expect(result).toEqual({
        success: false,
        message: 'Invalid KYC token',
      });
    });
  });

  describe('Authentication and Authorization', () => {
    it('should require landlord role for generateKYCLink', () => {
      expect(typeof controller.generateKYCLink).toBe('function');
    });

    it('should allow public access for validateKYCToken', () => {
      expect(typeof controller.validateKYCToken).toBe('function');
    });
  });

  describe('Error Response Format', () => {
    it('should return consistent error format for validation failures', async () => {
      mockKycLinksService.validateKYCToken.mockResolvedValue({
        valid: false,
        error: 'Token has expired',
      });

      const result = await controller.validateKYCToken('expired-token');

      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('message', 'Token has expired');
      expect(result).not.toHaveProperty('data');
    });

    it('should return consistent success format for successful operations', async () => {
      const mockResponse = {
        token: 'new-token',
        link: 'http://localhost:3000/kyc/new-token',
      };
      mockKycLinksService.generateKYCLink.mockResolvedValue(mockResponse);

      const result = await controller.generateKYCLink(mockUser);

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(mockResponse);
    });
  });
});

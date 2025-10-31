import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { KYCLinksService } from '../../kyc-links/kyc-links.service';
import { KYCLink } from '../../kyc-links/entities/kyc-link.entity';
import { Property } from '../../properties/entities/property.entity';
import { PropertyStatusEnum } from '../../properties/dto/create-property.dto';
import { WhatsappBotService } from '../../whatsapp-bot/whatsapp-bot.service';

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-token'),
}));

// Mock UtilService
jest.mock('../../utils/utility-service', () => ({
  UtilService: {
    normalizePhoneNumber: jest.fn((phone) => phone),
  },
}));

describe('KYCLinksService', () => {
  let service: KYCLinksService;
  let kycLinkRepository: Repository<KYCLink>;
  let propertyRepository: Repository<Property>;
  let configService: ConfigService;
  let whatsappBotService: WhatsappBotService;

  const mockKycLinkRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };

  const mockPropertyRepository = {
    findOne: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockWhatsappBotService = {
    sendToWhatsappAPI: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KYCLinksService,
        {
          provide: getRepositoryToken(KYCLink),
          useValue: mockKycLinkRepository,
        },
        {
          provide: getRepositoryToken(Property),
          useValue: mockPropertyRepository,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: WhatsappBotService,
          useValue: mockWhatsappBotService,
        },
      ],
    }).compile();

    service = module.get<KYCLinksService>(KYCLinksService);
    kycLinkRepository = module.get<Repository<KYCLink>>(
      getRepositoryToken(KYCLink),
    );
    propertyRepository = module.get<Repository<Property>>(
      getRepositoryToken(Property),
    );
    configService = module.get<ConfigService>(ConfigService);
    whatsappBotService = module.get<WhatsappBotService>(WhatsappBotService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateKYCLink', () => {
    const propertyId = 'property-123';
    const landlordId = 'landlord-123';
    const mockProperty = {
      id: propertyId,
      name: 'Test Property',
      owner_id: landlordId,
      property_status: PropertyStatusEnum.VACANT,
    };

    it('should generate a new KYC link for vacant property', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(mockProperty);
      mockKycLinkRepository.findOne.mockResolvedValue(null);
      mockConfigService.get.mockImplementation((key) => {
        if (key === 'FRONTEND_URL') return 'http://localhost:3000';
        if (key === 'KYC_LINK_EXPIRY_DAYS') return 7;
        return null;
      });

      const mockKycLink = {
        id: 'kyc-link-123',
        token: 'mock-uuid-token',
        property_id: propertyId,
        landlord_id: landlordId,
        expires_at: new Date(),
        is_active: true,
      };

      mockKycLinkRepository.create.mockReturnValue(mockKycLink);
      mockKycLinkRepository.save.mockResolvedValue(mockKycLink);

      // Act
      const result = await service.generateKYCLink(propertyId, landlordId);

      // Assert
      expect(mockPropertyRepository.findOne).toHaveBeenCalledWith({
        where: { id: propertyId },
      });
      expect(mockKycLinkRepository.findOne).toHaveBeenCalledWith({
        where: { property_id: propertyId, is_active: true },
      });
      expect(mockKycLinkRepository.create).toHaveBeenCalled();
      expect(mockKycLinkRepository.save).toHaveBeenCalled();
      expect(result.token).toBe('mock-uuid-token');
      expect(result.link).toBe('http://localhost:3000/kyc/mock-uuid-token');
      expect(result.propertyId).toBe(propertyId);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should return existing active KYC link', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(mockProperty);
      const existingKycLink = {
        id: 'existing-kyc-link',
        token: 'existing-token',
        property_id: propertyId,
        landlord_id: landlordId,
        expires_at: new Date(),
        is_active: true,
      };
      mockKycLinkRepository.findOne.mockResolvedValue(existingKycLink);
      mockConfigService.get.mockReturnValue('http://localhost:3000');

      // Act
      const result = await service.generateKYCLink(propertyId, landlordId);

      // Assert
      expect(result).toEqual({
        token: existingKycLink.token,
        link: `http://localhost:3000/kyc/${existingKycLink.token}`,
        expiresAt: existingKycLink.expires_at,
        propertyId: propertyId,
      });
      expect(mockKycLinkRepository.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when property does not exist', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.generateKYCLink(propertyId, landlordId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user is not property owner', async () => {
      // Arrange
      const wrongLandlordId = 'wrong-landlord';
      mockPropertyRepository.findOne.mockResolvedValue(mockProperty);

      // Act & Assert
      await expect(
        service.generateKYCLink(propertyId, wrongLandlordId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when property is not vacant', async () => {
      // Arrange
      const occupiedProperty = {
        ...mockProperty,
        property_status: PropertyStatusEnum.OCCUPIED,
      };
      mockPropertyRepository.findOne.mockResolvedValue(occupiedProperty);

      // Act & Assert
      await expect(
        service.generateKYCLink(propertyId, landlordId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateKYCToken', () => {
    const token = 'valid-token';
    const mockProperty = {
      id: 'property-123',
      name: 'Test Property',
      location: 'Test Location',
      property_type: 'Apartment',
      no_of_bedrooms: 2,
      no_of_bathrooms: 1,
      property_status: PropertyStatusEnum.VACANT,
    };

    it('should return valid token with property info', async () => {
      // Arrange
      const mockKycLink = {
        id: 'kyc-link-123',
        token,
        property_id: 'property-123',
        landlord_id: 'landlord-123',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day from now
        is_active: true,
        property: mockProperty,
      };
      mockKycLinkRepository.findOne.mockResolvedValue(mockKycLink);

      // Act
      const result = await service.validateKYCToken(token);

      // Assert
      expect(result).toEqual({
        valid: true,
        propertyInfo: {
          id: mockProperty.id,
          name: mockProperty.name,
          location: mockProperty.location,
          propertyType: mockProperty.property_type,
          bedrooms: mockProperty.no_of_bedrooms,
          bathrooms: mockProperty.no_of_bathrooms,
        },
      });
    });

    it('should return invalid for non-existent token', async () => {
      // Arrange
      mockKycLinkRepository.findOne.mockResolvedValue(null);

      // Act
      const result = await service.validateKYCToken('invalid-token');

      // Assert
      expect(result).toEqual({
        valid: false,
        error: 'Invalid KYC token',
      });
    });

    it('should return invalid for inactive token', async () => {
      // Arrange
      const mockKycLink = {
        id: 'kyc-link-123',
        token,
        is_active: false,
        property: mockProperty,
      };
      mockKycLinkRepository.findOne.mockResolvedValue(mockKycLink);

      // Act
      const result = await service.validateKYCToken(token);

      // Assert
      expect(result).toEqual({
        valid: false,
        error: 'This KYC form is no longer available',
      });
    });

    it('should deactivate and return invalid for expired token', async () => {
      // Arrange
      const mockKycLink = {
        id: 'kyc-link-123',
        token,
        expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
        is_active: true,
        property: mockProperty,
      };
      mockKycLinkRepository.findOne.mockResolvedValue(mockKycLink);

      // Act
      const result = await service.validateKYCToken(token);

      // Assert
      expect(mockKycLinkRepository.update).toHaveBeenCalledWith(
        mockKycLink.id,
        { is_active: false },
      );
      expect(result).toEqual({
        valid: false,
        error: 'This KYC form has expired',
      });
    });

    it('should deactivate and return invalid for occupied property', async () => {
      // Arrange
      const occupiedProperty = {
        ...mockProperty,
        property_status: PropertyStatusEnum.OCCUPIED,
      };
      const mockKycLink = {
        id: 'kyc-link-123',
        token,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        is_active: true,
        property: occupiedProperty,
      };
      mockKycLinkRepository.findOne.mockResolvedValue(mockKycLink);

      // Act
      const result = await service.validateKYCToken(token);

      // Assert
      expect(mockKycLinkRepository.update).toHaveBeenCalledWith(
        mockKycLink.id,
        { is_active: false },
      );
      expect(result).toEqual({
        valid: false,
        error: 'This property is no longer available',
      });
    });

    it('should return invalid for empty or invalid token format', async () => {
      // Act & Assert
      const emptyResult = await service.validateKYCToken('');
      expect(emptyResult).toEqual({
        valid: false,
        error: 'Invalid KYC token format',
      });

      const nullResult = await service.validateKYCToken(null as any);
      expect(nullResult).toEqual({
        valid: false,
        error: 'Invalid KYC token format',
      });
    });
  });

  describe('deactivateKYCLink', () => {
    const propertyId = 'property-123';

    it('should deactivate KYC links for property', async () => {
      // Arrange
      mockKycLinkRepository.update.mockResolvedValue({ affected: 1 });

      // Act
      await service.deactivateKYCLink(propertyId);

      // Assert
      expect(mockKycLinkRepository.update).toHaveBeenCalledWith(
        {
          property_id: propertyId,
          is_active: true,
        },
        {
          is_active: false,
        },
      );
    });

    it('should throw BadRequestException for invalid property ID', async () => {
      // Act & Assert
      await expect(service.deactivateKYCLink('')).rejects.toThrow(
        HttpException,
      );
      await expect(service.deactivateKYCLink(null as any)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('sendKYCLinkViaWhatsApp', () => {
    const phoneNumber = '+2348012345678';
    const kycLink = 'http://localhost:3000/kyc/token-123';
    const propertyName = 'Test Property';

    it('should send KYC link via WhatsApp successfully', async () => {
      // Arrange
      mockWhatsappBotService.sendToWhatsappAPI.mockResolvedValue(undefined);

      // Act
      const result = await service.sendKYCLinkViaWhatsApp(
        phoneNumber,
        kycLink,
        propertyName,
      );

      // Assert
      expect(mockWhatsappBotService.sendToWhatsappAPI).toHaveBeenCalledWith({
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'text',
        text: {
          body: expect.stringContaining(propertyName),
        },
      });
      expect(result).toEqual({
        success: true,
        message: 'KYC link sent successfully via WhatsApp',
      });
    });

    it('should throw BadRequestException for empty phone number', async () => {
      // Act & Assert
      await expect(
        service.sendKYCLinkViaWhatsApp('', kycLink, propertyName),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return failure response when WhatsApp API fails', async () => {
      // Arrange
      mockWhatsappBotService.sendToWhatsappAPI.mockRejectedValue(
        new Error('WhatsApp API error'),
      );

      // Act
      const result = await service.sendKYCLinkViaWhatsApp(
        phoneNumber,
        kycLink,
        propertyName,
      );

      // Assert
      expect(result).toEqual({
        success: false,
        message: 'Failed to send link. Please try again or copy manually',
      });
    });
  });

  describe('deactivateExpiredKYCLinks', () => {
    it('should deactivate expired KYC links and return count', async () => {
      // Arrange
      mockKycLinkRepository.update.mockResolvedValue({ affected: 3 });

      // Act
      const result = await service.deactivateExpiredKYCLinks();

      // Assert
      expect(mockKycLinkRepository.update).toHaveBeenCalledWith(
        {
          is_active: true,
          expires_at: expect.any(Object), // LessThan(new Date())
        },
        {
          is_active: false,
        },
      );
      expect(result).toBe(3);
    });

    it('should return 0 when update fails', async () => {
      // Arrange
      mockKycLinkRepository.update.mockRejectedValue(new Error('DB error'));

      // Act
      const result = await service.deactivateExpiredKYCLinks();

      // Assert
      expect(result).toBe(0);
    });
  });
});

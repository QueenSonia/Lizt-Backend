import { Test, TestingModule } from '@nestjs/testing';
import { NoticeAgreementService } from 'src/notice-agreements/notice-agreement.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NoticeAgreement,
  NoticeStatus,
  NoticeType,
  SendVia,
} from 'src/notice-agreements/entities/notice-agreement.entity';
import { Property } from 'src/properties/entities/property.entity';
import { Account } from 'src/users/entities/account.entity';
import { FileUploadService } from 'src/utils/cloudinary';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CreateNoticeAgreementDto } from 'src/notice-agreements/dto/create-notice-agreement.dto';
import { TenantStatusEnum } from 'src/properties/dto/create-property.dto';
import * as pdfGenerator from 'src/notice-agreements/utils/pdf-generator';
import * as sender from 'src/notice-agreements/utils/sender';

// Mock the utility modules
jest.mock('./utils/pdf-generator');
jest.mock('./utils/sender');

describe('NoticeAgreementService', () => {
  let service: NoticeAgreementService;
  let noticeRepo: Repository<NoticeAgreement>;
  let propertyRepo: Repository<Property>;
  let accountRepo: Repository<Account>;
  let fileUploadService: FileUploadService;
  let eventEmitter: EventEmitter2;

  // Mock repositories
  const mockNoticeRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockPropertyRepository = {
    findOne: jest.fn(),
  };

  const mockAccountRepository = {
    findOne: jest.fn(),
  };

  const mockFileUploadService = {
    uploadBuffer: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  // Test data
  const mockProperty = {
    id: 'property-123',
    name: 'Sunset Apartments',
    owner_id: 'owner-456',
    location: 'Lekki Phase 1, Lagos',
    property_tenants: [
      {
        tenant_id: 'tenant-789',
        status: TenantStatusEnum.ACTIVE,
        tenant: {
          id: 'tenant-789',
          profile_name: 'John Doe',
          email: 'john@example.com',
          phone_number: '+2348012345678',
        },
      },
    ],
  };

  const mockTenant = {
    id: 'tenant-789',
    profile_name: 'John Doe',
    email: 'john@example.com',
    phone_number: '+2348012345678',
    user: {
      first_name: 'John',
      last_name: 'Doe',
    },
  };

  const mockNoticeAgreement = {
    id: 'notice-abc-123',
    notice_id: 'NTC-ABCD1234',
    notice_type: NoticeType.LEASE_RENEWAL,
    tenant_name: 'John Doe',
    property_name: 'Sunset Apartments',
    effective_date: new Date('2025-02-01'),
    status: NoticeStatus.PENDING,
    property_id: 'property-123',
    tenant_id: 'tenant-789',
    notice_image: 'https://cloudinary.com/notices/notice-abc-123.pdf',
    notice_documents: [],
    send_via: [SendVia.EMAIL],
    created_at: new Date('2025-01-15'),
    updated_at: new Date('2025-01-15'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NoticeAgreementService,
        {
          provide: getRepositoryToken(NoticeAgreement),
          useValue: mockNoticeRepository,
        },
        {
          provide: getRepositoryToken(Property),
          useValue: mockPropertyRepository,
        },
        {
          provide: getRepositoryToken(Account),
          useValue: mockAccountRepository,
        },
        {
          provide: FileUploadService,
          useValue: mockFileUploadService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<NoticeAgreementService>(NoticeAgreementService);
    noticeRepo = module.get<Repository<NoticeAgreement>>(
      getRepositoryToken(NoticeAgreement),
    );
    propertyRepo = module.get<Repository<Property>>(
      getRepositoryToken(Property),
    );
    accountRepo = module.get<Repository<Account>>(getRepositoryToken(Account));
    fileUploadService = module.get<FileUploadService>(FileUploadService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    const createDto: CreateNoticeAgreementDto = {
      notice_type: NoticeType.LEASE_RENEWAL,
      effective_date: new Date('2025-02-01'),
      property_id: 'property-123',
      tenant_id: 'tenant-789',
      html_content:
        '<h1>Lease Renewal Notice</h1><p>Your lease expires soon.</p>',
    };

    it('should create a notice agreement successfully', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(mockProperty);
      mockAccountRepository.findOne.mockResolvedValue(mockTenant);
      mockNoticeRepository.create.mockReturnValue(mockNoticeAgreement);
      mockNoticeRepository.save.mockResolvedValue(mockNoticeAgreement);

      (pdfGenerator.generatePdfBufferFromEditor as jest.Mock).mockResolvedValue(
        Buffer.from('PDF content here'),
      );

      mockFileUploadService.uploadBuffer.mockResolvedValue({
        secure_url: 'https://cloudinary.com/notices/notice-abc-123.pdf',
        public_id: 'notices/notice-abc-123',
      });

      (sender.sendEmailWithAttachment as jest.Mock).mockResolvedValue(
        undefined,
      );

      // Act
      const result = await service.create(createDto);

      // Assert
      expect(result).toEqual(mockNoticeAgreement);
      expect(mockPropertyRepository.findOne).toHaveBeenCalledWith({
        where: { id: createDto.property_id },
        relations: ['property_tenants'],
      });
      expect(mockAccountRepository.findOne).toHaveBeenCalledWith({
        where: { id: createDto.tenant_id },
        relations: ['user'],
      });
      expect(pdfGenerator.generatePdfBufferFromEditor).toHaveBeenCalledWith(
        createDto.html_content,
      );
      expect(mockFileUploadService.uploadBuffer).toHaveBeenCalled();
      expect(sender.sendEmailWithAttachment).toHaveBeenCalledWith(
        'https://cloudinary.com/notices/notice-abc-123.pdf',
        mockTenant.email,
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('notice.created', {
        user_id: mockProperty.owner_id,
        property_id: mockProperty.id,
        property_name: mockProperty.name,
      });
      expect(mockNoticeRepository.save).toHaveBeenCalledTimes(2);
    });

    it('should throw NotFoundException when property not found', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.create(createDto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.create(createDto)).rejects.toThrow(
        'Property or tenant not found',
      );
      expect(mockAccountRepository.findOne).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when tenant not found', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(mockProperty);
      mockAccountRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.create(createDto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.create(createDto)).rejects.toThrow(
        'Property or tenant not found',
      );
    });

    it('should throw NotFoundException when tenant not in property', async () => {
      // Arrange
      const propertyWithDifferentTenant = {
        ...mockProperty,
        property_tenants: [
          {
            tenant_id: 'different-tenant-id',
            status: TenantStatusEnum.ACTIVE,
          },
        ],
      };
      mockPropertyRepository.findOne.mockResolvedValue(
        propertyWithDifferentTenant,
      );

      // Act & Assert
      await expect(service.create(createDto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.create(createDto)).rejects.toThrow(
        'Tenant not found in property',
      );
    });

    it('should handle PDF generation failure', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(mockProperty);
      mockAccountRepository.findOne.mockResolvedValue(mockTenant);
      mockNoticeRepository.create.mockReturnValue(mockNoticeAgreement);
      mockNoticeRepository.save.mockResolvedValue(mockNoticeAgreement);

      (pdfGenerator.generatePdfBufferFromEditor as jest.Mock).mockRejectedValue(
        new Error('PDF generation failed'),
      );

      // Act & Assert
      await expect(service.create(createDto)).rejects.toThrow(
        'PDF generation failed',
      );
      expect(mockFileUploadService.uploadBuffer).not.toHaveBeenCalled();
    });

    it('should handle file upload failure', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(mockProperty);
      mockAccountRepository.findOne.mockResolvedValue(mockTenant);
      mockNoticeRepository.create.mockReturnValue(mockNoticeAgreement);
      mockNoticeRepository.save.mockResolvedValue(mockNoticeAgreement);

      (pdfGenerator.generatePdfBufferFromEditor as jest.Mock).mockResolvedValue(
        Buffer.from('PDF content'),
      );

      mockFileUploadService.uploadBuffer.mockRejectedValue(
        new Error('Upload failed'),
      );

      // Act & Assert
      await expect(service.create(createDto)).rejects.toThrow('Upload failed');
    });

    it('should continue if email sending fails', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(mockProperty);
      mockAccountRepository.findOne.mockResolvedValue(mockTenant);
      mockNoticeRepository.create.mockReturnValue(mockNoticeAgreement);
      mockNoticeRepository.save.mockResolvedValue(mockNoticeAgreement);

      (pdfGenerator.generatePdfBufferFromEditor as jest.Mock).mockResolvedValue(
        Buffer.from('PDF content'),
      );

      mockFileUploadService.uploadBuffer.mockResolvedValue({
        secure_url: 'https://cloudinary.com/notices/notice.pdf',
      });

      (sender.sendEmailWithAttachment as jest.Mock).mockRejectedValue(
        new Error('Email service down'),
      );

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      // Act
      const result = await service.create(createDto);

      // Assert
      expect(result).toEqual(mockNoticeAgreement);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to send notice agreement:',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it('should generate unique notice_id', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(mockProperty);
      mockAccountRepository.findOne.mockResolvedValue(mockTenant);

      const createdNotice = { ...mockNoticeAgreement, notice_id: undefined };
      mockNoticeRepository.create.mockReturnValue(createdNotice);
      mockNoticeRepository.save.mockResolvedValue(mockNoticeAgreement);

      (pdfGenerator.generatePdfBufferFromEditor as jest.Mock).mockResolvedValue(
        Buffer.from('PDF'),
      );
      mockFileUploadService.uploadBuffer.mockResolvedValue({
        secure_url: 'https://example.com/notice.pdf',
      });
      (sender.sendEmailWithAttachment as jest.Mock).mockResolvedValue(
        undefined,
      );

      // Act
      await service.create(createDto);

      // Assert
      const createCall = mockNoticeRepository.create.mock.calls[0][0];
      expect(createCall.notice_id).toMatch(/^NTC-/);
      expect(createCall.notice_id).toHaveLength(12); // NTC- + 8 chars
    });

    it('should set property_name and tenant_name correctly', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(mockProperty);
      mockAccountRepository.findOne.mockResolvedValue(mockTenant);
      mockNoticeRepository.create.mockReturnValue(mockNoticeAgreement);
      mockNoticeRepository.save.mockResolvedValue(mockNoticeAgreement);

      (pdfGenerator.generatePdfBufferFromEditor as jest.Mock).mockResolvedValue(
        Buffer.from('PDF'),
      );
      mockFileUploadService.uploadBuffer.mockResolvedValue({
        secure_url: 'https://example.com/notice.pdf',
      });
      (sender.sendEmailWithAttachment as jest.Mock).mockResolvedValue(
        undefined,
      );

      // Act
      await service.create(createDto);

      // Assert
      const createCall = mockNoticeRepository.create.mock.calls[0][0];
      expect(createCall.property_name).toBe(mockProperty.name);
      expect(createCall.tenant_name).toBe(mockTenant.profile_name);
    });
  });

  describe('findOne', () => {
    it('should return a notice agreement by id', async () => {
      // Arrange
      mockNoticeRepository.findOne.mockResolvedValue(mockNoticeAgreement);

      // Act
      const result = await service.findOne('notice-abc-123');

      // Assert
      expect(result).toEqual(mockNoticeAgreement);
      expect(mockNoticeRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'notice-abc-123' },
      });
    });

    it('should return null when notice not found', async () => {
      // Arrange
      mockNoticeRepository.findOne.mockResolvedValue(null);

      // Act
      const result = await service.findOne('non-existent-id');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('getAllNoticeAgreement', () => {
    it('should return paginated notice agreements', async () => {
      // Arrange
      const queryParams = { page: 1, size: 10 };
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest
          .fn()
          .mockResolvedValue([[mockNoticeAgreement], 1]),
      };

      mockNoticeRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getAllNoticeAgreement(
        'owner-456',
        queryParams,
      );

      // Assert
      expect(result).toEqual({
        notice: [mockNoticeAgreement],
        pagination: {
          totalRows: 1,
          perPage: 10,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      });
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'property.owner_id = :ownerId',
        { ownerId: 'owner-456' },
      );
    });

    it('should use default pagination values when not provided', async () => {
      // Arrange
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };

      mockNoticeRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act
      await service.getAllNoticeAgreement('owner-456', {});

      // Assert
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalled();
    });

    it('should apply sorting when provided', async () => {
      // Arrange
      const queryParams = {
        page: 1,
        size: 10,
        sort_by: 'created_at',
        sort_order: 'desc',
      };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };

      mockNoticeRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act
      await service.getAllNoticeAgreement('owner-456', queryParams);

      // Assert
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'notice.created_at',
        'DESC',
      );
    });

    it('should calculate hasNextPage correctly when more pages exist', async () => {
      // Arrange
      const queryParams = { page: 1, size: 10 };
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest
          .fn()
          .mockResolvedValue([Array(10).fill(mockNoticeAgreement), 25]),
      };

      mockNoticeRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getAllNoticeAgreement(
        'owner-456',
        queryParams,
      );

      // Assert
      expect(result.pagination.totalPages).toBe(3);
      expect(result.pagination.hasNextPage).toBe(true);
    });
  });

  describe('resendNoticeAgreement', () => {
    it('should resend notice agreement successfully', async () => {
      // Arrange
      const noticeWithTenant = {
        ...mockNoticeAgreement,
        tenant: mockTenant,
      };

      mockNoticeRepository.findOne.mockResolvedValue(noticeWithTenant);
      (sender.sendEmailWithAttachment as jest.Mock).mockResolvedValue(
        undefined,
      );

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      // Act
      const result = await service.resendNoticeAgreement('notice-abc-123');

      // Assert
      expect(result).toEqual({ message: 'Notice agreement sent successfully' });
      expect(sender.sendEmailWithAttachment).toHaveBeenCalledWith(
        mockNoticeAgreement.notice_image,
        mockTenant.email,
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('resent successfully'),
      );

      consoleSpy.mockRestore();
    });

    it('should throw NotFoundException when notice not found', async () => {
      // Arrange
      mockNoticeRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.resendNoticeAgreement('non-existent-id'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.resendNoticeAgreement('non-existent-id'),
      ).rejects.toThrow('Notice agreement not found');
    });

    it('should throw NotFoundException when notice_image is null', async () => {
      // Arrange
      const noticeWithoutPdf = {
        ...mockNoticeAgreement,
        notice_image: null,
        tenant: mockTenant,
      };

      mockNoticeRepository.findOne.mockResolvedValue(noticeWithoutPdf);

      // Act & Assert
      await expect(
        service.resendNoticeAgreement('notice-abc-123'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.resendNoticeAgreement('notice-abc-123'),
      ).rejects.toThrow('Notice agreement PDF not found');
    });

    it('should throw error when email sending fails', async () => {
      // Arrange
      const noticeWithTenant = {
        ...mockNoticeAgreement,
        tenant: mockTenant,
      };

      mockNoticeRepository.findOne.mockResolvedValue(noticeWithTenant);
      (sender.sendEmailWithAttachment as jest.Mock).mockRejectedValue(
        new Error('SMTP connection failed'),
      );

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      // Act & Assert
      await expect(
        service.resendNoticeAgreement('notice-abc-123'),
      ).rejects.toThrow('Failed to send notice agreement');

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to resend notice agreement:',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  describe('getNoticeAgreementsByTenantId', () => {
    it('should return paginated notices for tenant', async () => {
      // Arrange
      const queryParams = { page: 1, size: 10 };
      mockNoticeRepository.findAndCount.mockResolvedValue([
        [mockNoticeAgreement],
        1,
      ]);

      // Act
      const result = await service.getNoticeAgreementsByTenantId(
        'tenant-789',
        queryParams,
      );

      // Assert
      expect(result).toEqual({
        notice_agreements: [mockNoticeAgreement],
        pagination: {
          totalRows: 1,
          perPage: 10,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      });

      expect(mockNoticeRepository.findAndCount).toHaveBeenCalledWith({
        where: { tenant_id: 'tenant-789' },
        relations: ['property'],
        skip: 0,
        take: 10,
        order: { created_at: 'DESC' },
      });
    });

    it('should handle page 2 correctly', async () => {
      // Arrange
      const queryParams = { page: 2, size: 10 };
      mockNoticeRepository.findAndCount.mockResolvedValue([[], 0]);

      // Act
      await service.getNoticeAgreementsByTenantId('tenant-789', queryParams);

      // Assert
      expect(mockNoticeRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
    });

    it('should use default pagination when not provided', async () => {
      // Arrange
      mockNoticeRepository.findAndCount.mockResolvedValue([[], 0]);

      // Act
      await service.getNoticeAgreementsByTenantId('tenant-789', {});

      // Assert
      expect(mockNoticeRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
        }),
      );
    });
  });

  describe('getNoticeAnalytics', () => {
    it('should return analytics data', async () => {
      // Arrange
      mockNoticeRepository.count
        .mockResolvedValueOnce(15) // totalNotices
        .mockResolvedValueOnce(8) // acknowledgedNotices
        .mockResolvedValueOnce(4) // unacknowledgedNotices
        .mockResolvedValueOnce(3); // pendingNotices

      // Act
      const result = await service.getNoticeAnalytics('owner-456');

      // Assert
      expect(result).toEqual({
        totalNotices: 15,
        acknowledgedNotices: 8,
        unacknowledgedNotices: 4,
        pendingNotices: 3,
      });

      expect(mockNoticeRepository.count).toHaveBeenCalledTimes(4);
      expect(mockNoticeRepository.count).toHaveBeenNthCalledWith(1, {
        where: { property: { owner_id: 'owner-456' } },
      });
      expect(mockNoticeRepository.count).toHaveBeenNthCalledWith(2, {
        where: { status: NoticeStatus.ACKNOWLEDGED },
      });
    });

    it('should return zero counts when no notices exist', async () => {
      // Arrange
      mockNoticeRepository.count.mockResolvedValue(0);

      // Act
      const result = await service.getNoticeAnalytics('owner-456');

      // Assert
      expect(result).toEqual({
        totalNotices: 0,
        acknowledgedNotices: 0,
        unacknowledgedNotices: 0,
        pendingNotices: 0,
      });
    });
  });

  describe('attachNoticeDocument', () => {
    const fileUrls = [
      'https://example.com/doc1.pdf',
      'https://example.com/doc2.pdf',
    ];

    it('should attach documents and create notice', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(mockProperty);
      mockNoticeRepository.create.mockReturnValue(mockNoticeAgreement);
      mockNoticeRepository.save.mockResolvedValue(mockNoticeAgreement);
      (sender.sendEmailWithMultipleAttachments as jest.Mock).mockResolvedValue(
        undefined,
      );

      // Act
      const result = await service.attachNoticeDocument(
        'property-123',
        fileUrls,
      );

      // Assert
      expect(result).toEqual({
        message: 'Document(s) uploaded successfully',
        files: [{ url: fileUrls[0] }, { url: fileUrls[1] }],
      });

      expect(mockPropertyRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'property-123' },
        relations: ['property_tenants.tenant'],
      });

      expect(sender.sendEmailWithMultipleAttachments).toHaveBeenCalledWith(
        fileUrls,
        mockTenant.email,
      );

      expect(mockEventEmitter.emit).toHaveBeenCalledWith('notice.created', {
        user_id: mockProperty.owner_id,
        property_id: mockProperty.id,
        property_name: mockProperty.name,
      });
    });

    it('should throw BadRequestException when property not found', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.attachNoticeDocument('non-existent-property', fileUrls),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.attachNoticeDocument('non-existent-property', fileUrls),
      ).rejects.toThrow('Unable to upload document for this property');
    });

    it('should throw NotFoundException when no active tenant', async () => {
      // Arrange
      const propertyWithInactiveTenant = {
        ...mockProperty,
        property_tenants: [
          {
            tenant_id: 'tenant-789',
            status: TenantStatusEnum.INACTIVE,
            tenant: mockTenant,
          },
        ],
      };

      mockPropertyRepository.findOne.mockResolvedValue(
        propertyWithInactiveTenant,
      );

      // Act & Assert
      await expect(
        service.attachNoticeDocument('property-123', fileUrls),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.attachNoticeDocument('property-123', fileUrls),
      ).rejects.toThrow('No active tenant on this property');
    });

    it('should create notice with UPLOAD type', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(mockProperty);
      mockNoticeRepository.create.mockReturnValue(mockNoticeAgreement);
      mockNoticeRepository.save.mockResolvedValue(mockNoticeAgreement);
      (sender.sendEmailWithMultipleAttachments as jest.Mock).mockResolvedValue(
        undefined,
      );

      // Act
      await service.attachNoticeDocument('property-123', fileUrls);

      // Assert
      const createCall = mockNoticeRepository.create.mock.calls[0][0];
      expect(createCall.notice_type).toBe(NoticeType.UPLOAD);
    });

    it('should handle empty fileUrls array', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockResolvedValue(mockProperty);
      mockNoticeRepository.create.mockReturnValue(mockNoticeAgreement);
      mockNoticeRepository.save.mockResolvedValue(mockNoticeAgreement);
      (sender.sendEmailWithMultipleAttachments as jest.Mock).mockResolvedValue(
        undefined,
      );

      // Act
      const result = await service.attachNoticeDocument('property-123', []);

      // Assert
      expect(result.files).toEqual([]);
    });

    it('should log and rethrow errors', async () => {
      // Arrange
      mockPropertyRepository.findOne.mockRejectedValue(
        new Error('Database connection lost'),
      );

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      // Act & Assert
      await expect(
        service.attachNoticeDocument('property-123', fileUrls),
      ).rejects.toThrow('Database connection lost');

      expect(consoleSpy).toHaveBeenCalledWith(
        'Attach Notice Document Error:',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });
});

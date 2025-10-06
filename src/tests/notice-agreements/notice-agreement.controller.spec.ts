import { Test, TestingModule } from '@nestjs/testing';
import { NoticeAgreementController } from 'src/notice-agreements/notice-agreement.controller';
import { NoticeAgreementService } from 'src/notice-agreements/notice-agreement.service';
import {
  CreateNoticeAgreementDto,
  NoticeAgreementFilter,
} from 'src/notice-agreements/dto/create-notice-agreement.dto';
import {
  NoticeType,
  NoticeStatus,
} from 'src/notice-agreements/entities/notice-agreement.entity';
import { NotFoundException } from '@nestjs/common';

describe('NoticeAgreementController', () => {
  let controller: NoticeAgreementController;
  let service: NoticeAgreementService;

  const mockNoticeAgreementService = {
    getAllNoticeAgreement: jest.fn(),
    getNoticeAgreementsByTenantId: jest.fn(),
    getNoticeAnalytics: jest.fn(),
    create: jest.fn(),
    findOne: jest.fn(),
    resendNoticeAgreement: jest.fn(),
    attachNoticeDocument: jest.fn(),
  };

  const mockRequest = {
    user: {
      id: 'owner-uuid-123',
    },
  };

  const mockNoticeAgreement = {
    id: 'notice-uuid-123',
    notice_id: 'NTC-12345678',
    notice_type: NoticeType.LEASE_RENEWAL,
    tenant_name: 'John Doe',
    property_name: 'Test Property',
    effective_date: new Date('2025-02-01'),
    status: NoticeStatus.PENDING,
    property_id: 'property-uuid-123',
    tenant_id: 'tenant-uuid-123',
    notice_image: 'https://example.com/notice.pdf',
    created_at: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NoticeAgreementController],
      providers: [
        {
          provide: NoticeAgreementService,
          useValue: mockNoticeAgreementService,
        },
      ],
    }).compile();

    controller = module.get<NoticeAgreementController>(
      NoticeAgreementController,
    );
    service = module.get<NoticeAgreementService>(NoticeAgreementService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllNoticeAgreement', () => {
    it('should return paginated notice agreements for owner', async () => {
      const query: NoticeAgreementFilter = { page: 1, size: 10 };
      const expectedResult = {
        notice: [mockNoticeAgreement],
        pagination: {
          totalRows: 1,
          perPage: 10,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      };

      mockNoticeAgreementService.getAllNoticeAgreement.mockResolvedValue(
        expectedResult,
      );

      const result = await controller.getAllNoticeAgreement(mockRequest, query);

      expect(result).toEqual(expectedResult);
      expect(service.getAllNoticeAgreement).toHaveBeenCalledWith(
        'owner-uuid-123',
        query,
      );
    });

    it('should handle errors from service', async () => {
      const query: NoticeAgreementFilter = {};
      mockNoticeAgreementService.getAllNoticeAgreement.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(
        controller.getAllNoticeAgreement(mockRequest, query),
      ).rejects.toThrow('Database error');
    });
  });

  describe('getNoticeAgreementsByTenant', () => {
    it('should return notice agreements for tenant', async () => {
      const query: NoticeAgreementFilter = { page: 1, size: 10 };
      const expectedResult = {
        notice_agreements: [mockNoticeAgreement],
        pagination: {
          totalRows: 1,
          perPage: 10,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      };

      mockNoticeAgreementService.getNoticeAgreementsByTenantId.mockResolvedValue(
        expectedResult,
      );

      const result = await controller.getNoticeAgreementsByTenant(
        query,
        mockRequest,
      );

      expect(result).toEqual(expectedResult);
      expect(service.getNoticeAgreementsByTenantId).toHaveBeenCalledWith(
        'owner-uuid-123',
        query,
      );
    });
  });

  describe('getAnalytics', () => {
    it('should return notice analytics', async () => {
      const expectedAnalytics = {
        totalNotices: 10,
        acknowledgedNotices: 5,
        unacknowledgedNotices: 3,
        pendingNotices: 2,
      };

      mockNoticeAgreementService.getNoticeAnalytics.mockResolvedValue(
        expectedAnalytics,
      );

      const result = await controller.getAnalytics(mockRequest);

      expect(result).toEqual(expectedAnalytics);
      expect(service.getNoticeAnalytics).toHaveBeenCalledWith('owner-uuid-123');
    });

    it('should throw error when owner ID is missing', async () => {
      const invalidRequest = { user: {} };

      await expect(controller.getAnalytics(invalidRequest)).rejects.toThrow(
        'Owner ID not found',
      );
    });
  });

  describe('create', () => {
    it('should create a new notice agreement', async () => {
      const dto: CreateNoticeAgreementDto = {
        notice_type: NoticeType.LEASE_RENEWAL,
        effective_date: new Date('2025-02-01'),
        property_id: 'property-uuid-123',
        tenant_id: 'tenant-uuid-123',
        html_content: '<h1>Notice Agreement</h1>',
      };

      mockNoticeAgreementService.create.mockResolvedValue(mockNoticeAgreement);

      const result = await controller.create(dto);

      expect(result).toEqual(mockNoticeAgreement);
      expect(service.create).toHaveBeenCalledWith(dto);
    });

    it('should handle creation errors', async () => {
      const dto: CreateNoticeAgreementDto = {
        notice_type: NoticeType.LEASE_RENEWAL,
        effective_date: new Date('2025-02-01'),
        property_id: 'property-uuid-123',
        tenant_id: 'tenant-uuid-123',
        html_content: '<h1>Notice Agreement</h1>',
      };

      mockNoticeAgreementService.create.mockRejectedValue(
        new NotFoundException('Tenant not found in property'),
      );

      await expect(controller.create(dto)).rejects.toThrow(
        'Tenant not found in property',
      );
    });
  });

  describe('findOne', () => {
    it('should return a single notice agreement', async () => {
      mockNoticeAgreementService.findOne.mockResolvedValue(mockNoticeAgreement);

      const result = await controller.findOne('notice-uuid-123');

      expect(result).toEqual(mockNoticeAgreement);
      expect(service.findOne).toHaveBeenCalledWith('notice-uuid-123');
    });

    it('should return null when notice not found', async () => {
      mockNoticeAgreementService.findOne.mockResolvedValue(null);

      const result = await controller.findOne('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('resendNoticeAgreement', () => {
    it('should resend notice agreement successfully', async () => {
      const expectedResponse = {
        message: 'Notice agreement sent successfully',
      };

      mockNoticeAgreementService.resendNoticeAgreement.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.resendNoticeAgreement('notice-uuid-123');

      expect(result).toEqual(expectedResponse);
      expect(service.resendNoticeAgreement).toHaveBeenCalledWith(
        'notice-uuid-123',
      );
    });

    it('should handle resend errors', async () => {
      mockNoticeAgreementService.resendNoticeAgreement.mockRejectedValue(
        new NotFoundException('Notice agreement not found'),
      );

      await expect(
        controller.resendNoticeAgreement('non-existent-id'),
      ).rejects.toThrow('Notice agreement not found');
    });
  });

  describe('attachDocument', () => {
    it('should attach documents to notice', async () => {
      const body = {
        document_url: [
          'https://example.com/doc1.pdf',
          'https://example.com/doc2.pdf',
        ],
      };

      const expectedResponse = {
        message: 'Document(s) uploaded successfully',
        files: [
          { url: 'https://example.com/doc1.pdf' },
          { url: 'https://example.com/doc2.pdf' },
        ],
      };

      mockNoticeAgreementService.attachNoticeDocument.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.attachDocument('property-uuid-123', body);

      expect(result).toEqual(expectedResponse);
      expect(service.attachNoticeDocument).toHaveBeenCalledWith(
        'property-uuid-123',
        body.document_url,
      );
    });
  });
});

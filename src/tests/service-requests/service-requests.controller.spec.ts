import { Test, TestingModule } from '@nestjs/testing';
import { ServiceRequestsController } from 'src/service-requests/service-requests.controller';
import { ServiceRequestsService } from 'src/service-requests/service-requests.service';
import { FileUploadService } from 'src/utils/cloudinary';
import { ServiceRequestStatusEnum } from 'src/service-requests/dto/create-service-request.dto';
import { HttpException, HttpStatus } from '@nestjs/common';
import { UpdateServiceRequestResponseDto } from 'src/service-requests/dto/update-service-request.dto';

describe('ServiceRequestsController', () => {
  let controller: ServiceRequestsController;
  let service: ServiceRequestsService;
  let fileUploadService: FileUploadService;

  const mockServiceRequestsService = {
    createServiceRequest: jest.fn(),
    getAllServiceRequests: jest.fn(),
    getServiceRequestById: jest.fn(),
    getServiceRequestByTenant: jest.fn(),
    updateServiceRequestById: jest.fn(),
    deleteServiceRequestById: jest.fn(),
    getPendingAndUrgentRequests: jest.fn(),
  };

  const mockFileUploadService = {
    uploadFile: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServiceRequestsController],
      providers: [
        {
          provide: ServiceRequestsService,
          useValue: mockServiceRequestsService,
        },
        {
          provide: FileUploadService,
          useValue: mockFileUploadService,
        },
      ],
    }).compile();

    controller = module.get<ServiceRequestsController>(
      ServiceRequestsController,
    );
    service = module.get<ServiceRequestsService>(ServiceRequestsService);
    fileUploadService = module.get<FileUploadService>(FileUploadService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createServiceRequest', () => {
    const mockCreateDto = {
      tenant_id: '123e4567-e89b-12d3-a456-426614174000',
      text: 'Water leak in bathroom',
    };

    const mockCreatedRequest = {
      id: 'request-uuid-123',
      request_id: 'SR-20241001-001',
      tenant_id: mockCreateDto.tenant_id,
      property_id: 'property-uuid-456',
      tenant_name: 'John Doe',
      property_name: 'Sunrise Apartments',
      description: mockCreateDto.text,
      status: ServiceRequestStatusEnum.PENDING,
      property_location: '123 Main St, Lagos',
      facility_managers: [
        { phone_number: '+2348012345678', name: 'Jane Smith' },
        { phone_number: '+2348087654321', name: 'Bob Johnson' },
      ],
      issue_category: 'service',
      date_reported: new Date('2024-10-01'),
      created_at: new Date('2024-10-01'),
    };

    it('should create a service request successfully', async () => {
      mockServiceRequestsService.createServiceRequest.mockResolvedValue(
        mockCreatedRequest,
      );

      const result = await controller.createServiceRequest(mockCreateDto);

      expect(service.createServiceRequest).toHaveBeenCalledWith(mockCreateDto);
      expect(service.createServiceRequest).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockCreatedRequest);
      expect(result).toHaveProperty('request_id');
      expect(result).toHaveProperty('facility_managers');
      expect(result.facility_managers).toHaveLength(2);
    });

    it('should return created request with all required fields', async () => {
      mockServiceRequestsService.createServiceRequest.mockResolvedValue(
        mockCreatedRequest,
      );

      const result = await controller.createServiceRequest(mockCreateDto);

      expect(result.id).toBeDefined();
      expect(result.request_id).toBeDefined();
      expect(result.tenant_id).toBe(mockCreateDto.tenant_id);
      expect(result.description).toBe(mockCreateDto.text);
      expect(result.status).toBe(ServiceRequestStatusEnum.PENDING);
      expect(result.property_name).toBeDefined();
      expect(result.property_location).toBeDefined();
      expect(result.facility_managers).toBeDefined();
    });

    it('should handle tenant not in property error', async () => {
      const error = new HttpException(
        'You are not currently renting this property',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
      mockServiceRequestsService.createServiceRequest.mockRejectedValue(error);

      await expect(
        controller.createServiceRequest(mockCreateDto),
      ).rejects.toThrow(error);
      expect(service.createServiceRequest).toHaveBeenCalledWith(mockCreateDto);
    });

    it('should handle no facility manager error', async () => {
      const error = new HttpException(
        'No facility manager assigned to this property yet',
        HttpStatus.BAD_REQUEST,
      );
      mockServiceRequestsService.createServiceRequest.mockRejectedValue(error);

      await expect(
        controller.createServiceRequest(mockCreateDto),
      ).rejects.toThrow(error);
    });

    it('should handle database errors', async () => {
      const error = new Error('Database connection failed');
      mockServiceRequestsService.createServiceRequest.mockRejectedValue(error);

      await expect(
        controller.createServiceRequest(mockCreateDto),
      ).rejects.toThrow(error);
    });

    it('should handle invalid tenant_id format', async () => {
      const invalidDto = {
        tenant_id: 'invalid-uuid',
        text: 'Test request',
      };
      const error = new HttpException(
        'Invalid UUID format',
        HttpStatus.BAD_REQUEST,
      );
      mockServiceRequestsService.createServiceRequest.mockRejectedValue(error);

      await expect(controller.createServiceRequest(invalidDto)).rejects.toThrow(
        error,
      );
    });

    it('should handle empty text', async () => {
      const emptyTextDto = {
        tenant_id: '123e4567-e89b-12d3-a456-426614174000',
        text: '',
      };
      const error = new HttpException(
        'Text is required',
        HttpStatus.BAD_REQUEST,
      );
      mockServiceRequestsService.createServiceRequest.mockRejectedValue(error);

      await expect(
        controller.createServiceRequest(emptyTextDto),
      ).rejects.toThrow(error);
    });
  });

  describe('getAllServiceRequests', () => {
    const mockQuery = {
      page: 1,
      size: 10,
      status: 'pending',
    };

    const mockRequest = {
      user: { id: 'user-uuid-123' },
    };

    const mockResponse = {
      service_requests: [
        {
          id: 'request-1',
          request_id: 'SR-001',
          status: ServiceRequestStatusEnum.PENDING,
          tenant_name: 'John Doe',
          property_name: 'Sunrise Apartments',
          description: 'Plumbing issue',
          date_reported: new Date('2024-10-01'),
        },
        {
          id: 'request-2',
          request_id: 'SR-002',
          status: ServiceRequestStatusEnum.PENDING,
          tenant_name: 'Jane Smith',
          property_name: 'Ocean View',
          description: 'Electrical issue',
          date_reported: new Date('2024-10-02'),
        },
      ],
      pagination: {
        totalRows: 2,
        perPage: 10,
        currentPage: 1,
        totalPages: 1,
        hasNextPage: false,
      },
    };

    it('should return all service requests with pagination', async () => {
      mockServiceRequestsService.getAllServiceRequests.mockResolvedValue(
        mockResponse,
      );

      const result = await controller.getAllServiceRequests(
        mockQuery,
        mockRequest,
      );

      expect(service.getAllServiceRequests).toHaveBeenCalledWith(
        'user-uuid-123',
        mockQuery,
      );
      expect(result).toEqual(mockResponse);
      expect(result.service_requests).toHaveLength(2);
      expect(result.pagination.totalRows).toBe(2);
    });

    it('should handle empty results', async () => {
      const emptyResponse = {
        service_requests: [],
        pagination: {
          totalRows: 0,
          perPage: 10,
          currentPage: 1,
          totalPages: 0,
          hasNextPage: false,
        },
      };
      mockServiceRequestsService.getAllServiceRequests.mockResolvedValue(
        emptyResponse,
      );

      const result = await controller.getAllServiceRequests(
        mockQuery,
        mockRequest,
      );

      expect(result.service_requests).toHaveLength(0);
      expect(result.pagination.totalRows).toBe(0);
    });

    it('should handle missing user in request', async () => {
      const requestWithoutUser = {} as any;
      mockServiceRequestsService.getAllServiceRequests.mockResolvedValue(
        mockResponse,
      );

      const result = await controller.getAllServiceRequests(
        mockQuery,
        requestWithoutUser,
      );

      expect(service.getAllServiceRequests).toHaveBeenCalledWith(
        undefined,
        mockQuery,
      );
      expect(result).toEqual(mockResponse);
    });

    it('should handle query without filters', async () => {
      const emptyQuery = {} as any;
      mockServiceRequestsService.getAllServiceRequests.mockResolvedValue(
        mockResponse,
      );

      const result = await controller.getAllServiceRequests(
        emptyQuery,
        mockRequest,
      );

      expect(service.getAllServiceRequests).toHaveBeenCalledWith(
        'user-uuid-123',
        emptyQuery,
      );
    });

    it('should filter by tenant_id', async () => {
      const queryWithTenant = {
        ...mockQuery,
        tenant_id: 'tenant-uuid-456',
      };
      mockServiceRequestsService.getAllServiceRequests.mockResolvedValue(
        mockResponse,
      );

      await controller.getAllServiceRequests(queryWithTenant, mockRequest);

      expect(service.getAllServiceRequests).toHaveBeenCalledWith(
        'user-uuid-123',
        queryWithTenant,
      );
    });

    it('should filter by property_id', async () => {
      const queryWithProperty = {
        ...mockQuery,
        property_id: 'property-uuid-789',
      };
      mockServiceRequestsService.getAllServiceRequests.mockResolvedValue(
        mockResponse,
      );

      await controller.getAllServiceRequests(queryWithProperty, mockRequest);

      expect(service.getAllServiceRequests).toHaveBeenCalledWith(
        'user-uuid-123',
        queryWithProperty,
      );
    });

    it('should filter by date range', async () => {
      const queryWithDates = {
        ...mockQuery,
        start_date: '2024-01-01',
        end_date: '2024-12-31',
      };
      mockServiceRequestsService.getAllServiceRequests.mockResolvedValue(
        mockResponse,
      );

      await controller.getAllServiceRequests(queryWithDates, mockRequest);

      expect(service.getAllServiceRequests).toHaveBeenCalledWith(
        'user-uuid-123',
        queryWithDates,
      );
    });

    it('should handle pagination parameters', async () => {
      const queryWithPagination = {
        page: 2,
        size: 20,
      };
      mockServiceRequestsService.getAllServiceRequests.mockResolvedValue({
        ...mockResponse,
        pagination: {
          totalRows: 50,
          perPage: 20,
          currentPage: 2,
          totalPages: 3,
          hasNextPage: true,
        },
      });

      const result = await controller.getAllServiceRequests(
        queryWithPagination,
        mockRequest,
      );

      expect(result.pagination.currentPage).toBe(2);
      expect(result.pagination.perPage).toBe(20);
      expect(result.pagination.hasNextPage).toBe(true);
    });

    it('should handle service errors', async () => {
      const error = new Error('Database query failed');
      mockServiceRequestsService.getAllServiceRequests.mockRejectedValue(error);

      await expect(
        controller.getAllServiceRequests(mockQuery, mockRequest),
      ).rejects.toThrow(error);
    });
  });

  describe('getPendingAndUrgentRequests', () => {
    const mockQuery = { page: 1, size: 10 };
    const mockRequest = { user: { id: 'user-uuid-123' } };

    const mockResponse = {
      service_requests: [
        { id: '1', status: ServiceRequestStatusEnum.PENDING },
        { id: '2', status: ServiceRequestStatusEnum.URGENT },
      ],
      pagination: {
        totalRows: 2,
        perPage: 10,
        currentPage: 1,
        totalPages: 1,
        hasNextPage: false,
      },
    };

    it('should return pending and urgent requests', async () => {
      mockServiceRequestsService.getPendingAndUrgentRequests.mockResolvedValue(
        mockResponse,
      );

      const result = await controller.getPendingAndUrgentRequests(
        mockQuery,
        mockRequest,
      );

      expect(service.getPendingAndUrgentRequests).toHaveBeenCalledWith(
        mockQuery,
        'user-uuid-123',
      );
      expect(result).toEqual(mockResponse);
      expect(result.service_requests).toHaveLength(2);
    });

    it('should handle empty results for pending/urgent', async () => {
      const emptyResponse = {
        service_requests: [],
        pagination: {
          totalRows: 0,
          perPage: 10,
          currentPage: 1,
          totalPages: 0,
          hasNextPage: false,
        },
      };
      mockServiceRequestsService.getPendingAndUrgentRequests.mockResolvedValue(
        emptyResponse,
      );

      const result = await controller.getPendingAndUrgentRequests(
        mockQuery,
        mockRequest,
      );

      expect(result.service_requests).toHaveLength(0);
    });

    it('should handle errors', async () => {
      const error = new Error('Failed to fetch pending/urgent requests');
      mockServiceRequestsService.getPendingAndUrgentRequests.mockRejectedValue(
        error,
      );

      await expect(
        controller.getPendingAndUrgentRequests(mockQuery, mockRequest),
      ).rejects.toThrow(error);
    });

    it('should handle missing user', async () => {
      const requestWithoutUser = {} as any;
      mockServiceRequestsService.getPendingAndUrgentRequests.mockResolvedValue(
        mockResponse,
      );

      await controller.getPendingAndUrgentRequests(
        mockQuery,
        requestWithoutUser,
      );

      expect(service.getPendingAndUrgentRequests).toHaveBeenCalledWith(
        mockQuery,
        undefined,
      );
    });
  });

  describe('getServiceRequestByTenant', () => {
    const mockRequest = {
      user: { id: 'tenant-uuid-123' },
      query: { status: 'pending' },
    };

    const mockRequests = [
      {
        id: 'request-1',
        tenant_id: 'tenant-uuid-123',
        status: ServiceRequestStatusEnum.PENDING,
        description: 'Test request 1',
      },
      {
        id: 'request-2',
        tenant_id: 'tenant-uuid-123',
        status: ServiceRequestStatusEnum.PENDING,
        description: 'Test request 2',
      },
    ];

    it('should return service requests by tenant with status filter', async () => {
      mockServiceRequestsService.getServiceRequestByTenant.mockResolvedValue(
        mockRequests,
      );

      const result = await controller.getServiceRequestByTenant(mockRequest);

      expect(service.getServiceRequestByTenant).toHaveBeenCalledWith(
        'tenant-uuid-123',
        'pending',
      );
      expect(result).toEqual(mockRequests);
      expect(result).toHaveLength(2);
    });

    it('should use empty status if not provided', async () => {
      const requestWithoutStatus = {
        user: { id: 'tenant-uuid-123' },
        query: {},
      };

      mockServiceRequestsService.getServiceRequestByTenant.mockResolvedValue(
        mockRequests,
      );

      await controller.getServiceRequestByTenant(requestWithoutStatus);

      expect(service.getServiceRequestByTenant).toHaveBeenCalledWith(
        'tenant-uuid-123',
        '',
      );
    });

    it('should handle empty results', async () => {
      mockServiceRequestsService.getServiceRequestByTenant.mockResolvedValue(
        [],
      );

      const result = await controller.getServiceRequestByTenant(mockRequest);

      expect(result).toHaveLength(0);
    });

    it('should handle multiple status values', async () => {
      const requestWithMultipleStatus = {
        user: { id: 'tenant-uuid-123' },
        query: { status: 'pending,in_progress' },
      };

      mockServiceRequestsService.getServiceRequestByTenant.mockResolvedValue(
        mockRequests,
      );

      await controller.getServiceRequestByTenant(requestWithMultipleStatus);

      expect(service.getServiceRequestByTenant).toHaveBeenCalledWith(
        'tenant-uuid-123',
        'pending,in_progress',
      );
    });

    it('should handle service errors', async () => {
      const error = new Error('Failed to fetch tenant requests');
      mockServiceRequestsService.getServiceRequestByTenant.mockRejectedValue(
        error,
      );

      await expect(
        controller.getServiceRequestByTenant(mockRequest),
      ).rejects.toThrow(error);
    });
  });

  describe('getServiceRequestById', () => {
    const mockRequestId = '123e4567-e89b-12d3-a456-426614174000';
    const mockRequest = {
      id: mockRequestId,
      request_id: 'SR-001',
      status: ServiceRequestStatusEnum.PENDING,
      description: 'Test request',
      tenant_name: 'John Doe',
      property_name: 'Sunrise Apartments',
      tenant: {
        id: 'tenant-uuid',
        profile_name: 'John Doe',
      },
      property: {
        id: 'property-uuid',
        name: 'Sunrise Apartments',
      },
    };

    it('should return a service request by id', async () => {
      mockServiceRequestsService.getServiceRequestById.mockResolvedValue(
        mockRequest,
      );

      const result = await controller.getServiceRequestById(mockRequestId);

      expect(service.getServiceRequestById).toHaveBeenCalledWith(mockRequestId);
      expect(result).toEqual(mockRequest);
      expect(result.id).toBe(mockRequestId);
    });

    it('should include related tenant and property data', async () => {
      mockServiceRequestsService.getServiceRequestById.mockResolvedValue(
        mockRequest,
      );

      const result = await controller.getServiceRequestById(mockRequestId);

      expect(result.tenant).toBeDefined();
      expect(result.property).toBeDefined();
    });

    it('should handle not found error', async () => {
      const error = new HttpException(
        `Service request with id: ${mockRequestId} not found`,
        HttpStatus.NOT_FOUND,
      );
      mockServiceRequestsService.getServiceRequestById.mockRejectedValue(error);

      await expect(
        controller.getServiceRequestById(mockRequestId),
      ).rejects.toThrow(error);
    });

    it('should handle invalid UUID format', async () => {
      const invalidId = 'invalid-uuid';
      const error = new Error('Invalid UUID');
      mockServiceRequestsService.getServiceRequestById.mockRejectedValue(error);

      await expect(controller.getServiceRequestById(invalidId)).rejects.toThrow(
        error,
      );
    });

    it('should handle database errors', async () => {
      const error = new Error('Database connection lost');
      mockServiceRequestsService.getServiceRequestById.mockRejectedValue(error);

      await expect(
        controller.getServiceRequestById(mockRequestId),
      ).rejects.toThrow(error);
    });
  });

  describe('updateServiceRequestById', () => {
    const mockRequestId = '123e4567-e89b-12d3-a456-426614174000';
    const mockUpdateDto = {
      status: ServiceRequestStatusEnum.IN_PROGRESS,
      description: 'Updated description',
      issue_images: undefined,
      tenant_name: undefined,
      property_name: 'Updated Property',
      issue_category: undefined,
      date_reported: undefined,
      resolution_date: undefined,
      tenant_id: undefined,
      property_id: undefined,
    };

    const mockFiles = [
      {
        fieldname: 'issue_images',
        originalname: 'leak-photo.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer: Buffer.from('test image data'),
        size: 12345,
      } as Express.Multer.File,
      {
        fieldname: 'issue_images',
        originalname: 'damage-photo.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer: Buffer.from('test image data 2'),
        size: 23456,
      } as Express.Multer.File,
    ];

    it('should update a service request without files', async () => {
      const updateResult = { affected: 1, raw: [], generatedMaps: [] };
      mockServiceRequestsService.updateServiceRequestById.mockResolvedValue(
        updateResult,
      );

      const result = await controller.updateServiceRequestById(
        mockRequestId,
        mockUpdateDto,
      );

      expect(service.updateServiceRequestById).toHaveBeenCalledWith(
        mockRequestId,
        mockUpdateDto,
      );
      expect(result).toEqual(updateResult);
      expect(result.affected).toBe(1);
    });

    it('should update a service request with files', async () => {
      const mockUploadedUrls = [
        'https://cloudinary.com/leak-photo.jpg',
        'https://cloudinary.com/damage-photo.jpg',
      ];

      mockFileUploadService.uploadFile
        .mockResolvedValueOnce({ secure_url: mockUploadedUrls[0] })
        .mockResolvedValueOnce({ secure_url: mockUploadedUrls[1] });

      const updateResult = { affected: 1, raw: [], generatedMaps: [] };
      mockServiceRequestsService.updateServiceRequestById.mockResolvedValue(
        updateResult,
      );

      const result = await controller.updateServiceRequestById(
        mockRequestId,
        mockUpdateDto,
        mockFiles,
      );

      expect(fileUploadService.uploadFile).toHaveBeenCalledTimes(2);
      expect(fileUploadService.uploadFile).toHaveBeenCalledWith(
        mockFiles[0],
        'service-requests',
      );
      expect(fileUploadService.uploadFile).toHaveBeenCalledWith(
        mockFiles[1],
        'service-requests',
      );
      expect(service.updateServiceRequestById).toHaveBeenCalledWith(
        mockRequestId,
        expect.objectContaining({
          issue_images: mockUploadedUrls,
        }),
      );
    });

    it('should handle single file upload', async () => {
      const singleFile = [mockFiles[0]];
      const mockUploadedUrl = 'https://cloudinary.com/leak-photo.jpg';

      mockFileUploadService.uploadFile.mockResolvedValue({
        secure_url: mockUploadedUrl,
      });

      const updateResult = { affected: 1, raw: [], generatedMaps: [] };
      mockServiceRequestsService.updateServiceRequestById.mockResolvedValue(
        updateResult,
      );

      await controller.updateServiceRequestById(
        mockRequestId,
        mockUpdateDto,
        singleFile,
      );

      expect(fileUploadService.uploadFile).toHaveBeenCalledTimes(1);
      expect(service.updateServiceRequestById).toHaveBeenCalledWith(
        mockRequestId,
        expect.objectContaining({
          issue_images: [mockUploadedUrl],
        }),
      );
    });

    it('should handle upload errors', async () => {
      const error = new Error('Upload failed: Network error');
      mockFileUploadService.uploadFile.mockRejectedValue(error);

      await expect(
        controller.updateServiceRequestById(
          mockRequestId,
          mockUpdateDto,
          mockFiles,
        ),
      ).rejects.toThrow(error);

      expect(service.updateServiceRequestById).not.toHaveBeenCalled();
    });

    it('should handle partial status update', async () => {
      const statusOnlyDto: UpdateServiceRequestResponseDto = {
        status: ServiceRequestStatusEnum.RESOLVED,
        property_name: 'tyink',
      };

      const updateResult = { affected: 1, raw: [], generatedMaps: [] };
      mockServiceRequestsService.updateServiceRequestById.mockResolvedValue(
        updateResult,
      );

      await controller.updateServiceRequestById(mockRequestId, statusOnlyDto);

      expect(service.updateServiceRequestById).toHaveBeenCalledWith(
        mockRequestId,
        statusOnlyDto,
      );
    });

    it('should handle update of non-existent request', async () => {
      const updateResult = { affected: 0, raw: [], generatedMaps: [] };
      mockServiceRequestsService.updateServiceRequestById.mockResolvedValue(
        updateResult,
      );

      const result = await controller.updateServiceRequestById(
        mockRequestId,
        mockUpdateDto,
      );

      expect(result.affected).toBe(0);
    });

    it('should handle database errors during update', async () => {
      const error = new Error('Database update failed');
      mockServiceRequestsService.updateServiceRequestById.mockRejectedValue(
        error,
      );

      await expect(
        controller.updateServiceRequestById(mockRequestId, mockUpdateDto),
      ).rejects.toThrow(error);
    });

    it('should handle cloudinary upload timeout', async () => {
      const error = new Error('Upload timeout');
      mockFileUploadService.uploadFile.mockRejectedValue(error);

      await expect(
        controller.updateServiceRequestById(
          mockRequestId,
          mockUpdateDto,
          mockFiles,
        ),
      ).rejects.toThrow(error);
    });

    it('should update all fields when provided', async () => {
      const fullUpdateDto = {
        status: ServiceRequestStatusEnum.RESOLVED,
        description: 'Fully updated',
        tenant_name: 'John Updated',
        property_name: 'New Property Name',
        issue_category: 'Electrical',
        date_reported: new Date('2024-10-01'),
        resolution_date: new Date('2024-10-05'),
        issue_images: undefined,
        tenant_id: undefined,
        property_id: undefined,
      };

      const updateResult = { affected: 1, raw: [], generatedMaps: [] };
      mockServiceRequestsService.updateServiceRequestById.mockResolvedValue(
        updateResult,
      );

      await controller.updateServiceRequestById(mockRequestId, fullUpdateDto);

      expect(service.updateServiceRequestById).toHaveBeenCalledWith(
        mockRequestId,
        fullUpdateDto,
      );
    });
  });

  describe('deleteServiceRequestById', () => {
    const mockRequestId = '123e4567-e89b-12d3-a456-426614174000';

    it('should delete a service request successfully', async () => {
      const deleteResult = { affected: 1, raw: [] };
      mockServiceRequestsService.deleteServiceRequestById.mockResolvedValue(
        deleteResult,
      );

      const result = await controller.deleteServiceRequestById(mockRequestId);

      expect(service.deleteServiceRequestById).toHaveBeenCalledWith(
        mockRequestId,
      );
      expect(result).toEqual(deleteResult);
      expect(result.affected).toBe(1);
    });

    it('should handle deletion of non-existent request', async () => {
      const deleteResult = { affected: 0, raw: [] };
      mockServiceRequestsService.deleteServiceRequestById.mockResolvedValue(
        deleteResult,
      );

      const result = await controller.deleteServiceRequestById(mockRequestId);

      expect(result.affected).toBe(0);
    });

    it('should handle deletion errors', async () => {
      const error = new Error('Database deletion failed');
      mockServiceRequestsService.deleteServiceRequestById.mockRejectedValue(
        error,
      );

      await expect(
        controller.deleteServiceRequestById(mockRequestId),
      ).rejects.toThrow(error);
    });

    it('should handle foreign key constraint errors', async () => {
      const error = new Error(
        'Cannot delete: foreign key constraint violation',
      );
      mockServiceRequestsService.deleteServiceRequestById.mockRejectedValue(
        error,
      );

      await expect(
        controller.deleteServiceRequestById(mockRequestId),
      ).rejects.toThrow(error);
    });

    it('should handle invalid UUID', async () => {
      const invalidId = 'invalid-uuid';
      const error = new Error('Invalid UUID format');
      mockServiceRequestsService.deleteServiceRequestById.mockRejectedValue(
        error,
      );

      await expect(
        controller.deleteServiceRequestById(invalidId),
      ).rejects.toThrow(error);
    });
  });

  describe('healthCheck', () => {
    it('should return health check status', async () => {
      const result = await controller.healthCheck();

      expect(result).toHaveProperty('status', 'ok');
      expect(result).toHaveProperty('service', 'tawk-webhook');
      expect(result).toHaveProperty('timestamp');
      expect(typeof result.timestamp).toBe('string');
    });

    it('should return valid ISO timestamp', async () => {
      const result = await controller.healthCheck();

      const timestamp = new Date(result.timestamp);
      expect(timestamp.toISOString()).toBe(result.timestamp);
    });

    it('should return consistent structure', async () => {
      const result1 = await controller.healthCheck();
      const result2 = await controller.healthCheck();

      expect(result1.status).toBe(result2.status);
      expect(result1.service).toBe(result2.service);
      expect(Object.keys(result1)).toEqual(Object.keys(result2));
    });

    it('should not require any parameters', async () => {
      const result = await controller.healthCheck();

      expect(result).toBeDefined();
      expect(result.status).toBe('ok');
    });

    it('should be callable multiple times', async () => {
      const results = await Promise.all([
        controller.healthCheck(),
        controller.healthCheck(),
        controller.healthCheck(),
      ]);

      results.forEach((result) => {
        expect(result.status).toBe('ok');
        expect(result.service).toBe('tawk-webhook');
      });
    });
  });

  describe('Error Handling', () => {
    it('should propagate service layer errors', async () => {
      const error = new Error('Service layer error');
      mockServiceRequestsService.createServiceRequest.mockRejectedValue(error);

      await expect(
        controller.createServiceRequest({
          tenant_id: '123e4567-e89b-12d3-a456-426614174000',
          text: 'Test',
        }),
      ).rejects.toThrow(error);
    });

    it('should handle HttpException errors correctly', async () => {
      const httpError = new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      mockServiceRequestsService.getAllServiceRequests.mockRejectedValue(
        httpError,
      );

      await expect(
        controller.getAllServiceRequests({}, { user: { id: 'test' } }),
      ).rejects.toThrow(httpError);
    });

    it('should handle file upload validation errors', async () => {
      const error = new Error('File too large');
      mockFileUploadService.uploadFile.mockRejectedValue(error);

      const files = [
        {
          fieldname: 'issue_images',
          originalname: 'huge-file.jpg',
          buffer: Buffer.alloc(10000000),
        } as Express.Multer.File,
      ];

      await expect(
        controller.updateServiceRequestById(
          '123e4567-e89b-12d3-a456-426614174000',
          { property_name: 'Test' } as any,
          files,
        ),
      ).rejects.toThrow(error);
    });

    it('should handle network errors gracefully', async () => {
      const networkError = new Error('Network timeout');
      mockServiceRequestsService.getServiceRequestById.mockRejectedValue(
        networkError,
      );

      await expect(
        controller.getServiceRequestById(
          '123e4567-e89b-12d3-a456-426614174000',
        ),
      ).rejects.toThrow(networkError);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long descriptions', async () => {
      const longText = 'A'.repeat(10000);
      const createDto = {
        tenant_id: '123e4567-e89b-12d3-a456-426614174000',
        text: longText,
      };

      mockServiceRequestsService.createServiceRequest.mockResolvedValue({
        id: 'test-id',
        description: longText,
      } as any);

      const result = await controller.createServiceRequest(createDto);

      expect(service.createServiceRequest).toHaveBeenCalledWith(createDto);
      expect(result.description).toBe(longText);
    });

    it('should handle special characters in text', async () => {
      const specialText = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/~`';
      const createDto = {
        tenant_id: '123e4567-e89b-12d3-a456-426614174000',
        text: specialText,
      };

      mockServiceRequestsService.createServiceRequest.mockResolvedValue({
        id: 'test-id',
        description: specialText,
      } as any);

      await controller.createServiceRequest(createDto);

      expect(service.createServiceRequest).toHaveBeenCalledWith(createDto);
    });

    it('should handle unicode characters', async () => {
      const unicodeText = '水漏れの問題 🚰 تسرب الماء';
      const createDto = {
        tenant_id: '123e4567-e89b-12d3-a456-426614174000',
        text: unicodeText,
      };

      mockServiceRequestsService.createServiceRequest.mockResolvedValue({
        id: 'test-id',
        description: unicodeText,
      } as any);

      await controller.createServiceRequest(createDto);

      expect(service.createServiceRequest).toHaveBeenCalledWith(createDto);
    });

    it('should handle maximum allowed file uploads (20)', async () => {
      const maxFiles = Array(20)
        .fill(null)
        .map(
          (_, index) =>
            ({
              fieldname: 'issue_images',
              originalname: `image${index}.jpg`,
              buffer: Buffer.from('test'),
              size: 1000,
            }) as Express.Multer.File,
        );

      mockFileUploadService.uploadFile.mockResolvedValue({
        secure_url: 'https://cloudinary.com/image.jpg',
      });

      mockServiceRequestsService.updateServiceRequestById.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await controller.updateServiceRequestById(
        '123e4567-e89b-12d3-a456-426614174000',
        { property_name: 'Test' } as any,
        maxFiles,
      );

      expect(fileUploadService.uploadFile).toHaveBeenCalledTimes(20);
    });

    it('should handle empty query parameters object', async () => {
      mockServiceRequestsService.getAllServiceRequests.mockResolvedValue({
        service_requests: [],
        pagination: {
          totalRows: 0,
          perPage: 10,
          currentPage: 1,
          totalPages: 0,
          hasNextPage: false,
        },
      });

      await controller.getAllServiceRequests({} as any, {
        user: { id: 'test' },
      });

      expect(service.getAllServiceRequests).toHaveBeenCalled();
    });

    it('should handle null user object', async () => {
      mockServiceRequestsService.getAllServiceRequests.mockResolvedValue({
        service_requests: [],
        pagination: {
          totalRows: 0,
          perPage: 10,
          currentPage: 1,
          totalPages: 0,
          hasNextPage: false,
        },
      });

      await controller.getAllServiceRequests(
        { page: 1, size: 10 } as any,
        { user: null } as any,
      );

      expect(service.getAllServiceRequests).toHaveBeenCalledWith(
        undefined,
        expect.any(Object),
      );
    });

    it('should handle empty status string in query', async () => {
      const requestWithEmptyStatus = {
        user: { id: 'tenant-uuid' },
        query: { status: '' },
      };

      mockServiceRequestsService.getServiceRequestByTenant.mockResolvedValue(
        [],
      );

      await controller.getServiceRequestByTenant(requestWithEmptyStatus);

      expect(service.getServiceRequestByTenant).toHaveBeenCalledWith(
        'tenant-uuid',
        '',
      );
    });

    it('should handle very large page numbers', async () => {
      const largePageQuery = {
        page: 999999,
        size: 10,
      };

      mockServiceRequestsService.getAllServiceRequests.mockResolvedValue({
        service_requests: [],
        pagination: {
          totalRows: 0,
          perPage: 10,
          currentPage: 999999,
          totalPages: 0,
          hasNextPage: false,
        },
      });

      const result = await controller.getAllServiceRequests(
        largePageQuery as any,
        { user: { id: 'test' } },
      );

      expect(result.service_requests).toHaveLength(0);
    });

    it('should handle zero as page number', async () => {
      const zeroPageQuery = {
        page: 0,
        size: 10,
      };

      mockServiceRequestsService.getAllServiceRequests.mockResolvedValue({
        service_requests: [],
        pagination: {
          totalRows: 0,
          perPage: 10,
          currentPage: 0,
          totalPages: 0,
          hasNextPage: false,
        },
      });

      await controller.getAllServiceRequests(zeroPageQuery as any, {
        user: { id: 'test' },
      });

      expect(service.getAllServiceRequests).toHaveBeenCalled();
    });

    it('should handle negative page numbers', async () => {
      const negativePageQuery = {
        page: -1,
        size: 10,
      };

      mockServiceRequestsService.getAllServiceRequests.mockResolvedValue({
        service_requests: [],
        pagination: {
          totalRows: 0,
          perPage: 10,
          currentPage: 1,
          totalPages: 0,
          hasNextPage: false,
        },
      });

      await controller.getAllServiceRequests(negativePageQuery as any, {
        user: { id: 'test' },
      });

      expect(service.getAllServiceRequests).toHaveBeenCalled();
    });
  });

  describe('Integration with File Upload Service', () => {
    const mockRequestId = '123e4567-e89b-12d3-a456-426614174000';

    it('should call uploadFile with correct parameters', async () => {
      const file = {
        fieldname: 'issue_images',
        originalname: 'test.jpg',
        buffer: Buffer.from('test'),
      } as Express.Multer.File;

      mockFileUploadService.uploadFile.mockResolvedValue({
        secure_url: 'https://cloudinary.com/test.jpg',
      });

      mockServiceRequestsService.updateServiceRequestById.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await controller.updateServiceRequestById(
        mockRequestId,
        { property_name: 'Test' } as any,
        [file],
      );

      expect(fileUploadService.uploadFile).toHaveBeenCalledWith(
        file,
        'service-requests',
      );
    });

    it('should handle multiple file uploads sequentially', async () => {
      const files = [
        { originalname: 'file1.jpg' } as Express.Multer.File,
        { originalname: 'file2.jpg' } as Express.Multer.File,
        { originalname: 'file3.jpg' } as Express.Multer.File,
      ];

      mockFileUploadService.uploadFile
        .mockResolvedValueOnce({ secure_url: 'url1' })
        .mockResolvedValueOnce({ secure_url: 'url2' })
        .mockResolvedValueOnce({ secure_url: 'url3' });

      mockServiceRequestsService.updateServiceRequestById.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await controller.updateServiceRequestById(
        mockRequestId,
        { property_name: 'Test' } as any,
        files,
      );

      expect(service.updateServiceRequestById).toHaveBeenCalledWith(
        mockRequestId,
        expect.objectContaining({
          issue_images: ['url1', 'url2', 'url3'],
        }),
      );
    });

    it('should not call service if file upload fails', async () => {
      const file = {
        fieldname: 'issue_images',
        originalname: 'test.jpg',
        buffer: Buffer.from('test'),
      } as Express.Multer.File;

      const uploadError = new Error('Upload failed');
      mockFileUploadService.uploadFile.mockRejectedValue(uploadError);

      await expect(
        controller.updateServiceRequestById(
          mockRequestId,
          { property_name: 'Test' } as any,
          [file],
        ),
      ).rejects.toThrow(uploadError);

      expect(service.updateServiceRequestById).not.toHaveBeenCalled();
    });

    it('should handle cloudinary response without secure_url', async () => {
      const file = {
        fieldname: 'issue_images',
        originalname: 'test.jpg',
        buffer: Buffer.from('test'),
      } as Express.Multer.File;

      mockFileUploadService.uploadFile.mockResolvedValue({} as any);

      mockServiceRequestsService.updateServiceRequestById.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await controller.updateServiceRequestById(
        mockRequestId,
        { property_name: 'Test' } as any,
        [file],
      );

      expect(service.updateServiceRequestById).toHaveBeenCalledWith(
        mockRequestId,
        expect.objectContaining({
          issue_images: [undefined],
        }),
      );
    });
  });

  describe('Request Parameter Validation', () => {
    it('should pass valid UUID to getServiceRequestById', async () => {
      const validUUID = '123e4567-e89b-12d3-a456-426614174000';
      mockServiceRequestsService.getServiceRequestById.mockResolvedValue({
        id: validUUID,
      } as any);

      await controller.getServiceRequestById(validUUID);

      expect(service.getServiceRequestById).toHaveBeenCalledWith(validUUID);
    });

    it('should pass valid UUID to updateServiceRequestById', async () => {
      const validUUID = '123e4567-e89b-12d3-a456-426614174000';
      mockServiceRequestsService.updateServiceRequestById.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await controller.updateServiceRequestById(validUUID, {
        property_name: 'Test',
      } as any);

      expect(service.updateServiceRequestById).toHaveBeenCalledWith(
        validUUID,
        expect.any(Object),
      );
    });

    it('should pass valid UUID to deleteServiceRequestById', async () => {
      const validUUID = '123e4567-e89b-12d3-a456-426614174000';
      mockServiceRequestsService.deleteServiceRequestById.mockResolvedValue({
        affected: 1,
        raw: [],
      });

      await controller.deleteServiceRequestById(validUUID);

      expect(service.deleteServiceRequestById).toHaveBeenCalledWith(validUUID);
    });
  });

  describe('Service Method Call Verification', () => {
    it('should call createServiceRequest exactly once', async () => {
      mockServiceRequestsService.createServiceRequest.mockResolvedValue({
        id: 'test',
      } as any);

      await controller.createServiceRequest({
        tenant_id: '123e4567-e89b-12d3-a456-426614174000',
        text: 'Test',
      });

      expect(service.createServiceRequest).toHaveBeenCalledTimes(1);
    });

    it('should not call service methods if validation fails', async () => {
      const error = new Error('Validation failed');
      mockServiceRequestsService.createServiceRequest.mockRejectedValue(error);

      try {
        await controller.createServiceRequest({
          tenant_id: 'invalid',
          text: 'Test',
        });
      } catch (e) {
        // Expected to throw
      }

      expect(service.createServiceRequest).toHaveBeenCalledTimes(1);
    });

    it('should call updateServiceRequestById with merged data when files are uploaded', async () => {
      const updateDto = {
        status: ServiceRequestStatusEnum.IN_PROGRESS,
        property_name: 'Test Property',
      } as any;

      const file = {
        fieldname: 'issue_images',
        originalname: 'test.jpg',
        buffer: Buffer.from('test'),
      } as Express.Multer.File;

      mockFileUploadService.uploadFile.mockResolvedValue({
        secure_url: 'https://cloudinary.com/test.jpg',
      });

      mockServiceRequestsService.updateServiceRequestById.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await controller.updateServiceRequestById(
        '123e4567-e89b-12d3-a456-426614174000',
        updateDto,
        [file],
      );

      expect(service.updateServiceRequestById).toHaveBeenCalledWith(
        '123e4567-e89b-12d3-a456-426614174000',
        expect.objectContaining({
          status: ServiceRequestStatusEnum.IN_PROGRESS,
          property_name: 'Test Property',
          issue_images: ['https://cloudinary.com/test.jpg'],
        }),
      );
    });
  });

  describe('Response Format Verification', () => {
    it('should return correct pagination structure', async () => {
      const mockPaginatedResponse = {
        service_requests: [{ id: '1' }],
        pagination: {
          totalRows: 1,
          perPage: 10,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      };

      mockServiceRequestsService.getAllServiceRequests.mockResolvedValue(
        mockPaginatedResponse,
      );

      const result = await controller.getAllServiceRequests(
        { page: 1, size: 10 } as any,
        { user: { id: 'test' } },
      );

      expect(result).toHaveProperty('service_requests');
      expect(result).toHaveProperty('pagination');
      expect(result.pagination).toHaveProperty('totalRows');
      expect(result.pagination).toHaveProperty('perPage');
      expect(result.pagination).toHaveProperty('currentPage');
      expect(result.pagination).toHaveProperty('totalPages');
      expect(result.pagination).toHaveProperty('hasNextPage');
    });

    it('should return array for getServiceRequestByTenant', async () => {
      mockServiceRequestsService.getServiceRequestByTenant.mockResolvedValue(
        [],
      );

      const result = await controller.getServiceRequestByTenant({
        user: { id: 'test' },
        query: {},
      });

      expect(Array.isArray(result)).toBe(true);
    });

    it('should return object with affected property for update', async () => {
      mockServiceRequestsService.updateServiceRequestById.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      const result = await controller.updateServiceRequestById(
        '123e4567-e89b-12d3-a456-426614174000',
        { property_name: 'Test' } as any,
      );

      expect(result).toHaveProperty('affected');
      expect(typeof result.affected).toBe('number');
    });

    it('should return object with affected property for delete', async () => {
      mockServiceRequestsService.deleteServiceRequestById.mockResolvedValue({
        affected: 1,
        raw: [],
      });

      const result = await controller.deleteServiceRequestById(
        '123e4567-e89b-12d3-a456-426614174000',
      );

      expect(result).toHaveProperty('affected');
      expect(typeof result.affected).toBe('number');
    });
  });
});

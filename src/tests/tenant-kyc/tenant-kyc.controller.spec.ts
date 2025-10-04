import { Test, TestingModule } from '@nestjs/testing';
import { TenantKycController } from 'src/tenant-kyc/tenant-kyc.controller';
import { TenantKycService } from 'src/tenant-kyc/tenant-kyc.service';
import { CreateTenantKycDto, UpdateTenantKycDto } from 'src/tenant-kyc/dto';
import {
  BulkDeleteTenantKycDto,
  ParseTenantKycQueryDto,
} from 'src/tenant-kyc/dto/others.dto';
import {
  Gender,
  MaritalStatus,
  EmploymentStatus,
} from 'src/tenant-kyc/entities/tenant-kyc.entity';

describe('TenantKycController', () => {
  let controller: TenantKycController;
  let service: TenantKycService;

  const mockTenantKycService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn(),
    deleteAll: jest.fn(),
  };

  const mockAdminId = '123e4567-e89b-12d3-a456-426614174000';
  const mockLandlordId = '123e4567-e89b-12d3-a456-426614174001';
  const mockKycId = '123e4567-e89b-12d3-a456-426614174002';

  const mockCreateDto: CreateTenantKycDto = {
    first_name: 'John',
    last_name: 'Doe',
    email: 'john.doe@example.com',
    phone_number: '+2348148696119',
    date_of_birth: '1996-04-22T11:03:13.157Z',
    gender: Gender.MALE,
    nationality: 'Nigerian',
    current_residence: 'Lagos',
    state_of_origin: 'Lagos',
    local_government_area: 'Ikeja',
    marital_status: MaritalStatus.SINGLE,
    religion: 'Christianity',
    employment_status: EmploymentStatus.EMPLOYED,
    occupation: 'Software Engineer',
    job_title: 'Senior Developer',
    employer_name: 'Tech Company',
    employer_address: '123 Tech Street',
    employer_phone_number: '+2348148696120',
    monthly_net_income: '500000',
    reference1_name: 'Jane Smith',
    reference1_address: '456 Reference St',
    reference1_relationship: 'Friend',
    reference1_phone_number: '+2348148696121',
    landlord_id: mockLandlordId,
  };

  const mockKycData = {
    id: mockKycId,
    ...mockCreateDto,
    created_at: new Date(),
    identity_hash: 'mock-hash',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantKycController],
      providers: [
        {
          provide: TenantKycService,
          useValue: mockTenantKycService,
        },
      ],
    }).compile();

    controller = module.get<TenantKycController>(TenantKycController);
    service = module.get<TenantKycService>(TenantKycService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a new tenant KYC record', async () => {
      mockTenantKycService.create.mockResolvedValue(undefined);

      await controller.create(mockCreateDto);

      expect(service.create).toHaveBeenCalledWith(mockCreateDto);
      expect(service.create).toHaveBeenCalledTimes(1);
    });

    it('should handle service errors', async () => {
      const error = new Error('Conflict');
      mockTenantKycService.create.mockRejectedValue(error);

      await expect(controller.create(mockCreateDto)).rejects.toThrow(error);
    });
  });

  describe('findAll', () => {
    const mockQuery: ParseTenantKycQueryDto = {
      page: 1,
      limit: 10,
      fields: 'id,first_name,email',
    };

    const mockResponse = {
      data: [mockKycData],
      pagination: {
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      },
    };

    it('should return paginated KYC records', async () => {
      mockTenantKycService.findAll.mockResolvedValue(mockResponse);

      const result = await controller.findAll(mockQuery, mockAdminId);

      expect(result).toEqual(mockResponse);
      expect(service.findAll).toHaveBeenCalledWith(mockAdminId, mockQuery);
      expect(service.findAll).toHaveBeenCalledTimes(1);
    });

    it('should handle empty results', async () => {
      const emptyResponse = {
        data: [],
        pagination: {
          page: 1,
          limit: 10,
          total: 0,
          totalPages: 0,
        },
      };
      mockTenantKycService.findAll.mockResolvedValue(emptyResponse);

      const result = await controller.findAll(mockQuery, mockAdminId);

      expect(result).toEqual(emptyResponse);
    });
  });

  describe('findOne', () => {
    it('should return a single KYC record', async () => {
      mockTenantKycService.findOne.mockResolvedValue(mockKycData);

      const result = await controller.findOne(mockKycId, mockAdminId);

      expect(result).toEqual(mockKycData);
      expect(service.findOne).toHaveBeenCalledWith(mockAdminId, mockKycId);
      expect(service.findOne).toHaveBeenCalledTimes(1);
    });

    it('should handle not found errors', async () => {
      const error = new Error('Not Found');
      mockTenantKycService.findOne.mockRejectedValue(error);

      await expect(controller.findOne(mockKycId, mockAdminId)).rejects.toThrow(
        error,
      );
    });
  });

  describe('update', () => {
    const mockUpdateDto: UpdateTenantKycDto = {
      first_name: 'Jane',
      email: 'jane.doe@example.com',
    };

    const updatedKycData = {
      ...mockKycData,
      ...mockUpdateDto,
    };

    it('should update a KYC record', async () => {
      mockTenantKycService.update.mockResolvedValue(updatedKycData);

      const result = await controller.update(
        mockKycId,
        mockUpdateDto,
        mockAdminId,
      );

      expect(result).toEqual(updatedKycData);
      expect(service.update).toHaveBeenCalledWith(
        mockAdminId,
        mockKycId,
        mockUpdateDto,
      );
      expect(service.update).toHaveBeenCalledTimes(1);
    });

    it('should handle update errors', async () => {
      const error = new Error('Not Found');
      mockTenantKycService.update.mockRejectedValue(error);

      await expect(
        controller.update(mockKycId, mockUpdateDto, mockAdminId),
      ).rejects.toThrow(error);
    });
  });

  describe('deleteOne', () => {
    it('should delete a single KYC record', async () => {
      mockTenantKycService.deleteOne.mockResolvedValue(undefined);

      await controller.deleteOne(mockKycId, mockAdminId);

      expect(service.deleteOne).toHaveBeenCalledWith(mockAdminId, mockKycId);
      expect(service.deleteOne).toHaveBeenCalledTimes(1);
    });

    it('should handle deletion errors', async () => {
      const error = new Error('Not Found');
      mockTenantKycService.deleteOne.mockRejectedValue(error);

      await expect(
        controller.deleteOne(mockKycId, mockAdminId),
      ).rejects.toThrow(error);
    });
  });

  describe('deleteMany', () => {
    const mockBulkDeleteDto: BulkDeleteTenantKycDto = {
      ids: [mockKycId, '123e4567-e89b-12d3-a456-426614174003'],
    };

    it('should delete multiple KYC records', async () => {
      mockTenantKycService.deleteMany.mockResolvedValue(undefined);

      await controller.deleteMany(mockBulkDeleteDto, mockAdminId);

      expect(service.deleteMany).toHaveBeenCalledWith(
        mockAdminId,
        mockBulkDeleteDto,
      );
      expect(service.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('should handle bulk deletion errors', async () => {
      const error = new Error('Deletion failed');
      mockTenantKycService.deleteMany.mockRejectedValue(error);

      await expect(
        controller.deleteMany(mockBulkDeleteDto, mockAdminId),
      ).rejects.toThrow(error);
    });
  });

  describe('deleteAll', () => {
    it('should delete all KYC records for admin', async () => {
      mockTenantKycService.deleteAll.mockResolvedValue(undefined);

      await controller.deleteAll(mockAdminId);

      expect(service.deleteAll).toHaveBeenCalledWith(mockAdminId);
      expect(service.deleteAll).toHaveBeenCalledTimes(1);
    });

    it('should handle delete all errors', async () => {
      const error = new Error('Deletion failed');
      mockTenantKycService.deleteAll.mockRejectedValue(error);

      await expect(controller.deleteAll(mockAdminId)).rejects.toThrow(error);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpException, HttpStatus } from '@nestjs/common';
import { PropertyHistoryService } from 'src/property-history/property-history.service';
import {
  PropertyHistory,
  MoveOutReasonEnum,
} from 'src/property-history/entities/property-history.entity';
import {
  CreatePropertyHistoryDto,
  PropertyHistoryFilter,
} from 'src/property-history/dto/create-property-history.dto';
import { UpdatePropertyHistoryDto } from 'src/property-history/dto/update-property-history.dto';
import * as queryFilter from 'src/filters/query-filter';

jest.mock('src/filters/query-filter');

describe('PropertyHistoryService', () => {
  let service: PropertyHistoryService;
  let repository: Repository<PropertyHistory>;

  const mockPropertyHistory: Partial<PropertyHistory> = {
    id: '90b7f325-be27-45a7-9688-fa49630cac8f',
    property_id: '90b7f325-be27-45a7-9688-fa49630cac8f',
    tenant_id: '80b7f325-be27-45a7-9688-fa49630cac8f',
    move_in_date: new Date('2024-01-01'),
    move_out_date: new Date('2024-12-31'),
    move_out_reason: MoveOutReasonEnum.LEASE_ENDED,
    owner_comment: 'Great tenant',
    tenant_comment: 'Wonderful property',
    monthly_rent: 50000,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockRepository = {
    save: jest.fn(),
    findAndCount: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PropertyHistoryService,
        {
          provide: getRepositoryToken(PropertyHistory),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<PropertyHistoryService>(PropertyHistoryService);
    repository = module.get<Repository<PropertyHistory>>(
      getRepositoryToken(PropertyHistory),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPropertyHistory', () => {
    it('should create a property history successfully', async () => {
      const createDto: CreatePropertyHistoryDto = {
        property_id: '90b7f325-be27-45a7-9688-fa49630cac8f',
        tenant_id: '80b7f325-be27-45a7-9688-fa49630cac8f',
        move_in_date: '2024-01-01',
        move_out_date: '2024-12-31',
        move_out_reason: MoveOutReasonEnum.LEASE_ENDED,
        owner_comment: 'Great tenant',
        tenant_comment: 'Wonderful property',
        monthly_rent: 50000,
      };

      mockRepository.save.mockResolvedValue(mockPropertyHistory);

      const result = await service.createPropertyHistory(createDto);

      expect(result).toEqual(mockPropertyHistory);
      expect(mockRepository.save).toHaveBeenCalledWith(createDto);
      expect(mockRepository.save).toHaveBeenCalledTimes(1);
    });

    it('should create property history without optional fields', async () => {
      const minimalDto: CreatePropertyHistoryDto = {
        property_id: '90b7f325-be27-45a7-9688-fa49630cac8f',
        tenant_id: '80b7f325-be27-45a7-9688-fa49630cac8f',
        move_in_date: '2024-01-01',
        monthly_rent: 50000,
      };

      const minimalHistory = { ...mockPropertyHistory, ...minimalDto };
      mockRepository.save.mockResolvedValue(minimalHistory);

      const result = await service.createPropertyHistory(minimalDto);

      expect(result).toEqual(minimalHistory);
      expect(mockRepository.save).toHaveBeenCalledWith(minimalDto);
    });
  });

  describe('getAllPropertyHistories', () => {
    it('should return paginated property histories with default pagination', async () => {
      const queryParams: PropertyHistoryFilter = {};
      const mockQuery = {};

      (queryFilter.buildPropertyHistoryFilter as jest.Mock).mockResolvedValue(
        mockQuery,
      );
      mockRepository.findAndCount.mockResolvedValue([[mockPropertyHistory], 1]);

      const result = await service.getAllPropertyHistories(queryParams);

      expect(result).toEqual({
        property_histories: [mockPropertyHistory],
        pagination: {
          totalRows: 1,
          perPage: 20,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      });
      expect(queryFilter.buildPropertyHistoryFilter).toHaveBeenCalledWith(
        queryParams,
      );
      expect(mockRepository.findAndCount).toHaveBeenCalledWith({
        where: mockQuery,
        relations: ['property', 'tenant'],
        skip: 0,
        take: 20,
        order: { created_at: 'DESC' },
      });
    });

    it('should return paginated property histories with custom pagination', async () => {
      const queryParams: PropertyHistoryFilter = { page: 2, size: 10 };
      const mockQuery = {};
      const mockHistories = Array(10).fill(mockPropertyHistory);

      (queryFilter.buildPropertyHistoryFilter as jest.Mock).mockResolvedValue(
        mockQuery,
      );
      mockRepository.findAndCount.mockResolvedValue([mockHistories, 25]);

      const result = await service.getAllPropertyHistories(queryParams);

      expect(result).toEqual({
        property_histories: mockHistories,
        pagination: {
          totalRows: 25,
          perPage: 10,
          currentPage: 2,
          totalPages: 3,
          hasNextPage: true,
        },
      });
      expect(mockRepository.findAndCount).toHaveBeenCalledWith({
        where: mockQuery,
        relations: ['property', 'tenant'],
        skip: 10,
        take: 10,
        order: { created_at: 'DESC' },
      });
    });

    it('should handle filtering by property_id', async () => {
      const queryParams: PropertyHistoryFilter = {
        property_id: '90b7f325-be27-45a7-9688-fa49630cac8f',
        page: 1,
        size: 10,
      };
      const mockQuery = { property_id: '90b7f325-be27-45a7-9688-fa49630cac8f' };

      (queryFilter.buildPropertyHistoryFilter as jest.Mock).mockResolvedValue(
        mockQuery,
      );
      mockRepository.findAndCount.mockResolvedValue([[mockPropertyHistory], 1]);

      const result = await service.getAllPropertyHistories(queryParams);

      expect(result.property_histories).toEqual([mockPropertyHistory]);
      expect(queryFilter.buildPropertyHistoryFilter).toHaveBeenCalledWith(
        queryParams,
      );
    });

    it('should return empty array when no histories found', async () => {
      const queryParams: PropertyHistoryFilter = { page: 1, size: 10 };
      const mockQuery = {};

      (queryFilter.buildPropertyHistoryFilter as jest.Mock).mockResolvedValue(
        mockQuery,
      );
      mockRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getAllPropertyHistories(queryParams);

      expect(result).toEqual({
        property_histories: [],
        pagination: {
          totalRows: 0,
          perPage: 10,
          currentPage: 1,
          totalPages: 0,
          hasNextPage: false,
        },
      });
    });

    it('should calculate pagination correctly for last page', async () => {
      const queryParams: PropertyHistoryFilter = { page: 3, size: 10 };
      const mockQuery = {};
      const mockHistories = Array(5).fill(mockPropertyHistory);

      (queryFilter.buildPropertyHistoryFilter as jest.Mock).mockResolvedValue(
        mockQuery,
      );
      mockRepository.findAndCount.mockResolvedValue([mockHistories, 25]);

      const result = await service.getAllPropertyHistories(queryParams);

      expect(result.pagination).toEqual({
        totalRows: 25,
        perPage: 10,
        currentPage: 3,
        totalPages: 3,
        hasNextPage: false,
      });
    });
  });

  describe('getPropertyHistoryById', () => {
    const validId = '90b7f325-be27-45a7-9688-fa49630cac8f';

    it('should return property history by id', async () => {
      mockRepository.findOne.mockResolvedValue(mockPropertyHistory);

      const result = await service.getPropertyHistoryById(validId);

      expect(result).toEqual(mockPropertyHistory);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: validId },
        relations: ['property', 'tenant'],
      });
      expect(mockRepository.findOne).toHaveBeenCalledTimes(1);
    });

    it('should throw HttpException when property history not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.getPropertyHistoryById(validId)).rejects.toThrow(
        new HttpException(
          `Property history with id: ${validId} not found`,
          HttpStatus.NOT_FOUND,
        ),
      );
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: validId },
        relations: ['property', 'tenant'],
      });
    });

    it('should throw HttpException when property history has no id', async () => {
      mockRepository.findOne.mockResolvedValue({});

      await expect(service.getPropertyHistoryById(validId)).rejects.toThrow(
        new HttpException(
          `Property history with id: ${validId} not found`,
          HttpStatus.NOT_FOUND,
        ),
      );
    });
  });

  describe('updatePropertyHistoryById', () => {
    const validId = '90b7f325-be27-45a7-9688-fa49630cac8f';
    const updateDto: UpdatePropertyHistoryDto = {
      monthly_rent: 60000,
      move_out_date: '2025-01-31',
    };

    it('should update property history successfully', async () => {
      const updateResult = { affected: 1, raw: [], generatedMaps: [] };
      mockRepository.findOne.mockResolvedValue(mockPropertyHistory);
      mockRepository.update.mockResolvedValue(updateResult);

      const result = await service.updatePropertyHistoryById(
        validId,
        updateDto,
      );

      expect(result).toEqual(updateResult);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: validId },
        relations: ['property', 'tenant'],
      });
      expect(mockRepository.update).toHaveBeenCalledWith(validId, updateDto);
    });

    it('should throw error if property history not found before update', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updatePropertyHistoryById(validId, updateDto),
      ).rejects.toThrow(
        new HttpException(
          `Property history with id: ${validId} not found`,
          HttpStatus.NOT_FOUND,
        ),
      );
      expect(mockRepository.update).not.toHaveBeenCalled();
    });

    it('should handle partial updates', async () => {
      const partialUpdate: UpdatePropertyHistoryDto = {
        owner_comment: 'Updated comment',
      };
      const updateResult = { affected: 1, raw: [], generatedMaps: [] };
      mockRepository.findOne.mockResolvedValue(mockPropertyHistory);
      mockRepository.update.mockResolvedValue(updateResult);

      const result = await service.updatePropertyHistoryById(
        validId,
        partialUpdate,
      );

      expect(result).toEqual(updateResult);
      expect(mockRepository.update).toHaveBeenCalledWith(
        validId,
        partialUpdate,
      );
    });
  });

  describe('deletePropertyHistoryById', () => {
    const validId = '90b7f325-be27-45a7-9688-fa49630cac8f';

    it('should delete property history successfully', async () => {
      const deleteResult = { affected: 1, raw: [] };
      mockRepository.findOne.mockResolvedValue(mockPropertyHistory);
      mockRepository.delete.mockResolvedValue(deleteResult);

      const result = await service.deletePropertyHistoryById(validId);

      expect(result).toEqual(deleteResult);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: validId },
        relations: ['property', 'tenant'],
      });
      expect(mockRepository.delete).toHaveBeenCalledWith(validId);
    });

    it('should throw error if property history not found before delete', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.deletePropertyHistoryById(validId)).rejects.toThrow(
        new HttpException(
          `Property history with id: ${validId} not found`,
          HttpStatus.NOT_FOUND,
        ),
      );
      expect(mockRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('getPropertyHistoryByTenantId', () => {
    const tenantId = '80b7f325-be27-45a7-9688-fa49630cac8f';
    const propertyId = '90b7f325-be27-45a7-9688-fa49630cac8f';

    it('should return property histories for tenant and property with default pagination', async () => {
      const queryParams: PropertyHistoryFilter = {};
      mockRepository.findAndCount.mockResolvedValue([[mockPropertyHistory], 1]);

      const result = await service.getPropertyHistoryByTenantId(
        tenantId,
        propertyId,
        queryParams,
      );

      expect(result).toEqual({
        property_histories: [mockPropertyHistory],
        pagination: {
          totalRows: 1,
          perPage: 10,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      });
      expect(mockRepository.findAndCount).toHaveBeenCalledWith({
        where: { tenant_id: tenantId, property_id: propertyId },
        skip: 0,
        take: 10,
        order: { created_at: 'DESC' },
      });
    });

    it('should return property histories with custom pagination', async () => {
      const queryParams: PropertyHistoryFilter = { page: 2, size: 5 };
      const mockHistories = Array(5).fill(mockPropertyHistory);
      mockRepository.findAndCount.mockResolvedValue([mockHistories, 12]);

      const result = await service.getPropertyHistoryByTenantId(
        tenantId,
        propertyId,
        queryParams,
      );

      expect(result).toEqual({
        property_histories: mockHistories,
        pagination: {
          totalRows: 12,
          perPage: 5,
          currentPage: 2,
          totalPages: 3,
          hasNextPage: true,
        },
      });
      expect(mockRepository.findAndCount).toHaveBeenCalledWith({
        where: { tenant_id: tenantId, property_id: propertyId },
        skip: 5,
        take: 5,
        order: { created_at: 'DESC' },
      });
    });

    it('should return empty array when no histories found for tenant and property', async () => {
      const queryParams: PropertyHistoryFilter = { page: 1, size: 10 };
      mockRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getPropertyHistoryByTenantId(
        tenantId,
        propertyId,
        queryParams,
      );

      expect(result).toEqual({
        property_histories: [],
        pagination: {
          totalRows: 0,
          perPage: 10,
          currentPage: 1,
          totalPages: 0,
          hasNextPage: false,
        },
      });
    });

    it('should handle last page correctly', async () => {
      const queryParams: PropertyHistoryFilter = { page: 2, size: 10 };
      const mockHistories = Array(3).fill(mockPropertyHistory);
      mockRepository.findAndCount.mockResolvedValue([mockHistories, 13]);

      const result = await service.getPropertyHistoryByTenantId(
        tenantId,
        propertyId,
        queryParams,
      );

      expect(result.pagination).toEqual({
        totalRows: 13,
        perPage: 10,
        currentPage: 2,
        totalPages: 2,
        hasNextPage: false,
      });
    });
  });
});

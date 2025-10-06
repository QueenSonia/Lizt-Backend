import { Test, TestingModule } from '@nestjs/testing';
import { PropertyHistoryController } from 'src/property-history/property-history.controller';
import { PropertyHistoryService } from 'src/property-history/property-history.service';
import {
  PropertyHistoryFilter,
  CreatePropertyHistoryDto,
} from 'src/property-history/dto/create-property-history.dto';
import { UpdatePropertyHistoryDto } from 'src/property-history/dto/update-property-history.dto';
import { MoveOutReasonEnum } from 'src/property-history/entities/property-history.entity';

describe('PropertyHistoryController', () => {
  let controller: PropertyHistoryController;
  let service: PropertyHistoryService;

  const mockPropertyHistoryService = {
    createPropertyHistory: jest.fn(),
    getAllPropertyHistories: jest.fn(),
    getPropertyHistoryById: jest.fn(),
    updatePropertyHistoryById: jest.fn(),
    deletePropertyHistoryById: jest.fn(),
    getPropertyHistoryByTenantId: jest.fn(),
  };

  const mockPropertyHistory: CreatePropertyHistoryDto = {
    property_id: '90b7f325-be27-45a7-9688-fa49630cac8f',
    tenant_id: '80b7f325-be27-45a7-9688-fa49630cac8f',
    move_in_date: '2024-01-01',
    move_out_date: '2024-12-31',
    move_out_reason: MoveOutReasonEnum.LEASE_ENDED,
    owner_comment: 'Great tenant',
    tenant_comment: 'Wonderful property',
    monthly_rent: 50000,
  };

  const mockPaginatedResponse = {
    property_histories: [mockPropertyHistory],
    pagination: {
      totalRows: 1,
      perPage: 10,
      currentPage: 1,
      totalPages: 1,
      hasNextPage: false,
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PropertyHistoryController],
      providers: [
        {
          provide: PropertyHistoryService,
          useValue: mockPropertyHistoryService,
        },
      ],
    }).compile();

    controller = module.get<PropertyHistoryController>(
      PropertyHistoryController,
    );
    service = module.get<PropertyHistoryService>(PropertyHistoryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createPropertyHistory', () => {
    it('should create a property history successfully', async () => {
      mockPropertyHistoryService.createPropertyHistory.mockResolvedValue(
        mockPropertyHistory,
      );

      const result =
        await controller.createPropertyHistory(mockPropertyHistory);

      expect(result).toEqual(mockPropertyHistory);
      expect(service.createPropertyHistory).toHaveBeenCalledWith(
        mockPropertyHistory,
      );
      expect(service.createPropertyHistory).toHaveBeenCalledTimes(1);
    });

    it('should throw an error if service fails', async () => {
      const error = new Error('Database error');
      mockPropertyHistoryService.createPropertyHistory.mockRejectedValue(error);

      await expect(
        controller.createPropertyHistory(mockPropertyHistory),
      ).rejects.toThrow(error);
      expect(service.createPropertyHistory).toHaveBeenCalledWith(
        mockPropertyHistory,
      );
    });
  });

  describe('getAllPropertyHistories', () => {
    it('should return all property histories with pagination', async () => {
      const query: PropertyHistoryFilter = { page: 1, size: 10 };
      mockPropertyHistoryService.getAllPropertyHistories.mockResolvedValue(
        mockPaginatedResponse,
      );

      const result = await controller.getAllPropertyHistories(query);

      expect(result).toEqual(mockPaginatedResponse);
      expect(service.getAllPropertyHistories).toHaveBeenCalledWith(query);
      expect(service.getAllPropertyHistories).toHaveBeenCalledTimes(1);
    });

    it('should return filtered property histories by property_id', async () => {
      const query: PropertyHistoryFilter = {
        property_id: '90b7f325-be27-45a7-9688-fa49630cac8f',
        page: 1,
        size: 10,
      };
      mockPropertyHistoryService.getAllPropertyHistories.mockResolvedValue(
        mockPaginatedResponse,
      );

      const result = await controller.getAllPropertyHistories(query);

      expect(result).toEqual(mockPaginatedResponse);
      expect(service.getAllPropertyHistories).toHaveBeenCalledWith(query);
    });

    it('should return filtered property histories by tenant_id', async () => {
      const query: PropertyHistoryFilter = {
        tenant_id: '80b7f325-be27-45a7-9688-fa49630cac8f',
        page: 1,
        size: 10,
      };
      mockPropertyHistoryService.getAllPropertyHistories.mockResolvedValue(
        mockPaginatedResponse,
      );

      const result = await controller.getAllPropertyHistories(query);

      expect(result).toEqual(mockPaginatedResponse);
      expect(service.getAllPropertyHistories).toHaveBeenCalledWith(query);
    });

    it('should handle errors from service', async () => {
      const query: PropertyHistoryFilter = { page: 1, size: 10 };
      const error = new Error('Service error');
      mockPropertyHistoryService.getAllPropertyHistories.mockRejectedValue(
        error,
      );

      await expect(controller.getAllPropertyHistories(query)).rejects.toThrow(
        error,
      );
    });
  });

  describe('getPropertyHistoryById', () => {
    const validId = '90b7f325-be27-45a7-9688-fa49630cac8f';

    it('should return a property history by id', async () => {
      mockPropertyHistoryService.getPropertyHistoryById.mockResolvedValue(
        mockPropertyHistory,
      );

      const result = await controller.getPropertyHistoryById(validId);

      expect(result).toEqual(mockPropertyHistory);
      expect(service.getPropertyHistoryById).toHaveBeenCalledWith(validId);
      expect(service.getPropertyHistoryById).toHaveBeenCalledTimes(1);
    });

    it('should throw an error if property history not found', async () => {
      const error = new Error('Property history not found');
      mockPropertyHistoryService.getPropertyHistoryById.mockRejectedValue(
        error,
      );

      await expect(controller.getPropertyHistoryById(validId)).rejects.toThrow(
        error,
      );
      expect(service.getPropertyHistoryById).toHaveBeenCalledWith(validId);
    });
  });

  describe('updatePropertyHistoryById', () => {
    const validId = '90b7f325-be27-45a7-9688-fa49630cac8f';
    const updateDto: UpdatePropertyHistoryDto = {
      monthly_rent: 60000,
      move_out_date: '2025-01-31',
    };

    it('should update a property history successfully', async () => {
      const updateResult = { affected: 1 };
      mockPropertyHistoryService.updatePropertyHistoryById.mockResolvedValue(
        updateResult,
      );

      const result = await controller.updatePropertyHistoryById(
        validId,
        updateDto,
      );

      expect(result).toEqual(updateResult);
      expect(service.updatePropertyHistoryById).toHaveBeenCalledWith(
        validId,
        updateDto,
      );
      expect(service.updatePropertyHistoryById).toHaveBeenCalledTimes(1);
    });

    it('should throw an error if property history not found', async () => {
      const error = new Error('Property history not found');
      mockPropertyHistoryService.updatePropertyHistoryById.mockRejectedValue(
        error,
      );

      await expect(
        controller.updatePropertyHistoryById(validId, updateDto),
      ).rejects.toThrow(error);
    });

    it('should handle partial updates', async () => {
      const partialUpdate: UpdatePropertyHistoryDto = {
        owner_comment: 'Updated comment',
      };
      const updateResult = { affected: 1 };
      mockPropertyHistoryService.updatePropertyHistoryById.mockResolvedValue(
        updateResult,
      );

      const result = await controller.updatePropertyHistoryById(
        validId,
        partialUpdate,
      );

      expect(result).toEqual(updateResult);
      expect(service.updatePropertyHistoryById).toHaveBeenCalledWith(
        validId,
        partialUpdate,
      );
    });
  });

  describe('deletePropertyHistoryById', () => {
    const validId = '90b7f325-be27-45a7-9688-fa49630cac8f';

    it('should delete a property history successfully', async () => {
      const deleteResult = { affected: 1 };
      mockPropertyHistoryService.deletePropertyHistoryById.mockResolvedValue(
        deleteResult,
      );

      const result = await controller.deletePropertyHistoryById(validId);

      expect(result).toEqual(deleteResult);
      expect(service.deletePropertyHistoryById).toHaveBeenCalledWith(validId);
      expect(service.deletePropertyHistoryById).toHaveBeenCalledTimes(1);
    });

    it('should throw an error if property history not found', async () => {
      const error = new Error('Property history not found');
      mockPropertyHistoryService.deletePropertyHistoryById.mockRejectedValue(
        error,
      );

      await expect(
        controller.deletePropertyHistoryById(validId),
      ).rejects.toThrow(error);
      expect(service.deletePropertyHistoryById).toHaveBeenCalledWith(validId);
    });
  });

  describe('getServiceRequestsByTenantAndProperty', () => {
    const propertyId = '90b7f325-be27-45a7-9688-fa49630cac8f';
    const tenantId = '80b7f325-be27-45a7-9688-fa49630cac8f';
    const query: PropertyHistoryFilter = { page: 1, size: 10 };
    const mockRequest = {
      user: {
        id: tenantId,
      },
    };

    it('should return property histories for tenant and property', async () => {
      mockPropertyHistoryService.getPropertyHistoryByTenantId.mockResolvedValue(
        mockPaginatedResponse,
      );

      const result = await controller.getServiceRequestsByTenantAndProperty(
        propertyId,
        query,
        mockRequest,
      );

      expect(result).toEqual(mockPaginatedResponse);
      expect(service.getPropertyHistoryByTenantId).toHaveBeenCalledWith(
        tenantId,
        propertyId,
        query,
      );
      expect(service.getPropertyHistoryByTenantId).toHaveBeenCalledTimes(1);
    });

    it('should handle empty results', async () => {
      const emptyResponse = {
        property_histories: [],
        pagination: {
          totalRows: 0,
          perPage: 10,
          currentPage: 1,
          totalPages: 0,
          hasNextPage: false,
        },
      };
      mockPropertyHistoryService.getPropertyHistoryByTenantId.mockResolvedValue(
        emptyResponse,
      );

      const result = await controller.getServiceRequestsByTenantAndProperty(
        propertyId,
        query,
        mockRequest,
      );

      expect(result).toEqual(emptyResponse);
      expect(result.property_histories).toHaveLength(0);
    });

    it('should throw an error if service fails', async () => {
      const error = new Error('Database error');
      mockPropertyHistoryService.getPropertyHistoryByTenantId.mockRejectedValue(
        error,
      );

      await expect(
        controller.getServiceRequestsByTenantAndProperty(
          propertyId,
          query,
          mockRequest,
        ),
      ).rejects.toThrow(error);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { PropertiesController } from 'src/properties/properties.controller';
import { PropertiesService } from 'src/properties/properties.service';
import { FileUploadService } from 'src/utils/cloudinary';
import {
  CreatePropertyDto,
  PropertyStatusEnum,
} from 'src/properties/dto/create-property.dto';
import { UpdatePropertyDto } from 'src/properties/dto/update-property.dto';
import {
  MoveTenantInDto,
  MoveTenantOutDto,
} from 'src/properties/dto/move-tenant.dto';
import { CreatePropertyGroupDto } from 'src/properties/dto/create-property-group.dto';
import { AssignTenantDto } from 'src/properties/dto/assign-tenant.dto';

describe('PropertiesController', () => {
  let controller: PropertiesController;
  let propertiesService: PropertiesService;
  let fileUploadService: FileUploadService;

  const mockPropertiesService = {
    createProperty: jest.fn(),
    getAllProperties: jest.fn(),
    getVacantProperty: jest.fn(),
    getAllPropertyGroups: jest.fn(),
    getPropertyById: jest.fn(),
    getRentsOfAProperty: jest.fn(),
    getServiceRequestOfAProperty: jest.fn(),
    updatePropertyById: jest.fn(),
    deletePropertyById: jest.fn(),
    getAdminDashboardStats: jest.fn(),
    moveTenantIn: jest.fn(),
    moveTenantOut: jest.fn(),
    createPropertyGroup: jest.fn(),
    getPropertyGroupById: jest.fn(),
    assignTenant: jest.fn(),
  };

  const mockFileUploadService = {
    uploadFile: jest.fn(),
  };

  const mockRequest = {
    user: {
      id: 'user-id',
      email: 'test@example.com',
      role: 'landlord',
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PropertiesController],
      providers: [
        {
          provide: PropertiesService,
          useValue: mockPropertiesService,
        },
        {
          provide: FileUploadService,
          useValue: mockFileUploadService,
        },
      ],
    }).compile();

    controller = module.get<PropertiesController>(PropertiesController);
    propertiesService = module.get<PropertiesService>(PropertiesService);
    fileUploadService = module.get<FileUploadService>(FileUploadService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createProperty', () => {
    it('should create a property successfully', async () => {
      const createPropertyDto: CreatePropertyDto = {
        name: 'Test Property',
        location: 'Lagos',
        description: 'A test property',
        property_type: 'Duplex',
        no_of_bedrooms: 3,
      };

      const expectedResult = {
        id: 'property-id',
        ...createPropertyDto,
        owner_id: 'user-id',
      };

      mockPropertiesService.createProperty.mockResolvedValue(expectedResult);

      const result = await controller.createProperty(
        createPropertyDto,
        mockRequest,
      );

      expect(mockPropertiesService.createProperty).toHaveBeenCalledWith({
        owner_id: 'user-id',
        ...createPropertyDto,
      });
      expect(result).toEqual(expectedResult);
    });

    it('should handle errors when creating property', async () => {
      const createPropertyDto: CreatePropertyDto = {
        name: 'Test Property',
        location: 'Lagos',
        description: 'A test property',
        property_type: 'Duplex',
        no_of_bedrooms: 3,
      };

      const error = new Error('Creation failed');
      mockPropertiesService.createProperty.mockRejectedValue(error);

      await expect(
        controller.createProperty(createPropertyDto, mockRequest),
      ).rejects.toThrow(error);
    });
  });

  describe('getAllProperties', () => {
    it('should return paginated properties', async () => {
      const query = {
        page: 1,
        size: 10,
      };

      const expectedResult = {
        properties: [
          { id: 'prop-1', name: 'Property 1' },
          { id: 'prop-2', name: 'Property 2' },
        ],
        pagination: {
          totalRows: 2,
          perPage: 10,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      };

      mockPropertiesService.getAllProperties.mockResolvedValue(expectedResult);

      const result = await controller.getAllProperties(query, mockRequest);

      expect(mockPropertiesService.getAllProperties).toHaveBeenCalledWith({
        ...query,
        owner_id: 'user-id',
      });
      expect(result).toEqual(expectedResult);
    });

    it('should handle query parameters correctly', async () => {
      const query = {
        page: 2,
        size: 20,
        name: 'Test',
        property_status: PropertyStatusEnum.VACANT,
        location: 'Lagos',
      };

      mockPropertiesService.getAllProperties.mockResolvedValue({
        properties: [],
        pagination: {
          totalRows: 0,
          perPage: 20,
          currentPage: 2,
          totalPages: 0,
          hasNextPage: false,
        },
      });

      await controller.getAllProperties(query, mockRequest);

      expect(mockPropertiesService.getAllProperties).toHaveBeenCalledWith({
        ...query,
        owner_id: 'user-id',
      });
    });
  });

  describe('getVacantProperty', () => {
    it('should return vacant properties for the owner', async () => {
      const query = { owner_id: 'dummy-id' };
      const expectedResult = [
        { id: 'prop-1', property_status: PropertyStatusEnum.VACANT },
      ];

      mockPropertiesService.getVacantProperty.mockResolvedValue(expectedResult);

      const result = await controller.getVacantProperty(query, mockRequest);

      expect(mockPropertiesService.getVacantProperty).toHaveBeenCalledWith({
        owner_id: 'user-id',
      });
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getAllPropertyGroups', () => {
    it('should return all property groups for the owner', async () => {
      const expectedResult = {
        property_groups: [
          {
            id: 'group-1',
            name: 'Luxury Properties',
            properties: [],
          },
        ],
        total: 1,
      };

      mockPropertiesService.getAllPropertyGroups.mockResolvedValue(
        expectedResult,
      );

      const result = await controller.getAllPropertyGroups(mockRequest);

      expect(mockPropertiesService.getAllPropertyGroups).toHaveBeenCalledWith(
        'user-id',
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getPropertyById', () => {
    it('should return a property by id', async () => {
      const propertyId = 'property-id';
      const expectedResult = {
        id: propertyId,
        name: 'Test Property',
        location: 'Lagos',
      };

      mockPropertiesService.getPropertyById.mockResolvedValue(expectedResult);

      const result = await controller.getPropertyById(propertyId);

      expect(mockPropertiesService.getPropertyById).toHaveBeenCalledWith(
        propertyId,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle errors when property not found', async () => {
      const propertyId = 'non-existent-id';
      const error = new Error('Property not found');

      mockPropertiesService.getPropertyById.mockRejectedValue(error);

      await expect(controller.getPropertyById(propertyId)).rejects.toThrow(
        error,
      );
    });
  });

  describe('getRentsOfAProperty', () => {
    it('should return rents for a property', async () => {
      const propertyId = 'property-id';
      const expectedResult = {
        id: propertyId,
        name: 'Test Property',
        rents: [{ id: 'rent-1', rental_price: 500000 }],
      };

      mockPropertiesService.getRentsOfAProperty.mockResolvedValue(
        expectedResult,
      );

      const result = await controller.getRentsOfAProperty(propertyId);

      expect(mockPropertiesService.getRentsOfAProperty).toHaveBeenCalledWith(
        propertyId,
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getServiceRequestOfAProperty', () => {
    it('should return service requests for a property', async () => {
      const propertyId = 'property-id';
      const expectedResult = {
        id: propertyId,
        name: 'Test Property',
        service_requests: [{ id: 'request-1', status: 'pending' }],
      };

      mockPropertiesService.getServiceRequestOfAProperty.mockResolvedValue(
        expectedResult,
      );

      const result = await controller.getServiceRequestOfAProperty(propertyId);

      expect(
        mockPropertiesService.getServiceRequestOfAProperty,
      ).toHaveBeenCalledWith(propertyId);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('updatePropertyById', () => {
    it('should update a property successfully', async () => {
      const propertyId = 'property-id';
      const updatePropertyDto: UpdatePropertyDto = {
        name: 'Updated Property',
        location: 'Abuja',
        no_of_bedrooms: 4,
      };

      mockPropertiesService.updatePropertyById.mockResolvedValue({
        affected: 1,
      });

      const result = await controller.updatePropertyById(
        propertyId,
        updatePropertyDto,
      );

      expect(mockPropertiesService.updatePropertyById).toHaveBeenCalledWith(
        propertyId,
        updatePropertyDto,
      );
      expect(result).toEqual({ affected: 1 });
    });

    it('should handle update errors', async () => {
      const propertyId = 'property-id';
      const updatePropertyDto: UpdatePropertyDto = {
        name: 'Updated Property',
      };
      const error = new Error('Update failed');

      mockPropertiesService.updatePropertyById.mockRejectedValue(error);

      await expect(
        controller.updatePropertyById(propertyId, updatePropertyDto),
      ).rejects.toThrow(error);
    });
  });

  describe('deletePropertyById', () => {
    it('should delete a property successfully', async () => {
      const propertyId = 'property-id';

      mockPropertiesService.deletePropertyById.mockResolvedValue({
        affected: 1,
      });

      const result = await controller.deletePropertyById(propertyId);

      expect(mockPropertiesService.deletePropertyById).toHaveBeenCalledWith(
        propertyId,
      );
      expect(result).toEqual({ affected: 1 });
    });

    it('should handle deletion errors', async () => {
      const propertyId = 'property-id';
      const error = new Error('Cannot delete occupied property');

      mockPropertiesService.deletePropertyById.mockRejectedValue(error);

      await expect(controller.deletePropertyById(propertyId)).rejects.toThrow(
        error,
      );
    });
  });

  describe('getAdminDashboardStats', () => {
    it('should return dashboard statistics', async () => {
      const expectedResult = {
        total_properties: 10,
        total_tenants: 8,
        due_tenants: 2,
        unresolved_requests: 3,
      };

      mockPropertiesService.getAdminDashboardStats.mockResolvedValue(
        expectedResult,
      );

      const result = await controller.getAdminDashboardStats(mockRequest);

      expect(mockPropertiesService.getAdminDashboardStats).toHaveBeenCalledWith(
        'user-id',
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle errors when fetching stats', async () => {
      const error = new Error('Failed to fetch stats');

      mockPropertiesService.getAdminDashboardStats.mockRejectedValue(error);

      await expect(
        controller.getAdminDashboardStats(mockRequest),
      ).rejects.toThrow(error);
    });
  });

  describe('moveTenantIn', () => {
    it('should move tenant in successfully', async () => {
      const moveInData: MoveTenantInDto = {
        property_id: 'property-id',
        tenant_id: 'tenant-id',
        move_in_date: '2025-01-01',
      };

      const expectedResult = {
        id: 'property-tenant-id',
        property_id: moveInData.property_id,
        tenant_id: moveInData.tenant_id,
        status: 'active',
      };

      mockPropertiesService.moveTenantIn.mockResolvedValue(expectedResult);

      const result = await controller.moveTenantIn(moveInData);

      expect(mockPropertiesService.moveTenantIn).toHaveBeenCalledWith(
        moveInData,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle move-in errors', async () => {
      const moveInData: MoveTenantInDto = {
        property_id: 'property-id',
        tenant_id: 'tenant-id',
        move_in_date: 'invalid-date',
      };
      const error = new Error('Invalid date format');

      mockPropertiesService.moveTenantIn.mockRejectedValue(error);

      await expect(controller.moveTenantIn(moveInData)).rejects.toThrow(error);
    });
  });

  describe('moveTenantOut', () => {
    it('should move tenant out successfully', async () => {
      const moveOutData: MoveTenantOutDto = {
        property_id: 'property-id',
        tenant_id: 'tenant-id',
        move_out_date: '2025-12-31',
        move_out_reason: 'Lease ended',
        owner_comment: 'Good tenant',
      };

      const expectedResult = {
        id: 'history-id',
        move_out_date: '2025-12-31',
        move_out_reason: 'Lease ended',
      };

      mockPropertiesService.moveTenantOut.mockResolvedValue(expectedResult);

      const result = await controller.moveTenantOut(moveOutData);

      expect(mockPropertiesService.moveTenantOut).toHaveBeenCalledWith(
        moveOutData,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle move-out errors', async () => {
      const moveOutData: MoveTenantOutDto = {
        property_id: 'property-id',
        tenant_id: 'tenant-id',
        move_out_date: '2025-12-31',
      };
      const error = new Error('Tenant not found');

      mockPropertiesService.moveTenantOut.mockRejectedValue(error);

      await expect(controller.moveTenantOut(moveOutData)).rejects.toThrow(
        error,
      );
    });
  });

  describe('createPropertyGroup', () => {
    it('should create a property group successfully', async () => {
      const createGroupDto: CreatePropertyGroupDto = {
        name: 'Luxury Properties',
        property_ids: ['prop-1', 'prop-2'],
      };

      const expectedResult = {
        id: 'group-id',
        name: createGroupDto.name,
        property_ids: createGroupDto.property_ids,
        owner_id: 'user-id',
      };

      mockPropertiesService.createPropertyGroup.mockResolvedValue(
        expectedResult,
      );

      const result = await controller.createPropertyGroup(
        createGroupDto,
        mockRequest,
      );

      expect(mockPropertiesService.createPropertyGroup).toHaveBeenCalledWith(
        createGroupDto,
        'user-id',
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle creation errors', async () => {
      const createGroupDto: CreatePropertyGroupDto = {
        name: 'Luxury Properties',
        property_ids: ['prop-1', 'prop-2'],
      };
      const error = new Error('Some properties do not exist');

      mockPropertiesService.createPropertyGroup.mockRejectedValue(error);

      await expect(
        controller.createPropertyGroup(createGroupDto, mockRequest),
      ).rejects.toThrow(error);
    });
  });

  describe('getPropertyGroupById', () => {
    it('should return a property group by id', async () => {
      const groupId = 'group-id';
      const expectedResult = {
        id: groupId,
        name: 'Luxury Properties',
        property_ids: ['prop-1', 'prop-2'],
        properties: [
          { id: 'prop-1', name: 'Property 1' },
          { id: 'prop-2', name: 'Property 2' },
        ],
      };

      mockPropertiesService.getPropertyGroupById.mockResolvedValue(
        expectedResult,
      );

      const result = await controller.getPropertyGroupById(
        groupId,
        mockRequest,
      );

      expect(mockPropertiesService.getPropertyGroupById).toHaveBeenCalledWith(
        groupId,
        'user-id',
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle errors when group not found', async () => {
      const groupId = 'non-existent-id';
      const error = new Error('Property group not found');

      mockPropertiesService.getPropertyGroupById.mockRejectedValue(error);

      await expect(
        controller.getPropertyGroupById(groupId, mockRequest),
      ).rejects.toThrow(error);
    });
  });

  describe('assignTenantToProperty', () => {
    it('should assign tenant to property successfully', async () => {
      const propertyId = 'property-id';
      const assignTenantDto: AssignTenantDto = {
        tenant_id: 'tenant-id',
        rental_price: 500000,
        service_charge: 50000,
        security_deposit: 100000,
        lease_start_date: '2025-01-01',
        lease_end_date: '2025-12-31',
        rent_status: 'active',
      };

      const expectedResult = {
        message: 'Tenant Added Successfully',
      };

      mockPropertiesService.assignTenant.mockResolvedValue(expectedResult);

      const result = await controller.assignTenantToProperty(
        propertyId,
        assignTenantDto,
      );

      expect(mockPropertiesService.assignTenant).toHaveBeenCalledWith(
        propertyId,
        assignTenantDto,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle assignment errors', async () => {
      const propertyId = 'property-id';
      const assignTenantDto: AssignTenantDto = {
        tenant_id: 'tenant-id',
        rental_price: 500000,
        service_charge: 50000,
        security_deposit: 100000,
        lease_start_date: '2025-01-01',
        lease_end_date: '2025-12-31',
        rent_status: 'active',
      };
      const error = new Error('Property not found');

      mockPropertiesService.assignTenant.mockRejectedValue(error);

      await expect(
        controller.assignTenantToProperty(propertyId, assignTenantDto),
      ).rejects.toThrow(error);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { RentsController } from 'src/rents/rents.controller';
import { RentsService } from 'src/rents/rents.service';
import { FileUploadService } from 'src/utils/cloudinary';
import {
  RentFilter,
  CreateRentDto,
  RentStatusEnum,
} from 'src/rents/dto/create-rent.dto';
import { UpdateRentDto } from 'src/rents/dto/update-rent.dto';
import { CreateRentIncreaseDto } from 'src/rents/dto/create-rent-increase.dto';
import { HttpException, HttpStatus } from '@nestjs/common';

describe('RentsController', () => {
  let controller: RentsController;
  let service: RentsService;
  let fileUploadService: FileUploadService;

  const mockRentsService = {
    payRent: jest.fn(),
    getAllRents: jest.fn(),
    getRentByTenantId: jest.fn(),
    getDueRentsWithinSevenDays: jest.fn(),
    getOverdueRents: jest.fn(),
    sendRentReminder: jest.fn(),
    getRentById: jest.fn(),
    updateRentById: jest.fn(),
    deleteRentById: jest.fn(),
    saveOrUpdateRentIncrease: jest.fn(),
    deactivateTenant: jest.fn(),
  };

  const mockFileUploadService = {
    uploadFile: jest.fn(),
  };

  const mockRent = {
    id: '90b7f325-be27-45a7-9688-fa49630cac8f',
    property_id: '90b7f325-be27-45a7-9688-fa49630cac8f',
    tenant_id: '90b7f325-be27-45a7-9688-fa49630cac8f',
    amount_paid: 500000,
    expiry_date: new Date('2024-12-31'),
    lease_start_date: new Date('2024-01-01'),
    lease_end_date: new Date('2024-12-31'),
    payment_status: 'paid',
    rent_status: RentStatusEnum.ACTIVE,
  };

  const mockRequest = {
    user: {
      id: 'user-123',
      email: 'test@example.com',
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RentsController],
      providers: [
        {
          provide: RentsService,
          useValue: mockRentsService,
        },
        {
          provide: FileUploadService,
          useValue: mockFileUploadService,
        },
      ],
    }).compile();

    controller = module.get<RentsController>(RentsController);
    service = module.get<RentsService>(RentsService);
    fileUploadService = module.get<FileUploadService>(FileUploadService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('payRent', () => {
    it('should create a rent payment successfully', async () => {
      const createRentDto: CreateRentDto = {
        property_id: '90b7f325-be27-45a7-9688-fa49630cac8f',
        tenant_id: '90b7f325-be27-45a7-9688-fa49630cac8f',
        amount_paid: 500000,
        expiry_date: new Date('2024-12-31'),
        lease_start_date: new Date('2024-01-01'),
        lease_end_date: new Date('2024-12-31'),
        status: RentStatusEnum.ACTIVE,
      };

      mockRentsService.payRent.mockResolvedValue(mockRent);

      const result = await controller.payRent(createRentDto);

      expect(result).toEqual(mockRent);
      expect(service.payRent).toHaveBeenCalledWith(createRentDto);
    });

    it('should throw an error if payRent fails', async () => {
      const createRentDto: CreateRentDto = {
        property_id: '90b7f325-be27-45a7-9688-fa49630cac8f',
        tenant_id: '90b7f325-be27-45a7-9688-fa49630cac8f',
        amount_paid: 500000,
        expiry_date: new Date('2024-12-31'),
        lease_start_date: new Date('2024-01-01'),
        lease_end_date: new Date('2024-12-31'),
        status: RentStatusEnum.ACTIVE,
      };

      const error = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
      mockRentsService.payRent.mockRejectedValue(error);

      await expect(controller.payRent(createRentDto)).rejects.toThrow(error);
    });
  });

  describe('getAllRents', () => {
    it('should return paginated rents', async () => {
      const query: RentFilter = { page: 1, size: 10 };
      const mockResponse = {
        rents: [mockRent],
        pagination: {
          totalRows: 1,
          perPage: 10,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      };

      mockRentsService.getAllRents.mockResolvedValue(mockResponse);

      const result = await controller.getAllRents(query);

      expect(result).toEqual(mockResponse);
      expect(service.getAllRents).toHaveBeenCalledWith(query);
    });

    it('should handle empty results', async () => {
      const query: RentFilter = { page: 1, size: 10 };
      const mockResponse = {
        rents: [],
        pagination: {
          totalRows: 0,
          perPage: 10,
          currentPage: 1,
          totalPages: 0,
          hasNextPage: false,
        },
      };

      mockRentsService.getAllRents.mockResolvedValue(mockResponse);

      const result = await controller.getAllRents(query);

      expect(result.rents).toHaveLength(0);
      expect(result.pagination.totalRows).toBe(0);
    });
  });

  describe('getRentByTenantId', () => {
    it('should return rent for a specific tenant', async () => {
      const tenantId = '90b7f325-be27-45a7-9688-fa49630cac8f';
      mockRentsService.getRentByTenantId.mockResolvedValue(mockRent);

      const result = await controller.getRentByTenantId(tenantId);

      expect(result).toEqual(mockRent);
      expect(service.getRentByTenantId).toHaveBeenCalledWith(tenantId);
    });

    it('should throw NotFoundException if tenant has no rent', async () => {
      const tenantId = '90b7f325-be27-45a7-9688-fa49630cac8f';
      const error = new HttpException(
        'Tenant has never paid rent',
        HttpStatus.NOT_FOUND,
      );
      mockRentsService.getRentByTenantId.mockRejectedValue(error);

      await expect(controller.getRentByTenantId(tenantId)).rejects.toThrow(
        error,
      );
    });
  });

  describe('getDueRentsWithinSevenDays', () => {
    it('should return due rents within 7 days', async () => {
      const query: RentFilter = { page: 1, size: 10 };
      const mockResponse = {
        rents: [mockRent],
        pagination: {
          totalRows: 1,
          perPage: 10,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      };

      mockRentsService.getDueRentsWithinSevenDays.mockResolvedValue(
        mockResponse,
      );

      const result = await controller.getDueRentsWithinSevenDays(
        query,
        mockRequest,
      );

      expect(result).toEqual(mockResponse);
      expect(query.owner_id).toBe(mockRequest.user.id);
      expect(service.getDueRentsWithinSevenDays).toHaveBeenCalledWith(query);
    });
  });

  describe('getOverdueRents', () => {
    it('should return overdue rents', async () => {
      const query: RentFilter = { page: 1, size: 10 };
      const mockResponse = {
        rents: [mockRent],
        pagination: {
          totalRows: 1,
          perPage: 10,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      };

      mockRentsService.getOverdueRents.mockResolvedValue(mockResponse);

      const result = await controller.getOverdueRents(query, mockRequest);

      expect(result).toEqual(mockResponse);
      expect(query.property).toBeDefined();
      expect(query.property!.owner_id).toBe(mockRequest.user.id);
      expect(service.getOverdueRents).toHaveBeenCalledWith(query);
    });
  });

  describe('sendReminder', () => {
    it('should send rent reminder successfully', async () => {
      const rentId = '90b7f325-be27-45a7-9688-fa49630cac8f';
      const mockResponse = { message: 'Reminder sent successfully' };

      mockRentsService.sendRentReminder.mockResolvedValue(mockResponse);

      const result = await controller.sendReminder(rentId);

      expect(result).toEqual(mockResponse);
      expect(service.sendRentReminder).toHaveBeenCalledWith(rentId);
    });

    it('should throw NotFoundException if rent not found', async () => {
      const rentId = '90b7f325-be27-45a7-9688-fa49630cac8f';
      const error = new HttpException('Rent not found', HttpStatus.NOT_FOUND);
      mockRentsService.sendRentReminder.mockRejectedValue(error);

      await expect(controller.sendReminder(rentId)).rejects.toThrow(error);
    });
  });

  describe('getRentById', () => {
    it('should return a specific rent', async () => {
      const rentId = '90b7f325-be27-45a7-9688-fa49630cac8f';
      mockRentsService.getRentById.mockResolvedValue(mockRent);

      const result = await controller.getRentById(rentId);

      expect(result).toEqual(mockRent);
      expect(service.getRentById).toHaveBeenCalledWith(rentId);
    });

    it('should throw NotFoundException if rent not found', async () => {
      const rentId = '90b7f325-be27-45a7-9688-fa49630cac8f';
      const error = new HttpException('Rent not found', HttpStatus.NOT_FOUND);
      mockRentsService.getRentById.mockRejectedValue(error);

      await expect(controller.getRentById(rentId)).rejects.toThrow(error);
    });
  });

  describe('updatePropertyById', () => {
    it('should update rent successfully', async () => {
      const rentId = '90b7f325-be27-45a7-9688-fa49630cac8f';
      const updateRentDto: UpdateRentDto = {
        amount_paid: 600000,
      };

      const mockUpdateResponse = { affected: 1 };
      mockRentsService.updateRentById.mockResolvedValue(mockUpdateResponse);

      const result = await controller.updatePropertyById(rentId, updateRentDto);

      expect(result).toEqual(mockUpdateResponse);
      expect(service.updateRentById).toHaveBeenCalledWith(
        rentId,
        updateRentDto,
      );
    });
  });

  describe('deletePropertyById', () => {
    it('should delete rent successfully', async () => {
      const rentId = '90b7f325-be27-45a7-9688-fa49630cac8f';
      const mockDeleteResponse = { affected: 1 };

      mockRentsService.deleteRentById.mockResolvedValue(mockDeleteResponse);

      const result = await controller.deletePropertyById(rentId);

      expect(result).toEqual(mockDeleteResponse);
      expect(service.deleteRentById).toHaveBeenCalledWith(rentId);
    });
  });

  describe('saveOrUpdateRentIncrease', () => {
    it('should create rent increase successfully', async () => {
      const createRentIncreaseDto: CreateRentIncreaseDto = {
        property_id: '90b7f325-be27-45a7-9688-fa49630cac8f',
        initial_rent: 500000,
        current_rent: 600000,
        reason: 'Annual increase',
      };

      const mockResponse = { affected: 1 };
      mockRentsService.saveOrUpdateRentIncrease.mockResolvedValue(mockResponse);

      const result = await controller.saveOrUpdateRentIncrease(
        createRentIncreaseDto,
        mockRequest,
      );

      expect(result).toEqual(mockResponse);
      expect(service.saveOrUpdateRentIncrease).toHaveBeenCalledWith(
        createRentIncreaseDto,
        mockRequest.user.id,
      );
    });

    it('should throw error if user does not own property', async () => {
      const createRentIncreaseDto: CreateRentIncreaseDto = {
        property_id: '90b7f325-be27-45a7-9688-fa49630cac8f',
        initial_rent: 500000,
        current_rent: 600000,
      };

      const error = new HttpException(
        'You do not own this Property',
        HttpStatus.NOT_FOUND,
      );
      mockRentsService.saveOrUpdateRentIncrease.mockRejectedValue(error);

      await expect(
        controller.saveOrUpdateRentIncrease(createRentIncreaseDto, mockRequest),
      ).rejects.toThrow(error);
    });
  });

  describe('removeTenant', () => {
    it('should deactivate tenant successfully', async () => {
      const tenantId = '90b7f325-be27-45a7-9688-fa49630cac8f';
      const body = { property_id: '90b7f325-be27-45a7-9688-fa49630cac8f' };

      mockRentsService.deactivateTenant.mockResolvedValue(undefined);

      const result = await controller.removeTenant(tenantId, body);

      expect(service.deactivateTenant).toHaveBeenCalledWith({
        tenant_id: tenantId,
        property_id: body.property_id,
      });
    });
  });
});

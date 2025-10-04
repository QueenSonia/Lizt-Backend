// rents.controller.spec.ts

import { Test, TestingModule } from '@nestjs/testing';
import { RentsController } from 'src/rents/rents.controller';
import { RentsService } from 'src/rents/rents.service';
import { FileUploadService } from 'src/utils/cloudinary';
import { CreateRentDto, RentFilter } from 'src/rents/dto/create-rent.dto';
import { UpdateRentDto } from 'src/rents/dto/update-rent.dto';
import { CreateRentIncreaseDto } from 'src/rents/dto/create-rent-increase.dto';
import { Rent } from 'src/rents/entities/rent.entity';
import { HttpException, HttpStatus } from '@nestjs/common';
import { RoleGuard } from 'src/auth/role.guard';
import { Request } from 'express';

describe('RentsController', () => {
  let controller: RentsController;
  let mockRentsService: Partial<RentsService>;
  let mockFileUploadService: Partial<FileUploadService>;

  beforeEach(async () => {
    mockRentsService = {
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

    mockFileUploadService = {
      uploadFile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RentsController],
      providers: [
        { provide: RentsService, useValue: mockRentsService },
        { provide: FileUploadService, useValue: mockFileUploadService },
      ],
    })
      .overrideGuard(RoleGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<RentsController>(RentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('payRent', () => {
    it('should call payRent service with body', async () => {
      const createRentDto: CreateRentDto = {
        property_id: 'uuid',
        tenant_id: 'uuid',
        amount_paid: 500000,
        lease_start_date: new Date(),
        lease_end_date: new Date(),
        expiry_date: new Date(),
        status: 'pending',
      };
      const mockRent = { id: 'uuid', ...createRentDto };
      (mockRentsService.payRent as jest.Mock).mockResolvedValue(mockRent);

      const result = await controller.payRent(createRentDto);
      expect(result).toEqual(mockRent);
      expect(mockRentsService.payRent).toHaveBeenCalledWith(createRentDto);
    });

    // Note: File upload is commented out in code, so skipping related tests
  });

  describe('getAllRents', () => {
    it('should call getAllRents service with query', async () => {
      const query: RentFilter = { page: 1, size: 10 };
      const mockResponse = { rents: [], pagination: {} };
      (mockRentsService.getAllRents as jest.Mock).mockResolvedValue(
        mockResponse,
      );

      const result = await controller.getAllRents(query);
      expect(result).toEqual(mockResponse);
      expect(mockRentsService.getAllRents).toHaveBeenCalledWith(query);
    });
  });

  describe('getRentByTenantId', () => {
    it('should call getRentByTenantId service', async () => {
      const tenantId = 'uuid';
      const mockRent = { id: 'uuid' } as Rent;
      (mockRentsService.getRentByTenantId as jest.Mock).mockResolvedValue(
        mockRent,
      );

      const result = await controller.getRentByTenantId(tenantId);
      expect(result).toEqual(mockRent);
      expect(mockRentsService.getRentByTenantId).toHaveBeenCalledWith(tenantId);
    });

    it('should throw if service throws', async () => {
      const tenantId = 'uuid';
      (mockRentsService.getRentByTenantId as jest.Mock).mockRejectedValue(
        new HttpException('Not found', HttpStatus.NOT_FOUND),
      );

      await expect(controller.getRentByTenantId(tenantId)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('getDueRentsWithinSevenDays', () => {
    it('should call getDueRentsWithinSevenDays service with query and owner_id', async () => {
      const query: RentFilter = { page: 1, size: 10 };
      const req = { user: { id: 'owner_uuid' } };
      const mockResponse = { rents: [], pagination: {} };
      (
        mockRentsService.getDueRentsWithinSevenDays as jest.Mock
      ).mockResolvedValue(mockResponse);

      const result = await controller.getDueRentsWithinSevenDays(query, req);
      expect(result).toEqual(mockResponse);
      expect(mockRentsService.getDueRentsWithinSevenDays).toHaveBeenCalledWith({
        ...query,
        owner_id: 'owner_uuid',
      });
    });
  });

  describe('getOverdueRents', () => {
    it('should call getOverdueRents service with query and owner_id', async () => {
      const query: RentFilter = { page: 1, size: 10 };
      const req = { user: { id: 'owner_uuid' } };
      const mockResponse = { rents: [], pagination: {} };
      (mockRentsService.getOverdueRents as jest.Mock).mockResolvedValue(
        mockResponse,
      );

      const result = await controller.getOverdueRents(query, req);
      expect(result).toEqual(mockResponse);
      expect(mockRentsService.getOverdueRents).toHaveBeenCalledWith({
        ...query,
        property: { owner_id: 'owner_uuid' },
      });
    });
  });

  describe('sendReminder', () => {
    it('should call sendRentReminder service', async () => {
      const id = 'uuid';
      const mockResponse = { message: 'Reminder sent successfully' };
      (mockRentsService.sendRentReminder as jest.Mock).mockResolvedValue(
        mockResponse,
      );

      const result = await controller.sendReminder(id);
      expect(result).toEqual(mockResponse);
      expect(mockRentsService.sendRentReminder).toHaveBeenCalledWith(id);
    });
  });

  describe('getRentById', () => {
    it('should call getRentById service', async () => {
      const id = 'uuid';
      const mockRent = { id: 'uuid' } as Rent;
      (mockRentsService.getRentById as jest.Mock).mockResolvedValue(mockRent);

      const result = await controller.getRentById(id);
      expect(result).toEqual(mockRent);
      expect(mockRentsService.getRentById).toHaveBeenCalledWith(id);
    });
  });

  describe('updatePropertyById', () => {
    it('should call updateRentById service with body', async () => {
      const id = 'uuid';
      const updateDto: UpdateRentDto = { amount_paid: 600000 };
      (mockRentsService.updateRentById as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      const result = await controller.updatePropertyById(id, updateDto);
      expect(result).toEqual({ affected: 1 });
      expect(mockRentsService.updateRentById).toHaveBeenCalledWith(
        id,
        updateDto,
      );
    });

    // Note: File upload is commented out
  });

  describe('deletePropertyById', () => {
    it('should call deleteRentById service', async () => {
      const id = 'uuid';
      (mockRentsService.deleteRentById as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      const result = await controller.deletePropertyById(id);
      expect(result).toEqual({ affected: 1 });
      expect(mockRentsService.deleteRentById).toHaveBeenCalledWith(id);
    });
  });

  describe('saveOrUpdateRentIncrease', () => {
    it('should call saveOrUpdateRentIncrease service with body and user id', async () => {
      const body: CreateRentIncreaseDto = {
        property_id: 'uuid',
        initial_rent: 500000,
        current_rent: 600000,
      };
      const req = { user: { id: 'owner_uuid' } };
      const mockResponse = { id: 'uuid' };
      (
        mockRentsService.saveOrUpdateRentIncrease as jest.Mock
      ).mockResolvedValue(mockResponse);

      const result = await controller.saveOrUpdateRentIncrease(body, req);
      expect(result).toEqual(mockResponse);
      expect(mockRentsService.saveOrUpdateRentIncrease).toHaveBeenCalledWith(
        body,
        'owner_uuid',
      );
    });
  });

  describe('removeTenant', () => {
    it('should call deactivateTenant service', async () => {
      const tenantId = 'uuid';
      const body = { property_id: 'property_uuid' };
      (mockRentsService.deactivateTenant as jest.Mock).mockResolvedValue(
        undefined,
      );

      await controller.removeTenant(tenantId, body);
      expect(mockRentsService.deactivateTenant).toHaveBeenCalledWith({
        tenant_id: tenantId,
        property_id: body.property_id,
      });
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { RentsService } from '../../src/rents/rents.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Rent } from '../../src/rents/entities/rent.entity';
import { Property } from '../../src/properties/entities/property.entity';
import { PropertyTenant } from '../../src/properties/entities/property-tenants.entity';
import { RentIncrease } from '../../src/rents/entities/rent-increase.entity';
import { UtilService } from '../../src/utils/utility-service';
import { Repository } from 'typeorm';
import { HttpException, HttpStatus } from '@nestjs/common';
import {
  RentStatusEnum,
  RentPaymentStatusEnum,
} from '../../src/rents/dto/create-rent.dto';
import {
  PropertyStatusEnum,
  TenantStatusEnum,
} from '../../src/properties/dto/create-property.dto';

type MockRepository = Partial<Record<keyof Repository<any>, jest.Mock>>;

describe('RentsService', () => {
  let service: RentsService;
  let rentRepository: MockRepository;
  let propertyRepository: MockRepository;
  let propertyTenantRepository: MockRepository;
  let rentIncreaseRepository: MockRepository;
  let utilService: Partial<UtilService>;

  const mockRent = {
    id: 'rent-123',
    tenant_id: 'tenant-123',
    property_id: 'property-123',
    rental_price: 50000,
    amount_paid: 50000,
    lease_start_date: new Date('2024-01-01'),
    lease_end_date: new Date('2024-12-31'),
    expiry_date: new Date('2024-12-31'),
    rent_status: RentStatusEnum.ACTIVE,
    payment_status: RentPaymentStatusEnum.PAID,
  };

  beforeEach(async () => {
    const createMockRepository = (): MockRepository => ({
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    });

    rentRepository = createMockRepository();
    propertyRepository = createMockRepository();
    propertyTenantRepository = createMockRepository();
    rentIncreaseRepository = createMockRepository();

    utilService = {
      sendEmail: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RentsService,
        {
          provide: getRepositoryToken(Rent),
          useValue: rentRepository,
        },
        {
          provide: getRepositoryToken(Property),
          useValue: propertyRepository,
        },
        {
          provide: getRepositoryToken(PropertyTenant),
          useValue: propertyTenantRepository,
        },
        {
          provide: getRepositoryToken(RentIncrease),
          useValue: rentIncreaseRepository,
        },
        {
          provide: UtilService,
          useValue: utilService,
        },
      ],
    }).compile();

    service = module.get<RentsService>(RentsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('payRent', () => {
    it('should save rent payment with normalized dates', async () => {
      const rentData = {
        tenant_id: 'tenant-123',
        property_id: 'property-123',
        rental_price: 50000,
        amount_paid: 50000,
        lease_start_date: '2024-01-01',
        lease_end_date: '2024-12-31',
      };

      (rentRepository.save as jest.Mock).mockResolvedValue(mockRent);

      const result = await service.payRent(rentData);

      expect(result).toEqual(mockRent);
      expect(rentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: 'tenant-123',
          property_id: 'property-123',
          rental_price: 50000,
          amount_paid: 50000,
        }),
      );
    });
  });

  describe('getAllRents', () => {
    it('should return paginated rents', async () => {
      const mockRents = [mockRent];
      const totalCount = 1;

      (rentRepository.findAndCount as jest.Mock).mockResolvedValue([
        mockRents,
        totalCount,
      ]);

      const result = await service.getAllRents({ page: 1, size: 10 });

      expect(result.rents).toEqual(mockRents);
      expect(result.pagination).toEqual({
        totalRows: 1,
        perPage: 10,
        currentPage: 1,
        totalPages: 1,
        hasNextPage: false,
      });
    });

    it('should use default pagination values', async () => {
      (rentRepository.findAndCount as jest.Mock).mockResolvedValue([[], 0]);

      await service.getAllRents({});

      expect(rentRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
        }),
      );
    });
  });

  describe('getRentByTenantId', () => {
    it('should return rent for a tenant', async () => {
      const mockRentWithRelations = {
        ...mockRent,
        tenant: { id: 'tenant-123', email: 'tenant@example.com' },
        property: { id: 'property-123', name: 'Test Property' },
      };

      (rentRepository.findOne as jest.Mock).mockResolvedValue(
        mockRentWithRelations,
      );

      const result = await service.getRentByTenantId('tenant-123');

      expect(result).toEqual(mockRentWithRelations);
      expect(rentRepository.findOne).toHaveBeenCalledWith({
        where: { tenant_id: 'tenant-123' },
        relations: ['tenant', 'property'],
      });
    });

    it('should throw NotFoundException when tenant has no rent', async () => {
      (rentRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.getRentByTenantId('tenant-123')).rejects.toThrow(
        HttpException,
      );
      await expect(service.getRentByTenantId('tenant-123')).rejects.toThrow(
        'Tenant has never paid rent',
      );
    });
  });

  describe('getDueRentsWithinSevenDays', () => {
    it('should return rents expiring within 7 days', async () => {
      const mockDueRents = [mockRent];

      (rentRepository.findAndCount as jest.Mock).mockResolvedValue([
        mockDueRents,
        1,
      ]);

      const result = await service.getDueRentsWithinSevenDays({
        page: 1,
        size: 10,
      });

      expect(result.rents).toEqual(mockDueRents);
      expect(rentRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            expiry_date: expect.anything(),
          }),
          relations: ['tenant', 'property'],
        }),
      );
    });
  });

  describe('getOverdueRents', () => {
    it('should return overdue rents', async () => {
      const mockOverdueRents = [mockRent];

      (rentRepository.findAndCount as jest.Mock).mockResolvedValue([
        mockOverdueRents,
        1,
      ]);

      const result = await service.getOverdueRents({ page: 1, size: 10 });

      expect(result.rents).toEqual(mockOverdueRents);
      expect(result.pagination.totalRows).toBe(1);
    });
  });

  describe('sendRentReminder', () => {
    it('should send email reminder to tenant', async () => {
      const mockRentWithDetails = {
        ...mockRent,
        tenant: {
          id: 'tenant-123',
          email: 'tenant@example.com',
          user: { first_name: 'John', last_name: 'Doe' },
        },
        property: {
          id: 'property-123',
          name: 'Test Property',
          rental_price: 50000,
        },
      };

      (rentRepository.findOne as jest.Mock).mockResolvedValue(
        mockRentWithDetails,
      );

      const result = await service.sendRentReminder('rent-123');

      expect(result.message).toBe('Reminder sent successfully');
      expect(utilService.sendEmail).toHaveBeenCalledWith(
        'tenant@example.com',
        expect.stringContaining('Rent Reminder'),
        expect.any(String),
      );
    });

    it('should throw NotFoundException when rent not found', async () => {
      (rentRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.sendRentReminder('invalid-id')).rejects.toThrow(
        HttpException,
      );
      await expect(service.sendRentReminder('invalid-id')).rejects.toThrow(
        'Rent not found',
      );
    });
  });

  describe('getRentById', () => {
    it('should return rent by id with relations', async () => {
      const mockRentWithRelations = {
        ...mockRent,
        tenant: { id: 'tenant-123' },
        property: { id: 'property-123' },
      };

      (rentRepository.findOne as jest.Mock).mockResolvedValue(
        mockRentWithRelations,
      );

      const result = await service.getRentById('rent-123');

      expect(result).toEqual(mockRentWithRelations);
      expect(rentRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'rent-123' },
        relations: ['tenant', 'property'],
      });
    });

    it('should throw NotFoundException when rent not found', async () => {
      (rentRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.getRentById('invalid-id')).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('updateRentById', () => {
    it('should update rent successfully', async () => {
      const updateData = { rental_price: 60000 };
      (rentRepository.update as jest.Mock).mockResolvedValue({ affected: 1 });

      await service.updateRentById('rent-123', updateData);

      expect(rentRepository.update).toHaveBeenCalledWith(
        'rent-123',
        updateData,
      );
    });
  });

  describe('deleteRentById', () => {
    it('should delete rent successfully', async () => {
      (rentRepository.delete as jest.Mock).mockResolvedValue({ affected: 1 });

      await service.deleteRentById('rent-123');

      expect(rentRepository.delete).toHaveBeenCalledWith('rent-123');
    });
  });

  describe('saveOrUpdateRentIncrease', () => {
    const rentIncreaseDto = {
      property_id: 'property-123',
      current_rent: 60000,
      previous_rent: 50000,
      initial_rent: 50000,
      increase_percentage: 20,
    };

    it('should create new rent increase if none exists', async () => {
      const mockProperty = {
        id: 'property-123',
        owner_id: 'user-123',
        name: 'Test Property',
      };

      (propertyRepository.findOne as jest.Mock).mockResolvedValue(mockProperty);
      (rentIncreaseRepository.findOne as jest.Mock).mockResolvedValue(null);
      (rentIncreaseRepository.save as jest.Mock).mockResolvedValue(
        rentIncreaseDto,
      );
      (propertyRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.saveOrUpdateRentIncrease(rentIncreaseDto, 'user-123');

      expect(propertyRepository.update).toHaveBeenCalledWith('property-123', {
        rental_price: 60000,
      });
      expect(rentIncreaseRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          property_id: 'property-123',
          current_rent: 60000,
          rent_increase_date: expect.any(Date),
        }),
      );
    });

    it('should update existing rent increase', async () => {
      const mockProperty = {
        id: 'property-123',
        owner_id: 'user-123',
      };

      const existingIncrease = {
        id: 'increase-123',
        property_id: 'property-123',
      };

      (propertyRepository.findOne as jest.Mock).mockResolvedValue(mockProperty);
      (rentIncreaseRepository.findOne as jest.Mock).mockResolvedValue(
        existingIncrease,
      );
      (rentIncreaseRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });
      (propertyRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.saveOrUpdateRentIncrease(rentIncreaseDto, 'user-123');

      expect(rentIncreaseRepository.update).toHaveBeenCalledWith(
        'increase-123',
        expect.objectContaining({
          property_id: 'property-123',
          current_rent: 60000,
        }),
      );
    });

    it('should throw error if user does not own property', async () => {
      (propertyRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.saveOrUpdateRentIncrease(rentIncreaseDto, 'wrong-user'),
      ).rejects.toThrow(HttpException);
      await expect(
        service.saveOrUpdateRentIncrease(rentIncreaseDto, 'wrong-user'),
      ).rejects.toThrow('You do not own this Property');
    });
  });

  describe('findActiveRent', () => {
    it('should find active rent with given query', async () => {
      (rentRepository.findOne as jest.Mock).mockResolvedValue(mockRent);

      const result = await service.findActiveRent({
        property_id: 'property-123',
      });

      expect(result).toEqual(mockRent);
      expect(rentRepository.findOne).toHaveBeenCalledWith({
        where: {
          property_id: 'property-123',
          rent_status: RentStatusEnum.ACTIVE,
        },
      });
    });
  });

  describe('deactivateTenant', () => {
    it('should deactivate tenant and update property status', async () => {
      const mockActiveRent = {
        id: 'rent-123',
        tenant_id: 'tenant-123',
        property_id: 'property-123',
        rent_status: RentStatusEnum.ACTIVE,
      };

      (rentRepository.findOne as jest.Mock).mockResolvedValue(mockActiveRent);
      (propertyRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });
      (propertyTenantRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });
      (rentRepository.update as jest.Mock).mockResolvedValue({ affected: 1 });

      await service.deactivateTenant({
        tenant_id: 'tenant-123',
        property_id: 'property-123',
      });

      expect(propertyRepository.update).toHaveBeenCalledWith(
        { id: 'property-123' },
        { property_status: PropertyStatusEnum.VACANT },
      );

      expect(propertyTenantRepository.update).toHaveBeenCalledWith(
        { tenant_id: 'tenant-123', property_id: 'property-123' },
        { status: TenantStatusEnum.INACTIVE },
      );

      expect(rentRepository.update).toHaveBeenCalledWith(
        {
          tenant_id: 'tenant-123',
          property_id: 'property-123',
          rent_status: RentStatusEnum.ACTIVE,
        },
        { rent_status: RentStatusEnum.INACTIVE },
      );
    });

    it('should do nothing if no active rent found', async () => {
      (rentRepository.findOne as jest.Mock).mockResolvedValue(null);

      await service.deactivateTenant({
        tenant_id: 'tenant-123',
        property_id: 'property-123',
      });

      expect(propertyRepository.update).not.toHaveBeenCalled();
      expect(propertyTenantRepository.update).not.toHaveBeenCalled();
      expect(rentRepository.update).not.toHaveBeenCalled();
    });
  });
});

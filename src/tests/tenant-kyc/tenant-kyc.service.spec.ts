/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { TenantKycService } from 'src/tenant-kyc/tenant-kyc.service';
import {
  Gender,
  TenantKyc,
  MaritalStatus,
  EmploymentStatus,
} from 'src/tenant-kyc/entities/tenant-kyc.entity';
import { Account } from 'src/users/entities/account.entity';
import { CreateTenantKycDto, UpdateTenantKycDto } from 'src/tenant-kyc/dto';
import {
  BulkDeleteTenantKycDto,
  ParseTenantKycQueryDto,
} from 'src/tenant-kyc/dto/others.dto';
import { RolesEnum } from 'src/base.entity';

jest.mock('src/lib/utils', () => ({
  paginate: jest.fn(),
}));

import { paginate } from 'src/lib/utils';

describe('TenantKycService', () => {
  let service: TenantKycService;
  let tenantKycRepo: Repository<TenantKyc>;
  let accountRepo: Repository<Account>;

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

  const mockLandlord = {
    id: mockLandlordId,
    role: RolesEnum.LANDLORD,
    email: 'landlord@example.com',
  };

  const mockKycData = {
    id: mockKycId,
    ...mockCreateDto,
    admin_id: mockAdminId,
    created_at: new Date(),
    updated_at: new Date(),
    identity_hash: 'mock-hash-value',
  };

  const mockTenantKycRepository = {
    save: jest.fn(),
    findOneBy: jest.fn(),
    delete: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
  };

  const mockAccountRepository = {
    findOneBy: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantKycService,
        {
          provide: getRepositoryToken(TenantKyc),
          useValue: mockTenantKycRepository,
        },
        {
          provide: getRepositoryToken(Account),
          useValue: mockAccountRepository,
        },
      ],
    }).compile();

    service = module.get<TenantKycService>(TenantKycService);
    tenantKycRepo = module.get<Repository<TenantKyc>>(
      getRepositoryToken(TenantKyc),
    );
    accountRepo = module.get<Repository<Account>>(getRepositoryToken(Account));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new KYC record successfully', async () => {
      mockAccountRepository.findOneBy.mockResolvedValue(mockLandlord);
      mockTenantKycRepository.findOneBy.mockResolvedValue(null);
      mockTenantKycRepository.save.mockResolvedValue(mockKycData);

      await service.create(mockCreateDto);

      expect(accountRepo.findOneBy).toHaveBeenCalledWith({
        id: mockLandlordId,
        role: RolesEnum.LANDLORD,
      });
      expect(tenantKycRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          ...mockCreateDto,
          identity_hash: expect.any(String),
        }),
      );
    });

    it('should throw BadRequestException if landlord does not exist', async () => {
      mockAccountRepository.findOneBy.mockResolvedValue(null);

      await expect(service.create(mockCreateDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(mockCreateDto)).rejects.toThrow(
        `Invalid or non-existent ref with id: ${mockLandlordId}`,
      );
      expect(tenantKycRepo.save).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if duplicate KYC exists', async () => {
      mockAccountRepository.findOneBy.mockResolvedValue(mockLandlord);
      mockTenantKycRepository.findOneBy.mockResolvedValue(mockKycData);

      await expect(service.create(mockCreateDto)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.create(mockCreateDto)).rejects.toThrow(
        'Duplicate request; awaiting review.',
      );
      expect(tenantKycRepo.save).not.toHaveBeenCalled();
    });

    it('should generate consistent identity hash for same data', async () => {
      mockAccountRepository.findOneBy.mockResolvedValue(mockLandlord);
      mockTenantKycRepository.findOneBy.mockResolvedValue(null);
      mockTenantKycRepository.save.mockResolvedValue(mockKycData);

      await service.create(mockCreateDto);
      const firstCallArgs = mockTenantKycRepository.save.mock.calls[0][0];

      mockTenantKycRepository.save.mockClear();
      await service.create(mockCreateDto);
      const secondCallArgs = mockTenantKycRepository.save.mock.calls[0][0];

      expect(firstCallArgs.identity_hash).toBe(secondCallArgs.identity_hash);
    });

    it('should handle KYC with only email (no phone)', async () => {
      const dtoWithoutPhone = { ...mockCreateDto, phone_number: undefined };
      mockAccountRepository.findOneBy.mockResolvedValue(mockLandlord);
      mockTenantKycRepository.findOneBy.mockResolvedValue(null);
      mockTenantKycRepository.save.mockResolvedValue(mockKycData);

      await service.create(dtoWithoutPhone);

      expect(tenantKycRepo.save).toHaveBeenCalled();
    });

    it('should handle KYC with only phone (no email)', async () => {
      const dtoWithoutEmail = { ...mockCreateDto, email: undefined };
      mockAccountRepository.findOneBy.mockResolvedValue(mockLandlord);
      mockTenantKycRepository.findOneBy.mockResolvedValue(null);
      mockTenantKycRepository.save.mockResolvedValue(mockKycData);

      await service.create(dtoWithoutEmail);

      expect(tenantKycRepo.save).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    const mockQuery: ParseTenantKycQueryDto = {
      page: 1,
      limit: 10,
      fields: 'id,first_name,email',
    };

    const mockPaginatedResponse = {
      data: [mockKycData],
      pagination: {
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      },
    };

    it('should return paginated KYC records with fields', async () => {
      (paginate as jest.Mock).mockResolvedValue(mockPaginatedResponse);

      const result = await service.findAll(mockAdminId, mockQuery);

      expect(result).toEqual(mockPaginatedResponse);
      expect(paginate).toHaveBeenCalledWith(tenantKycRepo, {
        page: 1,
        limit: 10,
        options: {
          where: { admin_id: mockAdminId },
          select: ['id', 'first_name', 'email'],
          order: { created_at: 'DESC' },
        },
      });
    });

    it('should return all fields when fields parameter is not provided', async () => {
      const queryWithoutFields = { page: 1, limit: 10 };
      (paginate as jest.Mock).mockResolvedValue(mockPaginatedResponse);

      await service.findAll(mockAdminId, queryWithoutFields);

      expect(paginate).toHaveBeenCalledWith(tenantKycRepo, {
        page: 1,
        limit: 10,
        options: {
          where: { admin_id: mockAdminId },
          select: undefined,
          order: { created_at: 'DESC' },
        },
      });
    });

    it('should handle empty field strings', async () => {
      const queryWithEmptyFields = { page: 1, limit: 10, fields: '' };
      (paginate as jest.Mock).mockResolvedValue(mockPaginatedResponse);

      await service.findAll(mockAdminId, queryWithEmptyFields);

      expect(paginate).toHaveBeenCalledWith(tenantKycRepo, {
        page: 1,
        limit: 10,
        options: {
          where: { admin_id: mockAdminId },
          select: undefined,
          order: { created_at: 'DESC' },
        },
      });
    });
  });

  describe('findOne', () => {
    it('should return a single KYC record', async () => {
      mockTenantKycRepository.findOneBy.mockResolvedValue(mockKycData);

      const result = await service.findOne(mockAdminId, mockKycId);

      expect(result).toEqual(mockKycData);
      expect(tenantKycRepo.findOneBy).toHaveBeenCalledWith({
        id: mockKycId,
        admin_id: mockAdminId,
      });
    });

    it('should throw NotFoundException if record not found', async () => {
      mockTenantKycRepository.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(mockAdminId, mockKycId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should only return records for the specified admin', async () => {
      mockTenantKycRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.findOne('different-admin-id', mockKycId),
      ).rejects.toThrow(NotFoundException);

      expect(tenantKycRepo.findOneBy).toHaveBeenCalledWith({
        id: mockKycId,
        admin_id: 'different-admin-id',
      });
    });
  });

  describe('update', () => {
    const mockUpdateDto: UpdateTenantKycDto = {
      first_name: 'Jane',
      email: 'jane.doe@example.com',
    };

    it('should update a KYC record successfully', async () => {
      const updatedData = { ...mockKycData, ...mockUpdateDto };
      mockTenantKycRepository.findOneBy.mockResolvedValue(mockKycData);
      mockTenantKycRepository.save.mockResolvedValue(updatedData);

      const result = await service.update(
        mockAdminId,
        mockKycId,
        mockUpdateDto,
      );

      expect(result).toEqual(updatedData);
      expect(tenantKycRepo.findOneBy).toHaveBeenCalledWith({
        id: mockKycId,
        admin_id: mockAdminId,
      });
      expect(tenantKycRepo.save).toHaveBeenCalledWith(
        expect.objectContaining(mockUpdateDto),
      );
    });

    it('should throw NotFoundException if record not found', async () => {
      mockTenantKycRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.update(mockAdminId, mockKycId, mockUpdateDto),
      ).rejects.toThrow(NotFoundException);
      expect(tenantKycRepo.save).not.toHaveBeenCalled();
    });

    it('should allow partial updates', async () => {
      const partialUpdate = { first_name: 'UpdatedName' };
      mockTenantKycRepository.findOneBy.mockResolvedValue(mockKycData);
      mockTenantKycRepository.save.mockResolvedValue({
        ...mockKycData,
        ...partialUpdate,
      });

      await service.update(mockAdminId, mockKycId, partialUpdate);

      expect(tenantKycRepo.save).toHaveBeenCalledWith(
        expect.objectContaining(partialUpdate),
      );
    });
  });

  describe('deleteOne', () => {
    it('should delete a KYC record successfully', async () => {
      mockTenantKycRepository.delete.mockResolvedValue({ affected: 1 });

      await service.deleteOne(mockAdminId, mockKycId);

      expect(tenantKycRepo.delete).toHaveBeenCalledWith({
        id: mockKycId,
        admin_id: mockAdminId,
      });
    });

    it('should throw NotFoundException if record not found', async () => {
      mockTenantKycRepository.delete.mockResolvedValue({ affected: 0 });

      await expect(service.deleteOne(mockAdminId, mockKycId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.deleteOne(mockAdminId, mockKycId)).rejects.toThrow(
        'KYC record not found',
      );
    });
  });

  describe('deleteMany', () => {
    const mockBulkDeleteDto: BulkDeleteTenantKycDto = {
      ids: [mockKycId, '123e4567-e89b-12d3-a456-426614174003'],
    };

    it('should delete multiple KYC records', async () => {
      mockTenantKycRepository.delete.mockResolvedValue({ affected: 2 });

      await service.deleteMany(mockAdminId, mockBulkDeleteDto);

      expect(tenantKycRepo.delete).toHaveBeenCalledWith(
        mockBulkDeleteDto.ids.map((id) => ({ id, admin_id: mockAdminId })),
      );
    });

    it('should handle empty ids array', async () => {
      const emptyDto: BulkDeleteTenantKycDto = { ids: [] };
      mockTenantKycRepository.delete.mockResolvedValue({ affected: 0 });

      await service.deleteMany(mockAdminId, emptyDto);

      expect(tenantKycRepo.delete).toHaveBeenCalledWith([]);
    });
  });

  describe('deleteAll', () => {
    it('should delete all KYC records for admin', async () => {
      mockTenantKycRepository.delete.mockResolvedValue({ affected: 5 });

      await service.deleteAll(mockAdminId);

      expect(tenantKycRepo.delete).toHaveBeenCalledWith({
        admin_id: mockAdminId,
      });
    });

    it('should only delete records for specified admin', async () => {
      const adminId = 'specific-admin-id';
      mockTenantKycRepository.delete.mockResolvedValue({ affected: 3 });

      await service.deleteAll(adminId);

      expect(tenantKycRepo.delete).toHaveBeenCalledWith({
        admin_id: adminId,
      });
    });
  });

  describe('generateIdentityHash (private method)', () => {
    it('should generate different hashes for different data', async () => {
      mockAccountRepository.findOneBy.mockResolvedValue(mockLandlord);
      mockTenantKycRepository.findOneBy.mockResolvedValue(null);
      mockTenantKycRepository.save.mockResolvedValue(mockKycData);

      await service.create(mockCreateDto);
      const firstHash =
        mockTenantKycRepository.save.mock.calls[0][0].identity_hash;

      mockTenantKycRepository.save.mockClear();
      const differentDto = { ...mockCreateDto, first_name: 'Different' };
      await service.create(differentDto);
      const secondHash =
        mockTenantKycRepository.save.mock.calls[0][0].identity_hash;

      expect(firstHash).not.toBe(secondHash);
    });

    it('should handle case insensitivity for names', async () => {
      mockAccountRepository.findOneBy.mockResolvedValue(mockLandlord);
      mockTenantKycRepository.findOneBy.mockResolvedValue(null);
      mockTenantKycRepository.save.mockResolvedValue(mockKycData);

      await service.create(mockCreateDto);
      const firstHash =
        mockTenantKycRepository.save.mock.calls[0][0].identity_hash;

      mockTenantKycRepository.save.mockClear();
      const upperCaseDto = {
        ...mockCreateDto,
        first_name: mockCreateDto.first_name.toUpperCase(),
        last_name: mockCreateDto.last_name.toUpperCase(),
      };
      await service.create(upperCaseDto);
      const secondHash =
        mockTenantKycRepository.save.mock.calls[0][0].identity_hash;

      expect(firstHash).toBe(secondHash);
    });
  });
});

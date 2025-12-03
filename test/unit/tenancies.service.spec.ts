// @ts-nocheck
import { Test, TestingModule } from '@nestjs/testing';
import { TenanciesService } from '../../src/tenancies/tenancies.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PropertyTenant } from '../../src/properties/entities/property-tenants.entity';
import { Rent } from '../../src/rents/entities/rent.entity';
import { Property } from '../../src/properties/entities/property.entity';
import { PropertyHistory } from '../../src/property-history/entities/property-history.entity';
import { Users } from '../../src/users/entities/user.entity';
import { WhatsappBotService } from '../../src/whatsapp-bot/whatsapp-bot.service';
import { UtilService } from '../../src/utils/utility-service';
import { DataSource, Repository } from 'typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { RentStatusEnum } from '../../src/rents/dto/create-rent.dto';
import { TenantStatusEnum } from '../../src/properties/dto/create-property.dto';

/**
 * UNIT TEST EXAMPLE: TenanciesService
 *
 * This test demonstrates:
 * 1. How to test NestJS services with dependencies
 * 2. How to mock TypeORM repositories
 * 3. How to test async operations
 * 4. How to test error handling
 * 5. The AAA (Arrange-Act-Assert) pattern
 *
 * KEY CONCEPTS:
 * - Mocking: We create fake versions of dependencies (repositories, services)
 * - Isolation: We test the service without touching the real database
 * - Test Doubles: Mock repositories return predefined data
 */

// Type helper for mocked repositories
type MockRepository = Partial<Record<keyof Repository<any>, jest.Mock>>;

describe('TenanciesService', () => {
  let service: TenanciesService;
  let propertyTenantRepository: MockRepository;
  let rentRepository: MockRepository;
  let propertyRepository: MockRepository;
  let propertyHistoryRepository: MockRepository;
  let usersRepository: MockRepository;
  let whatsappBotService: Partial<WhatsappBotService>;
  let utilService: Partial<UtilService>;
  let dataSource: Partial<DataSource>;

  /**
   * SETUP: beforeEach runs before EVERY test
   *
   * This is where we:
   * 1. Create mock versions of all dependencies
   * 2. Set up the testing module
   * 3. Get an instance of the service to test
   *
   * Why beforeEach? Each test gets a fresh, clean service instance
   */
  beforeEach(async () => {
    // Create mock repositories with common methods
    const createMockRepository = (): MockRepository => ({
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    });

    propertyTenantRepository = createMockRepository();
    rentRepository = createMockRepository();
    propertyRepository = createMockRepository();
    propertyHistoryRepository = createMockRepository();
    usersRepository = createMockRepository();

    // Mock WhatsApp service (we don't want to send real messages in tests!)
    whatsappBotService = {
      sendTenantAttachmentNotification: jest.fn().mockResolvedValue(undefined),
    };

    // Mock utility service
    utilService = {
      normalizePhoneNumber: jest.fn((phone) => phone),
    };

    // Mock DataSource for transaction handling
    const mockQueryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        save: jest.fn(),
      },
    };

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };

    /**
     * Create the testing module
     * This is like a mini NestJS application just for testing
     */
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenanciesService,
        // Provide mock repositories using NestJS tokens
        {
          provide: getRepositoryToken(PropertyTenant),
          useValue: propertyTenantRepository,
        },
        {
          provide: getRepositoryToken(Rent),
          useValue: rentRepository,
        },
        {
          provide: getRepositoryToken(Property),
          useValue: propertyRepository,
        },
        {
          provide: getRepositoryToken(PropertyHistory),
          useValue: propertyHistoryRepository,
        },
        {
          provide: getRepositoryToken(Users),
          useValue: usersRepository,
        },
        {
          provide: WhatsappBotService,
          useValue: whatsappBotService,
        },
        {
          provide: UtilService,
          useValue: utilService,
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
      ],
    }).compile();

    service = module.get<TenanciesService>(TenanciesService);
  });

  /**
   * CLEANUP: afterEach runs after EVERY test
   * Clear all mocks to prevent test pollution
   */
  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * TEST SUITE: Group related tests together
   * Use describe() to organize tests by method or feature
   */
  describe('createTenancyFromKYC', () => {
    /**
     * TEST 1: Happy Path (Success Case)
     *
     * ARRANGE-ACT-ASSERT Pattern:
     * 1. ARRANGE: Set up test data and mock responses
     * 2. ACT: Call the method being tested
     * 3. ASSERT: Verify the results and side effects
     */
    it('should create a new tenancy and return the saved PropertyTenant', async () => {
      // ===== ARRANGE =====
      // Create test data
      const mockKycApplication = {
        id: 'kyc-123',
        property_id: 'property-456',
        tenant_id: 'tenant-789',
      } as any;

      const mockPropertyTenant = {
        id: 'pt-001',
        property_id: 'property-456',
        tenant_id: 'tenant-789',
        status: TenantStatusEnum.ACTIVE,
      } as PropertyTenant;

      const mockTenantUser = {
        id: 'user-123',
        first_name: 'John',
        last_name: 'Doe',
        phone_number: '+1234567890',
      } as Users;

      const mockProperty = {
        id: 'property-456',
        name: 'Sunset Apartments',
        owner: {
          user: {
            first_name: 'Jane',
          },
        },
      } as any;

      // Configure mock responses
      propertyTenantRepository.create.mockReturnValue(mockPropertyTenant);
      propertyTenantRepository.save.mockResolvedValue(mockPropertyTenant);
      usersRepository.findOne.mockResolvedValue(mockTenantUser);
      propertyRepository.findOne.mockResolvedValue(mockProperty);

      // ===== ACT =====
      const result = await service.createTenancyFromKYC(
        mockKycApplication,
        'tenant-789',
      );

      // ===== ASSERT =====
      // Verify the result
      expect(result).toEqual(mockPropertyTenant);

      // Verify repository methods were called correctly
      expect(propertyTenantRepository.create).toHaveBeenCalledWith({
        property_id: 'property-456',
        tenant_id: 'tenant-789',
        status: TenantStatusEnum.ACTIVE,
      });

      expect(propertyTenantRepository.save).toHaveBeenCalledWith(
        mockPropertyTenant,
      );

      // Verify WhatsApp notification was sent
      expect(
        whatsappBotService.sendTenantAttachmentNotification,
      ).toHaveBeenCalledWith({
        phone_number: '+1234567890',
        tenant_name: 'John Doe',
        landlord_name: 'Jane',
        apartment_name: 'Sunset Apartments',
      });
    });

    /**
     * TEST 2: Edge Case (Missing Data)
     *
     * Tests what happens when optional data is missing
     * The service should still work, just skip the notification
     */
    it('should create tenancy even if notification fails', async () => {
      // ===== ARRANGE =====
      const mockKycApplication = {
        property_id: 'property-456',
      } as any;

      const mockPropertyTenant = {
        id: 'pt-001',
        property_id: 'property-456',
        tenant_id: 'tenant-789',
        status: TenantStatusEnum.ACTIVE,
      } as PropertyTenant;

      // Simulate missing user data
      propertyTenantRepository.create.mockReturnValue(mockPropertyTenant);
      propertyTenantRepository.save.mockResolvedValue(mockPropertyTenant);
      usersRepository.findOne.mockResolvedValue(null); // User not found

      // ===== ACT =====
      const result = await service.createTenancyFromKYC(
        mockKycApplication,
        'tenant-789',
      );

      // ===== ASSERT =====
      // Should still return the saved tenant
      expect(result).toEqual(mockPropertyTenant);

      // Should NOT have sent notification (no user data)
      expect(
        whatsappBotService.sendTenantAttachmentNotification,
      ).not.toHaveBeenCalled();
    });

    /**
     * TEST 3: Error Handling
     *
     * Tests that errors are handled gracefully
     * Notification errors shouldn't break the tenancy creation
     */
    it('should handle notification errors gracefully', async () => {
      // ===== ARRANGE =====
      const mockKycApplication = {
        property_id: 'property-456',
      } as any;

      const mockPropertyTenant = {
        id: 'pt-001',
        property_id: 'property-456',
        tenant_id: 'tenant-789',
        status: TenantStatusEnum.ACTIVE,
      } as PropertyTenant;

      const mockTenantUser = {
        first_name: 'John',
        last_name: 'Doe',
        phone_number: '+1234567890',
      } as Users;

      const mockProperty = {
        name: 'Sunset Apartments',
        owner: { user: { first_name: 'Jane' } },
      } as any;

      propertyTenantRepository.create.mockReturnValue(mockPropertyTenant);
      propertyTenantRepository.save.mockResolvedValue(mockPropertyTenant);
      usersRepository.findOne.mockResolvedValue(mockTenantUser);
      propertyRepository.findOne.mockResolvedValue(mockProperty);

      // Simulate WhatsApp service error
      (
        whatsappBotService.sendTenantAttachmentNotification as jest.Mock
      ).mockRejectedValue(new Error('WhatsApp API down'));

      // ===== ACT =====
      const result = await service.createTenancyFromKYC(
        mockKycApplication,
        'tenant-789',
      );

      // ===== ASSERT =====
      // Should still succeed despite notification failure
      expect(result).toEqual(mockPropertyTenant);
    });
  });

  /**
   * TEST SUITE: renewTenancy
   *
   * This demonstrates testing more complex scenarios:
   * - Database transactions
   * - Multiple repository interactions
   * - Validation logic
   * - Error cases
   */
  describe('renewTenancy', () => {
    /**
     * TEST 4: Testing Validation Logic
     *
     * Shows how to test that your service validates input correctly
     */
    it('should throw BadRequestException when end date is before start date', async () => {
      // ===== ARRANGE =====
      const mockPropertyTenant = {
        id: 'pt-001',
        property_id: 'property-456',
        tenant_id: 'tenant-789',
      } as PropertyTenant;

      const mockRent = {
        id: 'rent-001',
        property_id: 'property-456',
        tenant_id: 'tenant-789',
        rent_status: RentStatusEnum.ACTIVE,
      } as Rent;

      propertyTenantRepository.findOne.mockResolvedValue(mockPropertyTenant);
      rentRepository.findOne.mockResolvedValue(mockRent);

      const invalidDto = {
        startDate: '2024-12-31',
        endDate: '2024-01-01', // End before start!
        rentAmount: 1000,
        paymentFrequency: 'monthly',
      };

      // ===== ACT & ASSERT =====
      // Use rejects.toThrow to test async errors
      await expect(
        service.renewTenancy('pt-001', invalidDto as any),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.renewTenancy('pt-001', invalidDto as any),
      ).rejects.toThrow('End date must be after start date');
    });

    /**
     * TEST 5: Testing Not Found Scenarios
     *
     * Important to test error cases!
     */
    it('should throw NotFoundException when PropertyTenant not found', async () => {
      // ===== ARRANGE =====
      propertyTenantRepository.findOne.mockResolvedValue(null);

      const renewDto = {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        rentAmount: 1000,
        paymentFrequency: 'monthly',
      };

      // ===== ACT & ASSERT =====
      await expect(
        service.renewTenancy('non-existent-id', renewDto as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when no active rent found', async () => {
      // ===== ARRANGE =====
      const mockPropertyTenant = {
        id: 'pt-001',
        property_id: 'property-456',
        tenant_id: 'tenant-789',
      } as PropertyTenant;

      propertyTenantRepository.findOne.mockResolvedValue(mockPropertyTenant);
      rentRepository.findOne.mockResolvedValue(null); // No active rent

      const renewDto = {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        rentAmount: 1000,
        paymentFrequency: 'monthly',
      };

      // ===== ACT & ASSERT =====
      await expect(
        service.renewTenancy('pt-001', renewDto as any),
      ).rejects.toThrow(NotFoundException);

      await expect(
        service.renewTenancy('pt-001', renewDto as any),
      ).rejects.toThrow('No active rent record found for this tenancy');
    });
  });

  /**
   * LEARNING NOTES:
   *
   * 1. MOCKING: We mock dependencies so tests are:
   *    - Fast (no real database calls)
   *    - Reliable (no external dependencies)
   *    - Isolated (test one thing at a time)
   *
   * 2. AAA PATTERN: Every test follows Arrange-Act-Assert
   *    - Makes tests easy to read and understand
   *    - Clear structure helps you think about what you're testing
   *
   * 3. TEST NAMES: Should describe what's being tested
   *    - "should [expected behavior] when [condition]"
   *    - Anyone reading the test knows what it does
   *
   * 4. WHAT TO TEST:
   *    ✅ Happy path (things work as expected)
   *    ✅ Error cases (things fail gracefully)
   *    ✅ Edge cases (boundary conditions)
   *    ✅ Validation logic
   *    ❌ Don't test TypeORM itself
   *    ❌ Don't test third-party libraries
   *
   * 5. ASYNC TESTING:
   *    - Use async/await in test functions
   *    - Use .rejects.toThrow() for async errors
   *    - Always await async operations
   *
   * 6. MOCK VERIFICATION:
   *    - Check that methods were called: toHaveBeenCalled()
   *    - Check call arguments: toHaveBeenCalledWith()
   *    - Check call count: toHaveBeenCalledTimes()
   *
   * TO WRITE YOUR OWN TESTS:
   * 1. Copy this file structure
   * 2. Replace TenanciesService with your service
   * 3. Mock the dependencies your service uses
   * 4. Write tests for each public method
   * 5. Start with happy path, then add error cases
   */
});

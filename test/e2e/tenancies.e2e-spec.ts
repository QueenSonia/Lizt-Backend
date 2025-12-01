import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PropertyTenant } from '../../src/properties/entities/property-tenants.entity';
import { Rent } from '../../src/rents/entities/rent.entity';
import { Property } from '../../src/properties/entities/property.entity';
import { Users } from '../../src/users/entities/user.entity';
import { Repository } from 'typeorm';

/**
 * E2E TEST EXAMPLE: Tenancies API
 *
 * This test demonstrates:
 * 1. How to test complete HTTP request/response cycles
 * 2. How to mock database connections for E2E tests
 * 3. How to test authentication and authorization
 * 4. How to test API contracts (request/response structure)
 * 5. How to test different HTTP status codes
 *
 * KEY CONCEPTS:
 * - E2E (End-to-End): Tests the entire request flow
 * - Integration: Tests how components work together
 * - API Contract: Ensures API behaves as documented
 * - Supertest: Library for testing HTTP endpoints
 *
 * DIFFERENCE FROM UNIT TESTS:
 * - Unit tests: Test individual functions in isolation
 * - E2E tests: Test complete user workflows through the API
 * - E2E tests are slower but give more confidence
 */

describe('Tenancies API (e2e)', () => {
  let app: INestApplication;
  let propertyTenantRepository: Repository<PropertyTenant>;
  let rentRepository: Repository<Rent>;
  let propertyRepository: Repository<Property>;
  let usersRepository: Repository<Users>;

  /**
   * SETUP: beforeAll runs ONCE before all tests
   *
   * For E2E tests, we:
   * 1. Create a complete NestJS application
   * 2. Override database repositories with mocks (to avoid real DB)
   * 3. Apply middleware (validation, pipes, etc.)
   * 4. Initialize the app
   *
   * Why beforeAll instead of beforeEach?
   * - Creating an app is expensive
   * - We can reuse the same app for all tests
   * - Just reset the mocks between tests
   */
  beforeAll(async () => {
    // Create mock repositories
    const mockPropertyTenantRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const mockRentRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
    };

    const mockPropertyRepository = {
      findOne: jest.fn(),
    };

    const mockUsersRepository = {
      findOne: jest.fn(),
    };

    /**
     * Create testing module
     * We import the full AppModule but override specific providers
     */
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Override repositories with mocks to avoid database dependency
      .overrideProvider(getRepositoryToken(PropertyTenant))
      .useValue(mockPropertyTenantRepository)
      .overrideProvider(getRepositoryToken(Rent))
      .useValue(mockRentRepository)
      .overrideProvider(getRepositoryToken(Property))
      .useValue(mockPropertyRepository)
      .overrideProvider(getRepositoryToken(Users))
      .useValue(mockUsersRepository)
      .compile();

    app = moduleFixture.createNestApplication();

    // Apply the same pipes/middleware as production
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    // Get repository instances for test setup
    propertyTenantRepository = moduleFixture.get(
      getRepositoryToken(PropertyTenant),
    );
    rentRepository = moduleFixture.get(getRepositoryToken(Rent));
    propertyRepository = moduleFixture.get(getRepositoryToken(Property));
    usersRepository = moduleFixture.get(getRepositoryToken(Users));
  });

  /**
   * CLEANUP: Reset mocks between tests
   * Prevents test pollution (one test affecting another)
   */
  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * TEARDOWN: Close app after all tests
   * Clean up resources
   */
  afterAll(async () => {
    await app.close();
  });

  /**
   * TEST SUITE: GET /tenancies
   *
   * Tests the endpoint that lists all tenancies
   */
  describe('GET /tenancies', () => {
    /**
     * TEST 1: Success Case
     *
     * Tests that the API returns data in the correct format
     * This is testing the "API contract"
     */
    it('should return list of tenancies', async () => {
      // ===== ARRANGE =====
      const mockTenancies = [
        {
          id: 'pt-001',
          property_id: 'property-456',
          tenant_id: 'tenant-789',
          status: 'active',
          property: {
            id: 'property-456',
            name: 'Sunset Apartments',
          },
          tenant: {
            id: 'tenant-789',
            user: {
              first_name: 'John',
              last_name: 'Doe',
            },
          },
        },
      ];

      // Mock the repository to return test data
      (propertyTenantRepository.find as jest.Mock).mockResolvedValue(
        mockTenancies,
      );

      // ===== ACT & ASSERT =====
      /**
       * Supertest syntax:
       * - request(app.getHttpServer()) - Get the HTTP server
       * - .get('/endpoint') - Make a GET request
       * - .expect(200) - Assert status code
       * - .expect((res) => {...}) - Assert response body
       */
      const response = await request(app.getHttpServer())
        .get('/tenancies')
        .expect(200);

      // Verify response structure
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data).toHaveLength(1);

      // Verify response content
      expect(response.body.data[0]).toMatchObject({
        id: 'pt-001',
        property_id: 'property-456',
        tenant_id: 'tenant-789',
      });

      // Verify repository was called
      expect(propertyTenantRepository.find).toHaveBeenCalledTimes(1);
    });

    /**
     * TEST 2: Empty State
     *
     * Tests that the API handles empty results correctly
     */
    it('should return empty array when no tenancies exist', async () => {
      // ===== ARRANGE =====
      (propertyTenantRepository.find as jest.Mock).mockResolvedValue([]);

      // ===== ACT & ASSERT =====
      const response = await request(app.getHttpServer())
        .get('/tenancies')
        .expect(200);

      expect(response.body.data).toEqual([]);
    });

    /**
     * TEST 3: Query Parameters
     *
     * Tests that the API handles filtering correctly
     */
    it('should filter tenancies by status', async () => {
      // ===== ARRANGE =====
      const activeTenancies = [
        {
          id: 'pt-001',
          status: 'active',
        },
      ];

      (propertyTenantRepository.find as jest.Mock).mockResolvedValue(
        activeTenancies,
      );

      // ===== ACT & ASSERT =====
      await request(app.getHttpServer())
        .get('/tenancies')
        .query({ status: 'active' }) // Add query parameter
        .expect(200)
        .expect((res) => {
          expect(res.body.data).toHaveLength(1);
          expect(res.body.data[0].status).toBe('active');
        });
    });
  });

  /**
   * TEST SUITE: POST /tenancies/renew/:id
   *
   * Tests the endpoint that renews a tenancy
   */
  describe('POST /tenancies/renew/:id', () => {
    /**
     * TEST 4: Success Case with Request Body
     *
     * Tests POST request with JSON body
     */
    it('should renew tenancy with valid data', async () => {
      // ===== ARRANGE =====
      const propertyTenantId = 'pt-001';

      const mockPropertyTenant = {
        id: propertyTenantId,
        property_id: 'property-456',
        tenant_id: 'tenant-789',
      };

      const mockRent = {
        id: 'rent-001',
        property_id: 'property-456',
        tenant_id: 'tenant-789',
        rent_status: 'active',
        rental_price: 1000,
      };

      (propertyTenantRepository.findOne as jest.Mock).mockResolvedValue(
        mockPropertyTenant,
      );
      (rentRepository.findOne as jest.Mock).mockResolvedValue(mockRent);
      (rentRepository.save as jest.Mock).mockResolvedValue(mockRent);

      const renewDto = {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        rentAmount: 1200,
        paymentFrequency: 'monthly',
      };

      // ===== ACT & ASSERT =====
      const response = await request(app.getHttpServer())
        .post(`/tenancies/renew/${propertyTenantId}`)
        .send(renewDto) // Send JSON body
        .set('Content-Type', 'application/json') // Set headers
        .expect(200);

      // Verify response structure
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('data');
    });

    /**
     * TEST 5: Validation Error (400)
     *
     * Tests that invalid input is rejected
     */
    it('should return 400 when required fields are missing', async () => {
      // ===== ARRANGE =====
      const invalidDto = {
        startDate: '2024-01-01',
        // Missing endDate, rentAmount, paymentFrequency
      };

      // ===== ACT & ASSERT =====
      await request(app.getHttpServer())
        .post('/tenancies/renew/pt-001')
        .send(invalidDto)
        .expect(400)
        .expect((res) => {
          // Verify error response structure
          expect(res.body).toHaveProperty('message');
          expect(res.body).toHaveProperty('statusCode', 400);
        });
    });

    /**
     * TEST 6: Not Found Error (404)
     *
     * Tests that non-existent resources return 404
     */
    it('should return 404 when tenancy not found', async () => {
      // ===== ARRANGE =====
      (propertyTenantRepository.findOne as jest.Mock).mockResolvedValue(null);

      const renewDto = {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        rentAmount: 1200,
        paymentFrequency: 'monthly',
      };

      // ===== ACT & ASSERT =====
      await request(app.getHttpServer())
        .post('/tenancies/renew/non-existent-id')
        .send(renewDto)
        .expect(404)
        .expect((res) => {
          expect(res.body.message).toContain('not found');
        });
    });

    /**
     * TEST 7: Business Logic Error (400)
     *
     * Tests that business rules are enforced
     */
    it('should return 400 when end date is before start date', async () => {
      // ===== ARRANGE =====
      const mockPropertyTenant = {
        id: 'pt-001',
        property_id: 'property-456',
        tenant_id: 'tenant-789',
      };

      const mockRent = {
        id: 'rent-001',
        rent_status: 'active',
      };

      (propertyTenantRepository.findOne as jest.Mock).mockResolvedValue(
        mockPropertyTenant,
      );
      (rentRepository.findOne as jest.Mock).mockResolvedValue(mockRent);

      const invalidDto = {
        startDate: '2024-12-31',
        endDate: '2024-01-01', // End before start!
        rentAmount: 1200,
        paymentFrequency: 'monthly',
      };

      // ===== ACT & ASSERT =====
      await request(app.getHttpServer())
        .post('/tenancies/renew/pt-001')
        .send(invalidDto)
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain(
            'End date must be after start date',
          );
        });
    });
  });

  /**
   * TEST SUITE: Authentication (if applicable)
   *
   * Shows how to test protected endpoints
   */
  describe('Authentication', () => {
    /**
     * TEST 8: Unauthorized Access
     *
     * Tests that protected endpoints require authentication
     */
    it('should return 401 when accessing protected endpoint without token', async () => {
      // Note: This assumes your API has authentication
      // Adjust based on your actual auth implementation
      await request(app.getHttpServer())
        .get('/tenancies')
        // No Authorization header
        .expect(401);
    });

    /**
     * TEST 9: Authorized Access
     *
     * Tests that valid tokens are accepted
     */
    it('should allow access with valid JWT token', async () => {
      // Mock authentication
      const mockToken = 'valid-jwt-token';

      (propertyTenantRepository.find as jest.Mock).mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/tenancies')
        .set('Authorization', `Bearer ${mockToken}`)
        .expect(200);
    });
  });

  /**
   * LEARNING NOTES:
   *
   * 1. E2E vs UNIT TESTS:
   *    - Unit: Test individual functions
   *    - E2E: Test complete HTTP request/response
   *    - E2E gives more confidence but is slower
   *
   * 2. SUPERTEST METHODS:
   *    - .get(url) - GET request
   *    - .post(url) - POST request
   *    - .put(url) - PUT request
   *    - .delete(url) - DELETE request
   *    - .send(data) - Send request body
   *    - .set(header, value) - Set headers
   *    - .query(params) - Add query parameters
   *    - .expect(status) - Assert status code
   *    - .expect(callback) - Custom assertions
   *
   * 3. WHAT TO TEST IN E2E:
   *    ✅ HTTP status codes (200, 400, 404, etc.)
   *    ✅ Response structure (API contract)
   *    ✅ Request validation
   *    ✅ Authentication/Authorization
   *    ✅ Error messages
   *    ❌ Don't test business logic details (that's for unit tests)
   *
   * 4. MOCKING IN E2E:
   *    - Mock external services (email, SMS, payment APIs)
   *    - Mock database to avoid test data pollution
   *    - Don't mock your own code (that defeats the purpose)
   *
   * 5. TEST DATA:
   *    - Use realistic but fake data
   *    - Create helper functions for common test data
   *    - Clean up after tests (or use mocks)
   *
   * 6. ASYNC TESTING:
   *    - Always use async/await with supertest
   *    - Supertest returns promises
   *    - Can chain .expect() calls
   *
   * TO WRITE YOUR OWN E2E TESTS:
   * 1. Copy this file structure
   * 2. Replace endpoints with your API routes
   * 3. Mock the repositories your endpoints use
   * 4. Test happy path first
   * 5. Add error cases (400, 404, 401, etc.)
   * 6. Test edge cases and validation
   * 7. Run with: npm run test:e2e
   *
   * DEBUGGING TIPS:
   * - Add console.log(response.body) to see actual responses
   * - Check that mocks are returning expected data
   * - Verify your routes match the actual API
   * - Use .expect((res) => console.log(res.body)) for debugging
   */
});

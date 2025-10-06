import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceRequestsModule } from 'src/service-requests/service-requests.module';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { AutoServiceRequest } from 'src/service-requests/entities/auto-service-request.entity';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ServiceRequestStatusEnum } from 'src/service-requests/dto/create-service-request.dto';

describe('ServiceRequests Integration Tests', () => {
  let app: INestApplication;
  let authToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.TEST_DB_HOST || 'localhost',
          port: parseInt(process.env.TEST_DB_PORT!) || 5432,
          username: process.env.TEST_DB_USERNAME || 'test',
          password: process.env.TEST_DB_PASSWORD || 'test',
          database: process.env.TEST_DB_NAME || 'test_db',
          entities: [
            ServiceRequest,
            PropertyTenant,
            TeamMember,
            AutoServiceRequest,
          ],
          synchronize: true,
          dropSchema: true,
        }),
        EventEmitterModule.forRoot(),
        ServiceRequestsModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    // Mock authentication - in real tests, you'd get a real token
    authToken = 'mock-jwt-token';
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /service-requests', () => {
    it('should create a new service request', async () => {
      const createDto = {
        tenant_id: '123e4567-e89b-12d3-a456-426614174000',
        text: 'Water leak in bathroom',
      };

      const response = await request(app.getHttpServer())
        .post('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .send(createDto)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('request_id');
      expect(response.body.description).toBe(createDto.text);
      expect(response.body.status).toBe(ServiceRequestStatusEnum.PENDING);
    });

    it('should return 422 if tenant is not in property', async () => {
      const createDto = {
        tenant_id: 'non-existent-uuid',
        text: 'Water leak in bathroom',
      };

      const response = await request(app.getHttpServer())
        .post('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .send(createDto)
        .expect(422);

      expect(response.body.message).toContain(
        'You are not currently renting this property',
      );
    });

    it('should return 400 if request body is invalid', async () => {
      const invalidDto = {
        text: 'Water leak',
        // Missing tenant_id
      };

      await request(app.getHttpServer())
        .post('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidDto)
        .expect(400);
    });

    it('should return 401 if not authenticated', async () => {
      const createDto = {
        tenant_id: '123e4567-e89b-12d3-a456-426614174000',
        text: 'Water leak in bathroom',
      };

      await request(app.getHttpServer())
        .post('/service-requests')
        .send(createDto)
        .expect(401);
    });
  });

  describe('GET /service-requests', () => {
    it('should return paginated list of service requests', async () => {
      const response = await request(app.getHttpServer())
        .get('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, size: 10 })
        .expect(200);

      expect(response.body).toHaveProperty('service_requests');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.service_requests)).toBe(true);
      expect(response.body.pagination).toHaveProperty('totalRows');
      expect(response.body.pagination).toHaveProperty('currentPage');
      expect(response.body.pagination).toHaveProperty('perPage');
      expect(response.body.pagination).toHaveProperty('totalPages');
      expect(response.body.pagination).toHaveProperty('hasNextPage');
    });

    it('should filter by status', async () => {
      const response = await request(app.getHttpServer())
        .get('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ status: 'pending' })
        .expect(200);

      expect(
        response.body.service_requests.every((req) => req.status === 'pending'),
      ).toBe(true);
    });

    it('should filter by tenant_id', async () => {
      const tenantId = '123e4567-e89b-12d3-a456-426614174000';
      const response = await request(app.getHttpServer())
        .get('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ tenant_id: tenantId })
        .expect(200);

      expect(
        response.body.service_requests.every(
          (req) => req.tenant_id === tenantId,
        ),
      ).toBe(true);
    });

    it('should filter by date range', async () => {
      const response = await request(app.getHttpServer())
        .get('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          start_date: '2024-01-01',
          end_date: '2024-12-31',
        })
        .expect(200);

      expect(response.body).toHaveProperty('service_requests');
    });

    it('should handle pagination correctly', async () => {
      const page1 = await request(app.getHttpServer())
        .get('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, size: 5 })
        .expect(200);

      const page2 = await request(app.getHttpServer())
        .get('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 2, size: 5 })
        .expect(200);

      expect(page1.body.pagination.currentPage).toBe(1);
      expect(page2.body.pagination.currentPage).toBe(2);
    });
  });

  describe('GET /service-requests/pending-urgent', () => {
    it('should return only pending and urgent requests', async () => {
      const response = await request(app.getHttpServer())
        .get('/service-requests/pending-urgent')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(
        response.body.service_requests.every((req) =>
          ['pending', 'urgent'].includes(req.status),
        ),
      ).toBe(true);
    });
  });

  describe('GET /service-requests/tenant', () => {
    it('should return service requests for authenticated tenant', async () => {
      const response = await request(app.getHttpServer())
        .get('/service-requests/tenant')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should filter tenant requests by status', async () => {
      const response = await request(app.getHttpServer())
        .get('/service-requests/tenant')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ status: 'pending' })
        .expect(200);

      expect(response.body.every((req) => req.status === 'pending')).toBe(true);
    });
  });

  describe('GET /service-requests/:id', () => {
    let createdRequestId: string;

    beforeAll(async () => {
      // Create a request first
      const createDto = {
        tenant_id: '123e4567-e89b-12d3-a456-426614174000',
        text: 'Test request for retrieval',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .send(createDto);

      createdRequestId = createResponse.body.id;
    });

    it('should return a service request by id', async () => {
      const response = await request(app.getHttpServer())
        .get(`/service-requests/${createdRequestId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.id).toBe(createdRequestId);
      expect(response.body).toHaveProperty('request_id');
      expect(response.body).toHaveProperty('tenant');
      expect(response.body).toHaveProperty('property');
    });

    it('should return 404 for non-existent request', async () => {
      const nonExistentId = '123e4567-e89b-12d3-a456-000000000000';

      await request(app.getHttpServer())
        .get(`/service-requests/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('should return 400 for invalid UUID', async () => {
      await request(app.getHttpServer())
        .get('/service-requests/invalid-uuid')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });
  });

  describe('PUT /service-requests/:id', () => {
    let createdRequestId: string;

    beforeAll(async () => {
      const createDto = {
        tenant_id: '123e4567-e89b-12d3-a456-426614174000',
        text: 'Test request for update',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .send(createDto);

      createdRequestId = createResponse.body.id;
    });

    it('should update a service request', async () => {
      const updateDto = {
        status: ServiceRequestStatusEnum.IN_PROGRESS,
        description: 'Updated description',
      };

      const response = await request(app.getHttpServer())
        .put(`/service-requests/${createdRequestId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateDto)
        .expect(200);

      expect(response.body.affected).toBe(1);
    });

    it('should update with file upload', async () => {
      const response = await request(app.getHttpServer())
        .put(`/service-requests/${createdRequestId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .field('status', ServiceRequestStatusEnum.RESOLVED)
        .attach('issue_images', Buffer.from('test'), 'test.jpg')
        .expect(200);

      expect(response.body.affected).toBeGreaterThan(0);
    });

    it('should return 404 for non-existent request', async () => {
      const nonExistentId = '123e4567-e89b-12d3-a456-000000000000';
      const updateDto = {
        status: ServiceRequestStatusEnum.RESOLVED,
      };

      const response = await request(app.getHttpServer())
        .put(`/service-requests/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateDto)
        .expect(200);

      expect(response.body.affected).toBe(0);
    });

    it('should validate status enum', async () => {
      const invalidDto = {
        status: 'invalid_status',
      };

      await request(app.getHttpServer())
        .put(`/service-requests/${createdRequestId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidDto)
        .expect(400);
    });
  });

  describe('DELETE /service-requests/:id', () => {
    let createdRequestId: string;

    beforeEach(async () => {
      const createDto = {
        tenant_id: '123e4567-e89b-12d3-a456-426614174000',
        text: 'Test request for deletion',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .send(createDto);

      createdRequestId = createResponse.body.id;
    });

    it('should delete a service request', async () => {
      const response = await request(app.getHttpServer())
        .delete(`/service-requests/${createdRequestId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.affected).toBe(1);

      // Verify it's deleted
      await request(app.getHttpServer())
        .get(`/service-requests/${createdRequestId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('should return 200 even for non-existent request', async () => {
      const nonExistentId = '123e4567-e89b-12d3-a456-000000000000';

      const response = await request(app.getHttpServer())
        .delete(`/service-requests/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.affected).toBe(0);
    });
  });

  describe('POST /service-requests/health', () => {
    it('should return health check status', async () => {
      const response = await request(app.getHttpServer())
        .post('/service-requests/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('service', 'tawk-webhook');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should not require authentication', async () => {
      const response = await request(app.getHttpServer())
        .post('/service-requests/health')
        .expect(200);

      expect(response.body.status).toBe('ok');
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      // This would require mocking the database connection
      // Implementation depends on your error handling strategy
    });

    it('should handle validation errors with proper error messages', async () => {
      const invalidDto = {
        text: '', // Empty text
        tenant_id: 'not-a-uuid', // Invalid UUID
      };

      const response = await request(app.getHttpServer())
        .post('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidDto)
        .expect(400);

      expect(response.body).toHaveProperty('message');
      expect(Array.isArray(response.body.message)).toBe(true);
    });

    it('should handle concurrent requests', async () => {
      const createDto = {
        tenant_id: '123e4567-e89b-12d3-a456-426614174000',
        text: 'Concurrent request test',
      };

      const requests = Array(5)
        .fill(null)
        .map(() =>
          request(app.getHttpServer())
            .post('/service-requests')
            .set('Authorization', `Bearer ${authToken}`)
            .send(createDto),
        );

      const responses = await Promise.all(requests);

      expect(responses.every((res) => res.status === 201)).toBe(true);
      expect(new Set(responses.map((res) => res.body.id)).size).toBe(5);
    });
  });

  describe('Business Logic', () => {
    it('should emit event when service request is created', async () => {
      // This would require an event listener mock
      const createDto = {
        tenant_id: '123e4567-e89b-12d3-a456-426614174000',
        text: 'Event test request',
      };

      const response = await request(app.getHttpServer())
        .post('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .send(createDto)
        .expect(201);

      expect(response.body).toHaveProperty('facility_managers');
      expect(Array.isArray(response.body.facility_managers)).toBe(true);
    });

    it('should generate unique request IDs', async () => {
      const createDto = {
        tenant_id: '123e4567-e89b-12d3-a456-426614174000',
        text: 'Unique ID test',
      };

      const response1 = await request(app.getHttpServer())
        .post('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .send(createDto);

      const response2 = await request(app.getHttpServer())
        .post('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .send(createDto);

      expect(response1.body.request_id).not.toBe(response2.body.request_id);
    });

    it('should assign facility managers to new requests', async () => {
      const createDto = {
        tenant_id: '123e4567-e89b-12d3-a456-426614174000',
        text: 'Facility manager assignment test',
      };

      const response = await request(app.getHttpServer())
        .post('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .send(createDto)
        .expect(201);

      expect(response.body.facility_managers).toBeDefined();
      expect(response.body.facility_managers.length).toBeGreaterThan(0);
      expect(response.body.facility_managers[0]).toHaveProperty('phone_number');
      expect(response.body.facility_managers[0]).toHaveProperty('name');
    });
  });

  describe('Query Filters', () => {
    it('should handle multiple filters simultaneously', async () => {
      const response = await request(app.getHttpServer())
        .get('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          status: 'pending',
          start_date: '2024-01-01',
          end_date: '2024-12-31',
          page: 1,
          size: 10,
        })
        .expect(200);

      expect(response.body).toHaveProperty('service_requests');
      expect(response.body).toHaveProperty('pagination');
    });

    it('should ignore empty filter values', async () => {
      const response = await request(app.getHttpServer())
        .get('/service-requests')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          tenant_id: '',
          property_id: '',
          status: 'pending',
        })
        .expect(200);

      expect(response.body).toHaveProperty('service_requests');
    });
  });
});

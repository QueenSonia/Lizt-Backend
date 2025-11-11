# Panda Homes Backend - Improvement Action Plan

## 🎯 Executive Summary

This document provides a prioritized, actionable plan to address the issues identified in the Panda Homes backend codebase. Issues are categorized by severity and organized into sprints for systematic improvement.

---

## 🚨 Sprint 0: Critical Security Fixes (Week 1)

### Priority: IMMEDIATE - Do Not Deploy Without These Fixes

#### Task 1.1: Secure Admin/Landlord Creation Endpoints

**Estimated Time**: 2 hours
**Files**: `src/users/users.controller.ts`, `src/users/users.service.ts`

**Actions**:

1. Remove `@SkipAuth()` from `/users/admin` and `/users/landlord` endpoints
2. Implement invite-only system with secure tokens
3. Add super-admin role for creating admins
4. Add email verification for new accounts

**Code Changes**:

```typescript
// Remove @SkipAuth() and add proper guards
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(RolesEnum.SUPER_ADMIN)
@Post('admin')
async createAdmin(@Body() createUserDto: CreateAdminDto) {
  return this.usersService.createAdmin(createUserDto);
}
```

#### Task 1.2: Implement Rate Limiting

**Estimated Time**: 3 hours
**Files**: `src/main.ts`, `src/app.module.ts`

**Actions**:

1. Configure ThrottlerModule
2. Apply global rate limiting
3. Add stricter limits on sensitive endpoints
4. Implement IP-based blocking

**Code Changes**:

```typescript
// app.module.ts
ThrottlerModule.forRoot({
  ttl: 60,
  limit: 100, // 100 requests per minute globally
}),

// Specific endpoints
@Throttle(5, 60) // 5 requests per minute
@Post('login')
async login() {}

@Throttle(3, 300) // 3 requests per 5 minutes
@Post('forgot-password')
async forgotPassword() {}
```

#### Task 1.3: Fix JWT Token Expiry

**Estimated Time**: 4 hours
**Files**: `src/auth/auth.service.ts`, `src/auth/jwt.strategy.ts`

**Actions**:

1. Reduce access token expiry to 15 minutes
2. Implement refresh tokens (7 days)
3. Add token blacklist for logout
4. Implement token rotation

**Code Changes**:

```typescript
// Generate short-lived access token
const accessToken = await this.jwtService.signAsync(payload, {
  secret: this.configService.get('JWT_SECRET'),
  expiresIn: '15m',
});

// Generate refresh token
const refreshToken = await this.jwtService.signAsync(
  { sub: user.id, type: 'refresh' },
  {
    secret: this.configService.get('JWT_REFRESH_SECRET'),
    expiresIn: '7d',
  },
);
```

#### Task 1.4: Remove Hardcoded Credentials

**Estimated Time**: 1 hour
**Files**: `src/whatsapp-bot/whatsapp-bot.service.ts`

**Actions**:

1. Move hardcoded phone number to environment variable
2. Support multiple notification recipients
3. Add configuration for different environments

**Code Changes**:

```typescript
// .env
((SALES_TEAM_PHONE_NUMBERS = 2349138834648), 2348012345678);

// Service
const salesTeamNumbers = this.config.get('SALES_TEAM_PHONE_NUMBERS').split(',');

for (const number of salesTeamNumbers) {
  await this.sendText(number, message);
}
```

**Sprint 0 Total Time**: ~10 hours (1.5 days)

---

## 🔥 Sprint 1: High Priority Fixes (Week 2)

### Task 2.1: Add Database Transactions

**Estimated Time**: 8 hours
**Files**: All services with multi-step operations

**Actions**:

1. Wrap moveTenantIn in transaction
2. Wrap moveTenantOut in transaction
3. Wrap assignTenant in transaction
4. Add rollback error handling

**Priority Operations**:

- `moveTenantIn()` - Updates property, creates rent, creates tenant relationship
- `moveTenantOut()` - Updates property, deactivates rent, updates tenant status
- `assignTenant()` - Creates user, account, rent, property tenant
- `payRent()` - Creates rent, updates property status

#### Task 2.2: Add Database Indexes

**Estimated Time**: 4 hours
**Files**: All entity files

**Actions**:

1. Add indexes on foreign keys
2. Add composite indexes for common queries
3. Add indexes on frequently filtered fields
4. Test query performance before/after

**Indexes to Add**:

```typescript
// Property entity
@Index(['owner_id', 'property_status'])
@Index(['created_at'])
@Index(['location'])

// Rent entity
@Index(['tenant_id', 'rent_status'])
@Index(['property_id', 'rent_status'])
@Index(['lease_end_date'])
@Index(['payment_status'])

// ServiceRequest entity
@Index(['property_id', 'status'])
@Index(['tenant_id', 'status'])
@Index(['date_reported'])
@Index(['assigned_to'])
```

#### Task 2.3: Implement Caching Strategy

**Estimated Time**: 6 hours
**Files**: Services with frequent reads

**Actions**:

1. Cache dashboard statistics (5 minutes)
2. Cache property lists (2 minutes)
3. Cache user profiles (10 minutes)
4. Implement cache invalidation on updates

**Implementation**:

```typescript
@Injectable()
export class PropertiesService {
  async getAllProperties(query: PropertyFilter) {
    const cacheKey = `properties:${query.owner_id}:${JSON.stringify(query)}`;

    const cached = await this.cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const result = await this.fetchProperties(query);

    await this.cache.set(cacheKey, JSON.stringify(result), 120); // 2 minutes

    return result;
  }

  async updateProperty(id: string, data: UpdatePropertyDto) {
    const result = await this.propertyRepository.update(id, data);

    // Invalidate cache
    await this.cache.del(`properties:*`);

    return result;
  }
}
```

#### Task 2.4: Fix N+1 Query Problems

**Estimated Time**: 6 hours
**Files**: All services with relation loading

**Actions**:

1. Identify all N+1 queries
2. Replace with query builder joins
3. Use eager loading where appropriate
4. Test performance improvements

**Sprint 1 Total Time**: ~24 hours (3 days)

---

## 🛠️ Sprint 2: Code Quality & Testing (Week 3-4)

### Task 3.1: Add Unit Tests

**Estimated Time**: 40 hours
**Files**: All services

**Actions**:

1. Set up Jest configuration
2. Write tests for UsersService (10 hours)
3. Write tests for PropertiesService (10 hours)
4. Write tests for RentsService (8 hours)
5. Write tests for ServiceRequestsService (6 hours)
6. Write tests for KYCLinksService (6 hours)

**Target**: 80% code coverage

#### Task 3.2: Add Integration Tests

**Estimated Time**: 20 hours

**Actions**:

1. Set up test database
2. Write API endpoint tests
3. Test authentication flows
4. Test critical user journeys

#### Task 3.3: Refactor Large Services

**Estimated Time**: 16 hours

**Actions**:

1. Split UsersService into smaller services
2. Split PropertiesService into smaller services
3. Extract common logic to utilities
4. Improve code organization

**Sprint 2 Total Time**: ~76 hours (10 days)

---

## 🚀 Sprint 3: Performance & Scalability (Week 5)

### Task 4.1: Implement Background Job Queue

**Estimated Time**: 12 hours

**Actions**:

1. Install and configure Bull/BullMQ
2. Move email sending to queue
3. Move WhatsApp sending to queue
4. Add retry logic
5. Add job monitoring dashboard

#### Task 4.2: Optimize Database Queries

**Estimated Time**: 8 hours

**Actions**:

1. Analyze slow queries
2. Add missing indexes
3. Optimize query builder usage
4. Implement query result caching

#### Task 4.3: Add Monitoring and Metrics

**Estimated Time**: 8 hours

**Actions**:

1. Integrate Prometheus
2. Add custom metrics
3. Set up Grafana dashboards
4. Configure alerts

**Sprint 3 Total Time**: ~28 hours (3.5 days)

---

## 📊 Sprint 4: Reliability & Observability (Week 6)

### Task 5.1: Implement Error Tracking

**Estimated Time**: 4 hours

**Actions**:

1. Integrate Sentry
2. Configure error grouping
3. Set up alerts
4. Add breadcrumbs for debugging

#### Task 5.2: Add Structured Logging

**Estimated Time**: 6 hours

**Actions**:

1. Install Winston or Pino
2. Replace console.log with structured logging
3. Add request correlation IDs
4. Configure log levels per environment

#### Task 5.3: Implement Health Checks

**Estimated Time**: 4 hours

**Actions**:

1. Add /health endpoint
2. Check database connectivity
3. Check Redis connectivity
4. Check external service status

#### Task 5.4: Add Audit Logging

**Estimated Time**: 8 hours

**Actions**:

1. Create AuditLog entity
2. Log all CRUD operations
3. Log authentication events
4. Add audit log viewer

**Sprint 4 Total Time**: ~22 hours (3 days)

---

## 🎨 Sprint 5: Code Quality & Maintainability (Week 7)

### Task 6.1: Remove Code Smells

**Estimated Time**: 12 hours

**Actions**:

1. Remove all commented code
2. Fix inconsistent naming
3. Extract magic numbers to constants
4. Reduce code duplication

#### Task 6.2: Improve Documentation

**Estimated Time**: 8 hours

**Actions**:

1. Add JSDoc comments to all public methods
2. Complete Swagger documentation
3. Add code examples
4. Document error codes

#### Task 6.3: Add API Versioning

**Estimated Time**: 4 hours

**Actions**:

1. Add /api/v1 prefix
2. Set up version routing
3. Document versioning strategy

**Sprint 5 Total Time**: ~24 hours (3 days)

---

## 📈 Long-Term Improvements (Backlog)

### Scalability

- [ ] Implement horizontal scaling strategy
- [ ] Add load balancing configuration
- [ ] Implement database read replicas
- [ ] Add CDN for static assets

### Features

- [ ] Add two-factor authentication
- [ ] Implement OAuth2 (Google, Facebook login)
- [ ] Add file upload progress tracking
- [ ] Implement real-time notifications (Server-Sent Events)

### DevOps

- [ ] Set up CI/CD pipeline
- [ ] Add automated deployment
- [ ] Implement blue-green deployment
- [ ] Add automated backups

### Monitoring

- [ ] Add APM (Application Performance Monitoring)
- [ ] Implement distributed tracing
- [ ] Add user analytics
- [ ] Set up uptime monitoring

---

## 🎯 Quick Wins (Can Do Anytime)

These are small improvements that provide immediate value:

1. **Add .editorconfig** (15 min)
2. **Configure Prettier** (15 min)
3. **Add pre-commit hooks** (30 min)
4. **Remove unused dependencies** (30 min)
5. **Add README with setup instructions** (1 hour)
6. **Add environment variable validation** (1 hour)
7. **Add request timeout configuration** (30 min)
8. **Implement graceful shutdown** (1 hour)

---

## 📊 Estimated Timeline

| Sprint    | Duration    | Focus               | Effort        |
| --------- | ----------- | ------------------- | ------------- |
| Sprint 0  | Week 1      | Critical Security   | 10 hours      |
| Sprint 1  | Week 2      | High Priority Fixes | 24 hours      |
| Sprint 2  | Week 3-4    | Testing & Quality   | 76 hours      |
| Sprint 3  | Week 5      | Performance         | 28 hours      |
| Sprint 4  | Week 6      | Reliability         | 22 hours      |
| Sprint 5  | Week 7      | Maintainability     | 24 hours      |
| **Total** | **7 weeks** |                     | **184 hours** |

---

## 🎬 Getting Started

### Immediate Actions (Today)

1. Review Sprint 0 tasks
2. Prioritize based on your deployment timeline
3. Create tickets/issues for each task
4. Assign to team members

### This Week

1. Complete Sprint 0 (Critical Security)
2. Begin Sprint 1 (High Priority Fixes)
3. Set up testing infrastructure

### This Month

1. Complete Sprints 0-2
2. Achieve 80% test coverage
3. Deploy with confidence

### This Quarter

1. Complete all sprints
2. Implement monitoring
3. Establish maintenance routine

---

## 💡 Success Metrics

Track these metrics to measure improvement:

- **Security**: Zero critical vulnerabilities
- **Testing**: 80%+ code coverage
- **Performance**: <200ms average response time
- **Reliability**: 99.9% uptime
- **Code Quality**: A grade on SonarQube
- **Documentation**: 100% API endpoints documented

---

## 🤝 Need Help?

Refer to:

- `BACKEND_ISSUES_AND_IMPROVEMENTS.md` for detailed issue descriptions
- `BACKEND_COMPLETE_DOCUMENTATION.md` for system understanding
- `SYSTEM_ARCHITECTURE_DIAGRAM.md` for visual reference

Good luck with the improvements! 🚀

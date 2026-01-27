# Requirements Document

## Introduction

This document specifies the requirements for refactoring three critically oversized service files in the NestJS backend application. The target services (`whatsapp-bot.service.ts`, `users.service.ts`, and `properties.service.ts`) each exceed 3,600 lines and violate the Single Responsibility Principle by mixing multiple unrelated concerns. The refactoring will extract cohesive domain modules while maintaining backward compatibility through facade patterns where needed.

## Glossary

- **Facade_Pattern**: A structural design pattern that provides a simplified interface to a complex subsystem, allowing the original service to delegate to extracted services while maintaining its public API
- **WhatsApp_Bot_Service**: The service handling WhatsApp messaging, currently mixing template sending, tenant flows, landlord flows, and session management
- **Users_Service**: The service managing user operations, currently mixing tenant CRUD, authentication, team management, KYC operations, and notifications
- **Properties_Service**: The service managing property operations, currently mixing CRUD, tenant assignments, property groups, and data maintenance utilities
- **Template_Sender_Service**: Proposed extracted service for all WhatsApp template sending methods
- **Tenant_Flow_Service**: Proposed extracted service for tenant message handling in WhatsApp bot
- **Landlord_Flow_Service**: Proposed extracted service for landlord/facility manager message handling
- **Tenant_Management_Service**: Proposed extracted service for tenant-specific operations from Users_Service
- **Team_Service**: Proposed extracted service for team/collaborator management
- **Password_Service**: Proposed extracted service for password reset and forgot password operations
- **Property_Maintenance_Service**: Proposed extracted service for fix, cleanup, and diagnostic methods
- **Tenant_Assignment_Service**: Proposed extracted service for move-in/move-out logic
- **Property_Groups_Service**: Proposed extracted service for property groups management
- **Backward_Compatibility**: The requirement that existing API contracts and method signatures remain unchanged after refactoring

## Requirements

### Requirement 1: WhatsApp Template Sender Extraction

**User Story:** As a developer, I want all WhatsApp template sending methods extracted into a dedicated TemplateSenderService, so that template management is centralized and the main bot service is more focused.

#### Acceptance Criteria

1. THE Template_Sender_Service SHALL contain all methods matching the pattern `send*Template` from WhatsApp_Bot_Service
2. THE Template_Sender_Service SHALL contain the `sendWhatsappMessageWithTemplate` method
3. THE Template_Sender_Service SHALL contain the `sendToWhatsappAPI` method and related HTTP communication logic
4. WHEN a template method is called on WhatsApp_Bot_Service, THE WhatsApp_Bot_Service SHALL delegate to Template_Sender_Service
5. THE Template_Sender_Service SHALL be injectable as a NestJS provider
6. THE Template_Sender_Service SHALL maintain the same method signatures as the original methods

### Requirement 2: Tenant Flow Extraction

**User Story:** As a developer, I want tenant message handling logic extracted into a dedicated TenantFlowService, so that tenant-specific WhatsApp interactions are isolated and testable.

#### Acceptance Criteria

1. THE Tenant_Flow_Service SHALL contain the `handleText` method for tenant text messages
2. THE Tenant_Flow_Service SHALL contain the `handleInteractive` method for tenant interactive messages
3. THE Tenant_Flow_Service SHALL contain the `cachedResponse` method for tenant session state handling
4. THE Tenant_Flow_Service SHALL contain tenant-specific button handling logic
5. WHEN a tenant message is received, THE WhatsApp_Bot_Service SHALL delegate to Tenant_Flow_Service
6. THE Tenant_Flow_Service SHALL have access to required repositories through dependency injection

### Requirement 3: Landlord Flow Extraction

**User Story:** As a developer, I want landlord and facility manager message handling extracted into dedicated services, so that role-specific flows are maintainable independently.

#### Acceptance Criteria

1. THE Landlord_Flow_Service SHALL contain the `handleFacilityText` method
2. THE Landlord_Flow_Service SHALL contain the `handleFacilityInteractive` method
3. THE Landlord_Flow_Service SHALL contain the `cachedFacilityResponse` method
4. THE Landlord_Flow_Service SHALL contain facility manager-specific button handling logic
5. WHEN a landlord or facility manager message is received, THE WhatsApp_Bot_Service SHALL delegate to Landlord_Flow_Service
6. THE existing `LandlordFlow` class SHALL be integrated with Landlord_Flow_Service

### Requirement 4: Tenant Management Extraction

**User Story:** As a developer, I want tenant-specific operations extracted from UsersService into a dedicated TenantManagementService, so that tenant logic is cohesive and separately testable.

#### Acceptance Criteria

1. THE Tenant_Management_Service SHALL contain the `addTenant` method
2. THE Tenant_Management_Service SHALL contain the `addTenantKyc` method
3. THE Tenant_Management_Service SHALL contain the `attachTenantToProperty` method
4. THE Tenant_Management_Service SHALL contain the `attachTenantFromKyc` method
5. THE Tenant_Management_Service SHALL contain the `getAllTenants` method
6. THE Tenant_Management_Service SHALL contain the `getTenantsOfAnAdmin` method
7. THE Tenant_Management_Service SHALL contain the `getSingleTenantOfAnAdmin` method
8. THE Tenant_Management_Service SHALL contain the `getTenantAndPropertyInfo` method
9. WHEN a tenant operation is called on Users_Service, THE Users_Service SHALL delegate to Tenant_Management_Service
10. THE Tenant_Management_Service SHALL maintain transactional integrity for multi-step operations

### Requirement 5: Team Service Extraction

**User Story:** As a developer, I want team and collaborator management extracted into a dedicated TeamService, so that team operations are isolated from user authentication concerns.

#### Acceptance Criteria

1. THE Team_Service SHALL contain the `assignCollaboratorToTeam` method
2. THE Team_Service SHALL contain the `getTeamMembers` method
3. THE Team_Service SHALL contain the `updateTeamMember` method
4. THE Team_Service SHALL contain the `deleteTeamMember` method
5. WHEN a team operation is called on Users_Service, THE Users_Service SHALL delegate to Team_Service
6. THE Team_Service SHALL enforce role-based access control for team operations

### Requirement 6: Password Service Extraction

**User Story:** As a developer, I want password-related operations extracted into a dedicated PasswordService, so that authentication flows are separated from user management.

#### Acceptance Criteria

1. THE Password_Service SHALL contain the `forgotPassword` method
2. THE Password_Service SHALL contain the `resetPassword` method
3. THE Password_Service SHALL contain the `generatePasswordResetToken` method
4. WHEN a password operation is called on Users_Service, THE Users_Service SHALL delegate to Password_Service
5. THE Password_Service SHALL handle token generation and validation
6. THE Password_Service SHALL integrate with email notification services

### Requirement 7: Property Maintenance Extraction

**User Story:** As a developer, I want all fix, cleanup, and diagnostic methods extracted into a dedicated PropertyMaintenanceService, so that maintenance utilities are separated from core property operations.

#### Acceptance Criteria

1. THE Property_Maintenance_Service SHALL contain the `fixTenantDataLeakage` method
2. THE Property_Maintenance_Service SHALL contain the `checkTenantDataFix` method
3. THE Property_Maintenance_Service SHALL contain the `diagnoseTenantDataLeakage` method
4. THE Property_Maintenance_Service SHALL contain the `cleanupDuplicateTenantAssignments` method
5. THE Property_Maintenance_Service SHALL contain the `fixOrphanedRentRecords` method
6. THE Property_Maintenance_Service SHALL contain the `checkAndFixRentConsistency` method
7. THE Property_Maintenance_Service SHALL contain the `fixSpecificRentRecord` method
8. WHEN a maintenance operation is called on Properties_Service, THE Properties_Service SHALL delegate to Property_Maintenance_Service
9. THE Property_Maintenance_Service SHALL log all fix operations for audit purposes

### Requirement 8: Tenant Assignment Extraction

**User Story:** As a developer, I want tenant move-in/move-out logic extracted into a dedicated TenantAssignmentService, so that tenancy lifecycle management is cohesive.

#### Acceptance Criteria

1. THE Tenant_Assignment_Service SHALL contain the `moveTenantIn` method
2. THE Tenant_Assignment_Service SHALL contain the `moveTenantOut` method
3. THE Tenant_Assignment_Service SHALL contain the `scheduleMoveTenantOut` method
4. THE Tenant_Assignment_Service SHALL contain the `processMoveTenantOut` method
5. THE Tenant_Assignment_Service SHALL contain the `processScheduledMoveOuts` method
6. THE Tenant_Assignment_Service SHALL contain the `getScheduledMoveOuts` method
7. THE Tenant_Assignment_Service SHALL contain the `cancelScheduledMoveOut` method
8. THE Tenant_Assignment_Service SHALL contain the `assignTenant` method
9. THE Tenant_Assignment_Service SHALL contain move-out verification methods
10. WHEN a tenant assignment operation is called on Properties_Service, THE Properties_Service SHALL delegate to Tenant_Assignment_Service
11. THE Tenant_Assignment_Service SHALL maintain property history records for all moves

### Requirement 9: Property Groups Extraction

**User Story:** As a developer, I want property group management extracted into a dedicated PropertyGroupsService, so that grouping logic is isolated from core property CRUD.

#### Acceptance Criteria

1. THE Property_Groups_Service SHALL contain the `createPropertyGroup` method
2. THE Property_Groups_Service SHALL contain the `getPropertyGroupById` method
3. THE Property_Groups_Service SHALL contain the `getAllPropertyGroups` method
4. WHEN a property group operation is called on Properties_Service, THE Properties_Service SHALL delegate to Property_Groups_Service
5. THE Property_Groups_Service SHALL enforce owner-based access control

### Requirement 10: Backward Compatibility

**User Story:** As a developer, I want all existing API contracts preserved after refactoring, so that dependent code continues to work without modification.

#### Acceptance Criteria

1. THE WhatsApp_Bot_Service SHALL maintain all existing public method signatures
2. THE Users_Service SHALL maintain all existing public method signatures
3. THE Properties_Service SHALL maintain all existing public method signatures
4. WHEN external code calls an original service method, THE original service SHALL delegate to the appropriate extracted service
5. THE original services SHALL act as facades, delegating to extracted services internally
6. IF a method is moved to an extracted service, THEN the original service SHALL expose a delegation method with identical signature

### Requirement 11: Service Size Targets

**User Story:** As a developer, I want each service file to be under 800 lines after refactoring, so that the codebase is maintainable and follows best practices.

#### Acceptance Criteria

1. THE WhatsApp_Bot_Service SHALL be under 800 lines after extraction
2. THE Users_Service SHALL be under 800 lines after extraction
3. THE Properties_Service SHALL be under 800 lines after extraction
4. WHEN a new extracted service is created, THE extracted service SHALL be under 800 lines
5. IF an extracted service exceeds 800 lines, THEN it SHALL be further decomposed

### Requirement 12: Dependency Injection Configuration

**User Story:** As a developer, I want all extracted services properly configured in NestJS modules, so that dependency injection works correctly.

#### Acceptance Criteria

1. THE extracted services SHALL be registered as providers in their respective modules
2. THE extracted services SHALL be exported from their modules for cross-module usage
3. WHEN a service depends on another extracted service, THE dependency SHALL be injected through constructor injection
4. THE module configuration SHALL avoid circular dependencies
5. IF circular dependencies arise, THEN forwardRef SHALL be used appropriately

### Requirement 13: Testing Infrastructure

**User Story:** As a developer, I want the refactored services to be independently testable, so that I can verify correctness at the unit level.

#### Acceptance Criteria

1. THE extracted services SHALL have their dependencies injectable through constructor
2. THE extracted services SHALL not have hidden dependencies on global state
3. WHEN testing an extracted service, THE service SHALL be instantiable with mock dependencies
4. THE facade methods in original services SHALL be testable to verify delegation

### Requirement 14: Strict Type Safety

**User Story:** As a developer, I want all extracted services to be completely type-safe with no `any` or `unknown` types, so that the codebase benefits from full TypeScript compiler checks and IDE support.

#### Acceptance Criteria

1. THE extracted services SHALL NOT use the `any` type in any variable, parameter, return type, or generic
2. THE extracted services SHALL NOT use the `unknown` type except when immediately followed by type narrowing
3. ALL method parameters SHALL have explicit type annotations
4. ALL method return types SHALL have explicit type annotations
5. ALL interface properties SHALL have explicit type definitions
6. WHEN migrating code from original services, ANY existing `any` types SHALL be replaced with proper typed interfaces
7. THE TypeScript compiler SHALL be configured with `strict: true` and `noImplicitAny: true` for extracted services
8. ALL DTOs and interfaces SHALL define complete type structures without optional `any` escape hatches

# Implementation Plan: Service Refactoring

## Overview

This implementation plan breaks down the refactoring of three oversized NestJS service files into smaller, cohesive domain modules. The approach is incremental: extract one service at a time, update the facade, and verify functionality before moving to the next extraction.

## Tasks

- [x] 1. Set up project structure and shared utilities
  - [x] 1.1 Create directory structure for extracted services
    - Create `src/whatsapp-bot/template-sender/` directory
    - Create `src/whatsapp-bot/tenant-flow/` directory
    - Create `src/whatsapp-bot/landlord-flow/` directory
    - Create `src/users/tenant-management/` directory
    - Create `src/users/team/` directory
    - Create `src/users/password/` directory
    - Create `src/properties/maintenance/` directory
    - Create `src/properties/tenant-assignment/` directory
    - Create `src/properties/groups/` directory
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 1.2 Create shared DTOs and interfaces
    - Create `src/common/interfaces/fix-result.interface.ts` with FixResult, CheckResult, DiagnosticResult types
    - Create `src/common/interfaces/template-params.interface.ts` with template parameter types
    - Create `src/common/interfaces/whatsapp-payload.interface.ts` with WhatsApp API types
    - Create `src/common/interfaces/tenant-info.interface.ts` with tenant-related types
    - Create `src/common/interfaces/history-record.interface.ts` with property history types
    - Ensure all interfaces have explicit types with no `any` or `unknown`
    - _Requirements: 1.6, 10.6, 14.5, 14.8_

- [x] 2. Extract WhatsApp Template Sender Service
  - [x] 2.1 Create TemplateSenderService with core methods
    - Create `src/whatsapp-bot/template-sender/template-sender.service.ts`
    - Move `sendToWhatsappAPI` method
    - Move `sendWhatsappMessageWithTemplate` method
    - Move all `send*Template` methods (20+ methods)
    - Configure constructor with ConfigService and HTTP dependencies
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [ ]\* 2.2 Write property test for template method signatures
    - **Property 2: Method Signature Compatibility**
    - Verify all template methods maintain original signatures
    - **Validates: Requirements 1.6**

  - [x] 2.3 Update WhatsappBotService to delegate template methods
    - Inject TemplateSenderService into WhatsappBotService constructor
    - Create delegation methods for all template operations
    - Remove original template method implementations
    - _Requirements: 1.4, 10.4, 10.5_

  - [ ]\* 2.4 Write property test for template delegation
    - **Property 1: Facade Delegation Correctness**
    - Verify facade delegates to TemplateSenderService
    - **Validates: Requirements 1.4**

- [x] 3. Extract Tenant Flow Service
  - [x] 3.1 Create TenantFlowService with message handling
    - Create `src/whatsapp-bot/tenant-flow/tenant-flow.service.ts`
    - Move `handleText` method for tenant messages
    - Move `handleInteractive` method for tenant messages
    - Move `cachedResponse` method
    - Move tenant-specific button handling logic
    - Configure repository and service dependencies
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6_

  - [x] 3.2 Update WhatsappBotService to delegate tenant flow
    - Inject TenantFlowService into WhatsappBotService
    - Update `handleMessage` to delegate tenant messages to TenantFlowService
    - _Requirements: 2.5_

  - [ ]\* 3.3 Write property test for tenant flow delegation
    - **Property 1: Facade Delegation Correctness**
    - Verify tenant messages are delegated to TenantFlowService
    - **Validates: Requirements 2.5**

- [x] 4. Extract Landlord Flow Service
  - [x] 4.1 Create LandlordFlowService with facility manager handling
    - Create `src/whatsapp-bot/landlord-flow/landlord-flow.service.ts`
    - Move `handleFacilityText` method
    - Move `handleFacilityInteractive` method
    - Move `cachedFacilityResponse` method
    - Integrate with existing LandlordFlow class
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6_

  - [x] 4.2 Update WhatsappBotService to delegate landlord flow
    - Inject LandlordFlowService into WhatsappBotService
    - Update `handleMessage` to delegate landlord/FM messages
    - _Requirements: 3.5_

  - [ ]\* 4.3 Write property test for landlord flow delegation
    - **Property 1: Facade Delegation Correctness**
    - Verify landlord/FM messages are delegated to LandlordFlowService
    - **Validates: Requirements 3.5**

- [x] 5. Checkpoint - WhatsApp Bot refactoring complete
  - Ensure all tests pass, ask the user if questions arise.
  - Verify WhatsappBotService is under 800 lines
  - _Requirements: 11.1_
  - **Note**: WhatsappBotService is currently 1314 lines. Core template, tenant flow, and landlord flow functionality has been extracted to separate services. The remaining code includes role detection/routing logic, default handlers, and delegation methods. Further extraction may be considered in a future iteration.

- [x] 6. Extract Tenant Management Service
  - [x] 6.1 Create TenantManagementService with tenant operations
    - Create `src/users/tenant-management/tenant-management.service.ts`
    - Move `addTenant` method
    - Move `addTenantKyc` method
    - Move `attachTenantToProperty` method
    - Move `attachTenantFromKyc` method
    - Move `handleTenantFromKyc` private method
    - Move `getAllTenants` method
    - Move `getTenantsOfAnAdmin` method
    - Move `getSingleTenantOfAnAdmin` method
    - Move `getTenantAndPropertyInfo` method
    - Move helper methods: `calculateNextRentDate`, `mapRentFrequencyToPaymentFrequency`
    - Configure transaction support with DataSource
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [ ]\* 6.2 Write property test for transaction integrity
    - **Property 7: Transaction Integrity for Multi-Step Operations**
    - Verify rollback on failure for addTenant, attachTenantToProperty
    - **Validates: Requirements 4.10**

  - [x] 6.3 Update UsersService to delegate tenant operations
    - Inject TenantManagementService into UsersService
    - Create delegation methods for all tenant operations
    - Remove original tenant method implementations
    - _Requirements: 4.9, 10.4_

  - [ ]\* 6.4 Write property test for tenant delegation
    - **Property 1: Facade Delegation Correctness**
    - Verify facade delegates to TenantManagementService
    - **Validates: Requirements 4.9**

- [x] 7. Extract Team Service
  - [x] 7.1 Create TeamService with team operations
    - Create `src/users/team/team.service.ts`
    - Move `assignCollaboratorToTeam` method
    - Move `getTeamMembers` method
    - Move `updateTeamMember` method
    - Move `deleteTeamMember` method
    - Add `validateLandlordRole` helper method
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]\* 7.2 Write property test for role-based access control
    - **Property 6: Role-Based Access Control Enforcement**
    - Verify non-landlord requesters are rejected
    - **Validates: Requirements 5.6**

  - [x] 7.3 Update UsersService to delegate team operations
    - Inject TeamService into UsersService
    - Create delegation methods for team operations
    - _Requirements: 5.5_

- [x] 8. Extract Password Service
  - [x] 8.1 Create PasswordService with password operations
    - Create `src/users/password/password.service.ts`
    - Move `forgotPassword` method
    - Move `resetPassword` method
    - Move `generatePasswordResetToken` method
    - Add token validation helper
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

  - [ ]\* 8.2 Write property test for token lifecycle
    - **Property 10: Password Token Lifecycle**
    - Verify token validity within expiry, invalid after use
    - **Validates: Requirements 6.5**

  - [x] 8.3 Update UsersService to delegate password operations
    - Inject PasswordService into UsersService
    - Create delegation methods for password operations
    - _Requirements: 6.4, 6.6_

- [ ] 9. Checkpoint - Users Service refactoring complete
  - Ensure all tests pass, ask the user if questions arise.
  - Verify UsersService is under 800 lines
  - _Requirements: 11.2_

- [ ] 10. Extract Property Maintenance Service
  - [ ] 10.1 Create PropertyMaintenanceService with maintenance operations
    - Create `src/properties/maintenance/property-maintenance.service.ts`
    - Move `fixTenantDataLeakage` method
    - Move `checkTenantDataFix` method
    - Move `diagnoseTenantDataLeakage` method
    - Move `cleanupDuplicateTenantAssignments` method
    - Move `fixOrphanedRentRecords` method
    - Move `checkAndFixRentConsistency` method
    - Move `fixSpecificRentRecord` method
    - Add `logMaintenanceOperation` helper for audit logging
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]\* 10.2 Write property test for audit logging
    - **Property 9: Maintenance Operation Audit Logging**
    - Verify all fix operations create audit log entries
    - **Validates: Requirements 7.9**

  - [ ] 10.3 Update PropertiesService to delegate maintenance operations
    - Inject PropertyMaintenanceService into PropertiesService
    - Create delegation methods for maintenance operations
    - _Requirements: 7.8_

- [ ] 11. Extract Tenant Assignment Service
  - [ ] 11.1 Create TenantAssignmentService with move operations
    - Create `src/properties/tenant-assignment/tenant-assignment.service.ts`
    - Move `moveTenantIn` method
    - Move `moveTenantOut` method
    - Move `scheduleMoveTenantOut` private method
    - Move `processMoveTenantOut` private method
    - Move `processScheduledMoveOuts` method
    - Move `getScheduledMoveOuts` method
    - Move `cancelScheduledMoveOut` method
    - Move `assignTenant` method
    - Move `verifyMoveOutTransaction` method
    - Move `verifyMoveOutComplete` method
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_

  - [ ]\* 11.2 Write property test for property history records
    - **Property 8: Property History Record Creation**
    - Verify move operations create PropertyHistory records
    - **Validates: Requirements 8.11**

  - [ ] 11.3 Update PropertiesService to delegate assignment operations
    - Inject TenantAssignmentService into PropertiesService
    - Create delegation methods for assignment operations
    - _Requirements: 8.10_

- [ ] 12. Extract Property Groups Service
  - [ ] 12.1 Create PropertyGroupsService with group operations
    - Create `src/properties/groups/property-groups.service.ts`
    - Move `createPropertyGroup` method
    - Move `getPropertyGroupById` method
    - Move `getAllPropertyGroups` method
    - Add `validateOwnership` helper method
    - _Requirements: 9.1, 9.2, 9.3_

  - [ ]\* 12.2 Write property test for owner access control
    - **Property 6: Role-Based Access Control Enforcement**
    - Verify only owners can access their property groups
    - **Validates: Requirements 9.5**

  - [ ] 12.3 Update PropertiesService to delegate group operations
    - Inject PropertyGroupsService into PropertiesService
    - Create delegation methods for group operations
    - _Requirements: 9.4_

- [ ] 13. Checkpoint - Properties Service refactoring complete
  - Ensure all tests pass, ask the user if questions arise.
  - Verify PropertiesService is under 800 lines
  - _Requirements: 11.3_

- [ ] 14. Update NestJS module configurations
  - [ ] 14.1 Update WhatsappBotModule
    - Register TemplateSenderService, TenantFlowService, LandlordFlowService as providers
    - Export services for cross-module usage
    - Handle circular dependencies with forwardRef if needed
    - _Requirements: 12.1, 12.2, 12.4_

  - [ ] 14.2 Update UsersModule
    - Register TenantManagementService, TeamService, PasswordService as providers
    - Export services for cross-module usage
    - Handle circular dependencies with forwardRef if needed
    - _Requirements: 12.1, 12.2, 12.4_

  - [ ] 14.3 Update PropertiesModule
    - Register PropertyMaintenanceService, TenantAssignmentService, PropertyGroupsService as providers
    - Export services for cross-module usage
    - Handle circular dependencies with forwardRef if needed
    - _Requirements: 12.1, 12.2, 12.4_

- [ ] 15. Verify testability and mock instantiation
  - [ ]\* 15.1 Write property test for constructor injection
    - **Property 4: Constructor Injection Pattern**
    - Verify all extracted services use constructor injection
    - **Validates: Requirements 12.3, 13.1**

  - [ ]\* 15.2 Write property test for mock instantiation
    - **Property 5: Mock Instantiation Capability**
    - Verify all services can be instantiated with mocks
    - **Validates: Requirements 13.3, 13.4**

- [ ] 16. Final verification and cleanup
  - [ ] 16.1 Verify service size compliance
    - Count lines in all service files
    - Ensure all files are under 800 lines
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [ ]\* 16.2 Write property test for service size
    - **Property 3: Service Size Compliance**
    - Verify all service files are under 800 lines
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4**

  - [ ] 16.3 Run full test suite and verify backward compatibility
    - Run existing tests to verify no regressions
    - Verify all public API contracts are maintained
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ] 16.4 Verify strict type safety compliance
    - Run `grep -r "any" --include="*.ts"` on extracted service files to ensure no `any` types
    - Verify TypeScript strict mode passes on all extracted services
    - Ensure all method signatures have explicit type annotations
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.6_

  - [ ]\* 16.5 Write property test for type safety
    - **Property 11: Strict Type Safety Compliance**
    - Verify no `any` types in extracted service files
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4**

- [ ] 17. Final checkpoint - All refactoring complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The refactoring is incremental: complete one service extraction before starting the next
- Use `forwardRef` to handle circular dependencies between services
- **Type Safety**: All extracted code must use explicit types - replace any `any` types from original code with proper interfaces
- When migrating methods, create typed interfaces for parameters and return values that were previously untyped
- Use TypeScript's `strict` mode to catch type issues during development

# Panda Homes Backend - Complete Technical Documentation

## Table of Contents

1. [High-Level Overview](#1-high-level-overview)
2. [Entities / Models](#2-entities--models)
3. [Endpoints (Controllers / Routes)](#3-endpoints-controllers--routes)
4. [Business Logic (Services)](#4-business-logic-services)
5. [Configurations](#5-configurations)
6. [Middleware / Security](#6-middleware--security)
7. [Database](#7-database)
8. [Utilities and Helpers](#8-utilities-and-helpers)
9. [Error Handling & Logging](#9-error-handling--logging)
10. [Startup & Lifecycle](#10-startup--lifecycle)
11. [Summary](#11-summary)

---

## 1. High-Level Overview

### What This Backend Does

**Panda Homes** (branded as "Lizt by Property Kraft") is a comprehensive property management platform that connects landlords, property managers, tenants, and facility managers. It solves the problem of fragmented property management by providing:

- **For Landlords**: Property listing, tenant management, rent tracking, lease management, and automated reminders
- **For Tenants**: Service request submission, rent payment tracking, tenancy information access, and communication with landlords
- **For Facility Managers**: Service request handling, maintenance coordination, and tenant communication
- **For Property Managers**: Multi-property oversight and team collaboration

### Architecture Style

- **Monolithic REST API** built with NestJS framework
- **MVC-inspired pattern** with clear separation:
  - Controllers handle HTTP requests/responses
  - Services contain business logic
  - Repositories manage database operations
  - Entities define data models
- **Event-driven features** using NestJS EventEmitter for notifications
- **Real-time communication** via WebSockets (Socket.io) for chat
- **Scheduled tasks** using NestJS Schedule for automated operations

### Tech Stack

**Core Framework & Language:**

- **NestJS 11.x** - Progressive Node.js framework
- **TypeScript 5.7** - Type-safe JavaScript
- **Node.js** - Runtime environment

**Database & ORM:**

- **PostgreSQL** - Primary relational database (hosted on Neon)
- **TypeORM 0.3.21** - Object-Relational Mapping
- **Redis (ioredis)** - Caching and session management

**Authentication & Security:**

- **JWT (jsonwebtoken)** - Token-based authentication
- **Passport.js** - Authentication middleware
- **bcryptjs** - Password hashing
- **Helmet** - Security headers
- **Cookie-parser** - Cookie handling

**External Services & Integrations:**

- **Cloudinary** - Image and file storage
- **Twilio** - SMS and WhatsApp messaging
- **SendGrid** - Email delivery
- **WhatsApp Business API** - Automated messaging and bot interactions

**Real-time & Communication:**

- **Socket.io** - WebSocket connections for chat
- **Nodemailer** - Email sending (backup to SendGrid)

**Documentation & API:**

- **Swagger/OpenAPI** - API documentation
- **class-validator** - DTO validation
- **class-transformer** - Object transformation

**Development & Testing:**

- **Jest** - Testing framework
- **ESLint & Prettier** - Code quality
- **Docker Compose** - Local development environment

### Data Flow (Request to Response)

```
1. CLIENT REQUEST
   ↓
2. MIDDLEWARE LAYER
   - CORS validation (corsOptions)
   - Helmet security headers
   - Cookie parsing
   - Request body parsing (express.json)
   - JWT authentication (JwtAuthGuard)
   - Role-based authorization (RoleGuard)
   ↓
3. CONTROLLER LAYER
   - Route matching (@Controller, @Get, @Post, etc.)
   - Request validation (ValidationPipe with class-validator)
   - Parameter extraction (@Body, @Param, @Query, @Req)
   - User context injection (@CurrentUser decorator)
   ↓
4. SERVICE LAYER
   - Business logic execution
   - Data validation and transformation
   - Repository calls for database operations
   - External service integration (Cloudinary, Twilio, etc.)
   - Event emission for notifications
   - Cache operations (Redis)
   ↓
5. REPOSITORY/DATABASE LAYER
   - TypeORM query execution
   - Database transactions
   - Relationship loading
   - Data persistence
   ↓
6. RESPONSE PREPARATION
   - Data transformation
   - Error handling (AppExceptionsFilter)
   - Status code setting
   - Response formatting
   ↓
7. CLIENT RESPONSE
   - JSON response with standardized structure
   - HTTP status codes
   - Error messages (if applicable)
```

**Example Flow - Creating a Service Request:**

```
POST /service-requests
  → JwtAuthGuard validates token
  → RoleGuard checks user role (tenant)
  → ServiceRequestsController.create()
    → Validates CreateServiceRequestDto
    → ServiceRequestsService.createServiceRequest()
      → Generates unique request_id
      → Saves to database via TypeORM
      → Emits 'service_request.created' event
      → NotificationService listens and creates notification
      → WhatsAppBotService sends message to facility manager
    → Returns created service request
  → Response: { statusCode: 201, data: {...} }
```

---

## 2. Entities / Models

All entities extend `BaseEntity` which provides common fields:

- `id` (UUID, primary key)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- `deleted_at` (timestamp, for soft deletes)

### 2.1 Users Entity (`Users`)

**Purpose**: Core user information for all system users

**Fields:**

- `first_name` (string, required) - User's first name
- `last_name` (string, required) - User's last name
- `email` (string, required, unique) - User's email address
- `phone_number` (string, required, unique) - Contact number
- `password` (string, nullable) - Hashed password
- `role` (enum: RolesEnum, default: TENANT) - User role: admin, tenant, landlord, facility_manager, rep
- `is_verified` (boolean, default: false) - Email/phone verification status
- `logo_urls` (string[], nullable) - Profile/company logos
- `creator_id` (UUID, nullable) - ID of user who created this account
- `date_of_birth` (date, nullable) - Birth date
- `gender` (enum: Gender, nullable) - male, female, other
- `state_of_origin` (string, nullable) - Origin state
- `lga` (string, nullable) - Local government area
- `nationality` (string, nullable) - Country of citizenship
- `employment_status` (enum: EmploymentStatus, nullable) - employed, self-employed, unemployed, student
- `employer_name` (string, nullable) - For employed users
- `job_title` (string, nullable) - Job position
- `employer_address` (string, nullable) - Employer location
- `monthly_income` (float, nullable) - Income amount
- `work_email` (string, nullable) - Work email
- `business_name` (string, nullable) - For self-employed
- `nature_of_business` (string, nullable) - Business type
- `business_address` (string, nullable) - Business location
- `business_monthly_income` (float, nullable) - Business income
- `business_website` (string, nullable) - Business URL
- `marital_status` (enum: MaritalStatus, nullable) - single, married, divorced, widowed
- `spouse_full_name` (string, nullable) - Spouse name if married
- `spouse_phone_number` (string, nullable) - Spouse contact
- `spouse_occupation` (string, nullable) - Spouse job
- `spouse_employer` (string, nullable) - Spouse employer
- `source_of_funds` (string, nullable) - Income source
- `monthly_income_estimate` (float, nullable) - Estimated income

**Relationships:**

- `accounts` → One-to-Many with Account (a user can have multiple accounts/roles)
- `properties` → One-to-Many with Property (as owner)
- `rents` → One-to-Many with Rent (as tenant)
- `service_requests` → One-to-Many with ServiceRequest (as tenant)
- `property_tenants` → One-to-Many with PropertyTenant
- `property_histories` → One-to-Many with PropertyHistory
- `notice_agreements` → One-to-Many with NoticeAgreement
- `kyc` → One-to-One with KYC
- `tenant_kyc` → One-to-One with TenantKyc

**How It Connects**: Users is the central entity. When a user logs in, their role determines which features they can access. A single user can have multiple accounts (e.g., both tenant and landlord roles).

### 2.2 Account Entity (`Account`)

**Purpose**: Represents different role-based accounts for a user

**Fields:**

- `email` (string, required) - Account email
- `password` (string, nullable) - Hashed password
- `is_verified` (boolean, default: false) - Verification status
- `profile_name` (string, nullable) - Display name
- `role` (enum: RolesEnum, required) - Account role
- `creator_id` (string, nullable) - Creator's ID
- `userId` (UUID, required) - Reference to Users entity

**Relationships:**

- `user` → Many-to-One with Users (CASCADE delete)
- `properties` → One-to-Many with Property (as owner)
- `rents` → One-to-Many with Rent (as tenant)
- `property_tenants` → One-to-Many with PropertyTenant (CASCADE delete)
- `property_histories` → One-to-Many with PropertyHistory
- `service_requests` → One-to-Many with ServiceRequest
- `notice_agreements` → One-to-Many with NoticeAgreement
- `kyc` → One-to-One with KYC
- `notification` → One-to-Many with Notification
- `teamMemberships` → One-to-Many with TeamMember
- `team` → One-to-One with Team (CASCADE delete)
- `kyc_links` → One-to-Many with KYCLink

**How It Connects**: Account separates user identity from role-based access. One user can have multiple accounts (e.g., tenant account and landlord account), allowing them to switch contexts.

### 2.3 Property Entity (`Property`)

**Purpose**: Represents rental properties managed in the system

**Fields:**

- `name` (string, required) - Property name/identifier
- `location` (string, required) - Property address
- `description` (string, nullable) - Property description
- `property_status` (enum: PropertyStatusEnum, default: VACANT) - OCCUPIED, VACANT, INACTIVE
- `owner_id` (UUID, required) - Landlord's account ID
- `property_type` (string, required) - Type (apartment, house, etc.)
- `property_images` (string[], nullable) - Image URLs
- `no_of_bedrooms` (int, required) - Number of bedrooms
- `no_of_bathrooms` (int, required) - Number of bathrooms
- `rental_price` (int, nullable) - Monthly rent amount
- `security_deposit` (int, nullable) - Deposit amount
- `service_charge` (int, nullable) - Additional charges
- `comment` (text, nullable) - Additional notes

**Relationships:**

- `owner` → Many-to-One with Account (via owner_id)
- `property_tenants` → One-to-Many with PropertyTenant
- `rents` → One-to-Many with Rent (CASCADE delete)
- `service_requests` → One-to-Many with ServiceRequest (CASCADE delete)
- `property_histories` → One-to-Many with PropertyHistory
- `rent_increases` → One-to-Many with RentIncrease
- `notice_agreements` → One-to-Many with NoticeAgreement
- `notification` → One-to-Many with Notification
- `kyc_links` → One-to-Many with KYCLink
- `kyc_applications` → One-to-Many with KYCApplication

**How It Connects**: Properties are owned by landlords (Account with role=LANDLORD). When a tenant moves in, a PropertyTenant record is created, and the property_status changes to OCCUPIED.

### 2.4 Rent Entity (`Rent`)

**Purpose**: Tracks rent payments and lease information

**Fields:**

- `property_id` (UUID, required) - Associated property
- `tenant_id` (UUID, required) - Tenant's account ID
- `amount_paid` (int, required) - Payment amount
- `expiry_date` (timestamp, nullable) - Payment expiry
- `lease_start_date` (timestamp, required) - Lease start
- `lease_end_date` (timestamp, required) - Lease end
- `rent_receipts` (string[], nullable) - Receipt image URLs
- `rental_price` (int, nullable) - Monthly rent
- `security_deposit` (int, nullable) - Deposit paid
- `service_charge` (int, nullable) - Service charges
- `payment_frequency` (string, nullable) - Payment schedule
- `payment_status` (enum: RentPaymentStatusEnum, default: PENDING) - PENDING, PAID, OWING
- `rent_status` (enum: RentStatusEnum, default: INACTIVE) - ACTIVE, INACTIVE

**Relationships:**

- `property` → Many-to-One with Property (CASCADE delete)
- `tenant` → Many-to-One with Account (CASCADE delete)

**How It Connects**: Created when a tenant pays rent. Links tenant to property with payment details. Used for tracking payment history and generating reminders.

### 2.5 ServiceRequest Entity (`ServiceRequest`)

**Purpose**: Maintenance and service requests from tenants

**Fields:**

- `request_id` (string, required, unique) - Auto-generated ID (e.g., #SR12345)
- `tenant_name` (string, required) - Tenant's name
- `property_name` (string, required) - Property name
- `issue_category` (string, required) - Category of issue
- `date_reported` (timestamp, required) - Report date
- `resolution_date` (timestamp, nullable) - When resolved
- `description` (text, required) - Issue description
- `issue_images` (string[], nullable) - Image URLs
- `resolvedAt` (date, nullable) - Resolution timestamp
- `notes` (text, nullable) - Admin/manager notes
- `status` (enum: ServiceRequestStatusEnum, default: PENDING) - PENDING, IN_PROGRESS, RESOLVED, URGENT
- `tenant_id` (UUID, required) - Tenant's account ID
- `property_id` (UUID, required) - Property ID
- `assigned_to` (UUID, nullable) - Facility manager ID

**Relationships:**

- `tenant` → Many-to-One with Account
- `property` → Many-to-One with Property (CASCADE delete)
- `messages` → One-to-Many with ChatMessage
- `notification` → One-to-One with Notification
- `facilityManager` → Many-to-One with TeamMember (CASCADE delete)

**How It Connects**: Tenants create service requests for their properties. Landlords or facility managers can view, acknowledge, update, and resolve them. Real-time chat is available for each request.

### 2.6 PropertyTenant Entity (`PropertyTenant`)

**Purpose**: Junction table linking tenants to properties with tenancy details

**Fields:**

- `property_id` (UUID, required) - Property reference
- `tenant_id` (UUID, required) - Tenant account reference
- `tenant_status` (enum: TenantStatusEnum, default: ACTIVE) - ACTIVE, INACTIVE, MOVED_OUT
- `move_in_date` (timestamp, nullable) - When tenant moved in
- `move_out_date` (timestamp, nullable) - When tenant moved out
- `scheduled_move_out_date` (timestamp, nullable) - Planned move-out date

**Relationships:**

- `property` → Many-to-One with Property
- `tenant` → Many-to-One with Account (CASCADE delete)

**How It Connects**: Created when a tenant moves into a property. Tracks the current and historical tenancy status. When a tenant moves out, tenant_status changes to MOVED_OUT.

### 2.7 PropertyHistory Entity (`PropertyHistory`)

**Purpose**: Audit trail of property occupancy changes

**Fields:**

- `property_id` (UUID, required) - Property reference
- `tenant_id` (UUID, required) - Tenant reference
- `action` (string, required) - Action type (e.g., "MOVED_IN", "MOVED_OUT")
- `action_date` (timestamp, required) - When action occurred
- `notes` (text, nullable) - Additional information

**Relationships:**

- `property` → Many-to-One with Property
- `tenant` → Many-to-One with Account

**How It Connects**: Automatically created when tenants move in/out. Provides historical record of all property occupancy changes.

### 2.8 NoticeAgreement Entity (`NoticeAgreement`)

**Purpose**: Formal notices sent to tenants (rent increases, evictions, warnings, etc.)

**Fields:**

- `notice_id` (string, required, unique) - Auto-generated notice ID
- `notice_type` (enum: NoticeType, required) - UPLOAD, RENT_INCREASE, LEASE_RENEWAL, EVICTION, WARNING
- `tenant_name` (string, required) - Tenant's name
- `property_name` (string, required) - Property name
- `effective_date` (timestamp, required) - When notice takes effect
- `notice_image` (string, nullable) - Notice image URL
- `notice_documents` (jsonb, default: []) - Array of document objects with url, name, type
- `status` (enum: NoticeStatus, default: PENDING) - ACKNOWLEDGED, NOT_ACKNOWLEDGED, PENDING
- `send_via` (enum: SendVia[], default: [EMAIL]) - EMAIL, WHATSAPP (can be multiple)
- `additional_notes` (text, nullable) - Extra information
- `property_id` (UUID, nullable) - Property reference
- `tenant_id` (UUID, nullable) - Tenant reference

**Relationships:**

- `property` → Many-to-One with Property
- `tenant` → Many-to-One with Account

**How It Connects**: Landlords create notices for tenants. System can send via email and/or WhatsApp. Tenants can acknowledge receipt.

### 2.9 Notification Entity (`Notification`)

**Purpose**: System notifications for users

**Fields:**

- `date` (string, required) - Notification date
- `type` (enum: NotificationType, required) - Type of notification
- `description` (string, required) - Notification message
- `status` (string, default: 'Pending') - Pending, Completed
- `property_id` (UUID, required) - Related property
- `user_id` (UUID, required) - Recipient user
- `service_request_id` (UUID, nullable) - Related service request

**Relationships:**

- `property` → Many-to-One with Property (CASCADE delete)
- `user` → Many-to-One with Account
- `serviceRequest` → One-to-One with ServiceRequest (CASCADE delete)

**How It Connects**: Created by event listeners when important actions occur (rent due, service request created, etc.). Users can view their notifications.

### 2.10 KYC Entity (`KYC`)

**Purpose**: Know Your Customer information for tenant verification (legacy)

**Fields:**

- `former_house_address` (string, nullable) - Previous address
- `reason_for_leaving` (string, nullable) - Why left previous place
- `former_accomodation_type` (string, nullable) - Previous housing type
- `occupation` (string, required) - Job/occupation
- `employers_name` (string, required) - Employer name
- `employers_address` (string, required) - Employer address
- `state_of_origin` (string, required) - Origin state
- `lga_of_origin` (string, nullable) - LGA
- `home_town` (string, nullable) - Home town
- `nationality` (string, required) - Country
- `religion` (string, required) - Religion
- `marital_status` (string, required) - Marital status
- `name_of_spouse` (string, nullable) - Spouse name
- `next_of_kin` (string, nullable) - Emergency contact
- `next_of_kin_address` (string, nullable) - Emergency contact address
- `guarantor` (string, nullable) - Guarantor name
- `guarantor_address` (string, nullable) - Guarantor address
- `guarantor_occupation` (string, nullable) - Guarantor job
- `guarantor_phone_number` (string, nullable) - Guarantor phone
- `monthly_income` (string, required) - Income amount
- `accept_terms_and_condition` (boolean, default: false) - Terms acceptance

**Relationships:**

- `user` → One-to-One with Account (CASCADE delete)

**How It Connects**: Linked to Account. Contains detailed background information for tenant screening.

### 2.11 TenantKyc Entity (`TenantKyc`)

**Purpose**: Enhanced KYC system with identity hashing to prevent duplicates

**Fields:**

- `first_name` (string, required) - First name
- `last_name` (string, required) - Last name
- `email` (string, nullable) - Email address
- `phone_number` (string, nullable) - Phone number
- `date_of_birth` (date, required) - Birth date
- `gender` (enum: Gender, required) - male, female, other
- `nationality` (string, required) - Country
- `current_residence` (string, nullable) - Current address
- `state_of_origin` (string, nullable) - Origin state
- `local_government_area` (string, nullable) - LGA
- `marital_status` (enum: MaritalStatus, required) - Marital status
- `religion` (string, nullable) - Religion
- `spouse_name_and_contact` (string, nullable) - Spouse info
- `employment_status` (enum: EmploymentStatus, required) - Employment type
- `occupation` (string, nullable) - Job
- `job_title` (string, nullable) - Position
- `employer_name` (string, nullable) - Employer
- `employer_address` (string, nullable) - Employer location
- `employer_phone_number` (string, nullable) - Employer contact
- `monthly_net_income` (string, nullable) - Income
- `reference1_name` (string, nullable) - First reference
- `reference1_address` (string, nullable) - First reference address
- `reference1_relationship` (string, nullable) - Relationship
- `reference1_phone_number` (string, nullable) - First reference phone
- `reference2_name` (string, nullable) - Second reference
- `reference2_address` (string, nullable) - Second reference address
- `reference2_relationship` (string, nullable) - Relationship
- `reference2_phone_number` (string, nullable) - Second reference phone
- `user_id` (UUID, nullable) - Linked user
- `admin_id` (UUID, required) - Admin who created
- `identity_hash` (string, required, unique) - Hash of identifying info to prevent duplicates

**Relationships:**

- `user` → One-to-One with Users (CASCADE remove, no FK constraints)
- `admin` → One-to-One with Users

**How It Connects**: Modern KYC system. Uses identity_hash (based on name, DOB, email, phone) to detect duplicate applications. Can be linked to a user account.

### 2.12 KYCLink Entity (`KYCLink`)

**Purpose**: Shareable links for prospective tenants to submit KYC applications

**Fields:**

- `token` (UUID, required, unique) - Unique link token
- `property_id` (UUID, required) - Property for application
- `landlord_id` (UUID, required) - Landlord who created link
- `expires_at` (timestamp, required) - Link expiration
- `is_active` (boolean, default: true) - Link status

**Relationships:**

- `property` → Many-to-One with Property
- `landlord` → Many-to-One with Account

**How It Connects**: Landlords generate KYC links for vacant properties. Prospective tenants use the link to submit applications. Links expire after a set period.

### 2.13 KYCApplication Entity (`KYCApplication`)

**Purpose**: Submitted KYC applications from prospective tenants

**Fields:**

- `kyc_link_id` (UUID, required) - Link used to apply
- `property_id` (UUID, required) - Property applied for
- `tenant_kyc_id` (UUID, required) - KYC data submitted
- `application_status` (enum, default: PENDING) - PENDING, APPROVED, REJECTED
- `submitted_at` (timestamp, required) - Submission time
- `reviewed_at` (timestamp, nullable) - Review time
- `reviewed_by` (UUID, nullable) - Reviewer ID

**Relationships:**

- `kycLink` → Many-to-One with KYCLink
- `property` → Many-to-One with Property
- `tenantKyc` → Many-to-One with TenantKyc

**How It Connects**: Created when someone submits a KYC form via a KYCLink. Landlords review applications and approve/reject them.

### 2.14 KYCOtp Entity (`KYCOtp`)

**Purpose**: OTP verification for KYC applications

**Fields:**

- `phone_number` (string, required) - Phone to verify
- `otp_code` (string, required) - 6-digit code
- `kyc_token` (string, required) - Associated KYC link token
- `expires_at` (timestamp, required) - OTP expiration (10 minutes)
- `is_active` (boolean, default: true) - OTP status
- `is_verified` (boolean, default: false) - Verification status

**Relationships:**

- None (standalone verification table)

**How It Connects**: When submitting KYC, users verify their phone number. OTP is sent via WhatsApp and must be verified before submission.

### 2.15 ChatMessage Entity (`ChatMessage`)

**Purpose**: Real-time chat messages for service requests

**Fields:**

- `content` (text, required) - Message content
- `sender` (enum: MessageSender, required) - TENANT, ADMIN, FACILITY_MANAGER
- `sender_id` (UUID, required) - Sender's account ID
- `service_request_id` (UUID, required) - Related service request
- `is_read` (boolean, default: false) - Read status

**Relationships:**

- `serviceRequest` → Many-to-One with ServiceRequest (CASCADE delete)

**How It Connects**: Enables real-time communication between tenants and facility managers about service requests via WebSocket.

### 2.16 Team Entity (`Team`)

**Purpose**: Teams for landlords to manage collaborators

**Fields:**

- `team_name` (string, required) - Team name
- `creatorId` (UUID, required) - Landlord who created team

**Relationships:**

- `creatorId` → One-to-One with Account (CASCADE delete)
- `members` → One-to-Many with TeamMember

**How It Connects**: Landlords create teams and add facility managers or other collaborators to help manage properties.

### 2.17 TeamMember Entity (`TeamMember`)

**Purpose**: Members of a landlord's team

**Fields:**

- `team_id` (UUID, required) - Team reference
- `account_id` (UUID, required) - Member's account
- `permissions` (string[], nullable) - Granted permissions
- `role` (enum: RolesEnum, required) - Member role

**Relationships:**

- `team` → Many-to-One with Team (CASCADE delete)
- `account` → Many-to-One with Account (CASCADE delete)

**How It Connects**: Links team members to teams. Defines what each member can do (permissions).

### 2.18 RentIncrease Entity (`RentIncrease`)

**Purpose**: Scheduled rent increases for properties

**Fields:**

- `property_id` (UUID, required) - Property reference
- `new_rental_price` (int, required) - New rent amount
- `new_security_deposit` (int, nullable) - New deposit
- `new_service_charge` (int, nullable) - New service charge
- `effective_date` (timestamp, required) - When increase takes effect
- `is_applied` (boolean, default: false) - Whether applied

**Relationships:**

- `property` → Many-to-One with Property

**How It Connects**: Landlords schedule future rent increases. System automatically applies them on the effective date.

### 2.19 Waitlist Entity (`Waitlist`)

**Purpose**: Prospective users interested in the platform

**Fields:**

- `full_name` (string, required) - Name
- `phone_number` (string, required) - Contact
- `option` (string, required) - Interest type (rent_reminder, reminder_collection, all)
- `referral_name` (string, nullable) - Referred person
- `referral_phone_number` (string, nullable) - Referral contact

**Relationships:**

- None (standalone table)

**How It Connects**: Collected via WhatsApp bot when non-users interact with the system. Sales team follows up.

### 2.20 WhatsappBot Entity (`WhatsappBot`)

**Purpose**: Stores WhatsApp bot conversation state

**Fields:**

- `phone_number` (string, required, unique) - User's phone
- `conversation_state` (jsonb, nullable) - Current conversation context
- `last_interaction` (timestamp, required) - Last message time

**Relationships:**

- None (standalone table)

**How It Connects**: Tracks WhatsApp bot conversations to maintain context across messages.

---

## 3. Endpoints (Controllers / Routes)

All endpoints are prefixed with the base URL (e.g., `http://localhost:3150` or production URL).

### 3.1 Authentication & Users (`/users`)

#### POST `/users/login`

**Purpose**: Authenticate user and create session
**Authentication**: None (public endpoint)
**Request Body**:

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response**:

```json
{
  "statusCode": 200,
  "data": {
    "user": {
      "id": "uuid",
      "first_name": "John",
      "last_name": "Doe",
      "email": "user@example.com",
      "role": "tenant"
    },
    "access_token": "jwt-token"
  }
}
```

**Logic**:

1. Validates email and password
2. Checks if user exists
3. Compares hashed password using bcrypt
4. Generates JWT token with user info
5. Sets HTTP-only cookie with token
6. Returns user data and token

#### POST `/users/logout`

**Purpose**: End user session
**Authentication**: None
**Response**: Clears authentication cookie

#### POST `/users`

**Purpose**: Create new tenant
**Authentication**: JWT required, Role: ADMIN or LANDLORD
**Request Body**:

```json
{
  "first_name": "Jane",
  "last_name": "Smith",
  "email": "jane@example.com",
  "phone_number": "+2348012345678",
  "password": "securepass"
}
```

**Logic**:

1. Validates input data
2. Checks for duplicate email/phone
3. Hashes password
4. Creates Users record
5. Creates Account record with role=TENANT
6. Links account to creator (landlord)

#### GET `/users/tenants`

**Purpose**: Get all tenants with pagination and filters
**Authentication**: JWT required, Role: ADMIN or LANDLORD
**Query Parameters**:

- `page` (number, optional) - Page number
- `size` (number, optional) - Items per page
- `first_name` (string, optional) - Filter by first name
- `last_name` (string, optional) - Filter by last name
- `email` (string, optional) - Filter by email
- `phone_number` (string, optional) - Filter by phone
- `start_date` (string, optional) - Filter by creation date
- `end_date` (string, optional) - Filter by creation date
  **Response**:

```json
{
  "data": [...],
  "pagination": {
    "totalRows": 100,
    "perPage": 10,
    "currentPage": 1,
    "totalPages": 10,
    "hasNextPage": true
  }
}
```

#### GET `/users/profile`

**Purpose**: Get current user's profile
**Authentication**: JWT required
**Response**: User and account details

#### GET `/users/:id`

**Purpose**: Get specific user by ID
**Authentication**: JWT required
**Response**: User details with relationships

#### PUT `/users/:id`

**Purpose**: Update user information
**Authentication**: JWT required
**Request Body**: Partial user data to update
**Logic**: Updates user fields, validates data, returns updated user

#### DELETE `/users/:id`

**Purpose**: Delete user (soft delete)
**Authentication**: JWT required, Role: ADMIN or LANDLORD
**Logic**: Sets deleted_at timestamp, cascades to related records

#### POST `/users/forgot-password`

**Purpose**: Initiate password reset
**Authentication**: None (public)
**Request Body**:

```json
{
  "email": "user@example.com"
}
```

**Logic**:

1. Finds user by email
2. Generates OTP code
3. Stores OTP in PasswordResetToken table
4. Sends OTP via email
5. Returns success message

#### POST `/users/validate-otp`

**Purpose**: Verify OTP code
**Authentication**: None (public)
**Request Body**:

```json
{
  "otp": "123456"
}
```

**Logic**:

1. Finds OTP record
2. Checks expiration
3. Validates code
4. Returns reset token if valid

#### POST `/users/reset-password`

**Purpose**: Reset password with token
**Authentication**: None (public)
**Request Body**:

```json
{
  "token": "reset-token",
  "newPassword": "newpass123"
}
```

**Logic**:

1. Validates reset token
2. Hashes new password
3. Updates user password
4. Invalidates reset token

#### POST `/users/admin`

**Purpose**: Create admin account
**Authentication**: None (public - should be restricted in production)
**Request Body**: Admin user data
**Logic**: Creates user with role=ADMIN

#### POST `/users/landlord`

**Purpose**: Create landlord account
**Authentication**: None (public - for registration)
**Request Body**: Landlord user data
**Logic**: Creates user with role=LANDLORD

#### POST `/users/upload-logos`

**Purpose**: Upload company/profile logos
**Authentication**: JWT required, Role: ADMIN or LANDLORD
**Request**: Multipart form data with up to 10 image files
**Logic**:

1. Validates file types
2. Uploads to Cloudinary
3. Stores URLs in user.logo_urls array

#### GET `/users/team-members`

**Purpose**: Get team members for current user
**Authentication**: JWT required
**Response**: List of team members with permissions

#### POST `/users/assign-collaborator`

**Purpose**: Add team member
**Authentication**: JWT required
**Request Body**:

```json
{
  "email": "member@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "phone_number": "+2348012345678",
  "role": "facility_manager",
  "permissions": ["view_properties", "manage_service_requests"]
}
```

**Logic**:

1. Creates or finds user
2. Creates account with specified role
3. Adds to team
4. Sends invitation email

### 3.2 Properties (`/properties`)

#### POST `/properties`

**Purpose**: Create new property
**Authentication**: JWT required, Role: LANDLORD
**Request Body**:

```json
{
  "name": "Sunset Apartments Unit 5",
  "location": "123 Main St, Lagos",
  "description": "2-bedroom apartment",
  "property_type": "apartment",
  "no_of_bedrooms": 2,
  "no_of_bathrooms": 2,
  "rental_price": 500000,
  "security_deposit": 1000000,
  "service_charge": 50000,
  "property_images": ["url1", "url2"]
}
```

**Logic**:

1. Validates property data
2. Sets owner_id to current user
3. Sets property_status to VACANT
4. Saves to database
5. Returns created property

#### GET `/properties`

**Purpose**: Get all properties for current landlord
**Authentication**: JWT required
**Query Parameters**: page, size, name, property_status, location, search, start_date, end_date
**Response**: Paginated list of properties with tenant information
**Logic**: Filters properties by owner_id, applies search/filters, returns with pagination

#### GET `/properties/vacant`

**Purpose**: Get only vacant properties
**Authentication**: JWT required
**Response**: List of properties with status=VACANT
**Logic**: Used when assigning tenants or generating KYC links

#### GET `/properties/:id`

**Purpose**: Get single property details
**Authentication**: JWT required
**Response**: Property with all relationships (tenants, rents, service requests)

#### GET `/properties/:id/details`

**Purpose**: Get property with full history
**Authentication**: JWT required
**Response**: Property with property_histories, current tenant, rent status

#### PUT `/properties/:id`

**Purpose**: Update property
**Authentication**: JWT required, Role: LANDLORD
**Request Body**: Partial property data
**Logic**:

1. Validates ownership
2. Updates fields
3. If property_images provided, uploads to Cloudinary
4. Returns updated property

#### DELETE `/properties/:id`

**Purpose**: Delete property (soft delete)
**Authentication**: JWT required, Role: LANDLORD
**Logic**:

1. Validates ownership
2. Checks if property has active tenants
3. Soft deletes property
4. Cascades to related records

#### POST `/properties/move-in`

**Purpose**: Move tenant into property
**Authentication**: JWT required, Role: ADMIN or LANDLORD
**Request Body**:

```json
{
  "property_id": "uuid",
  "tenant_id": "uuid",
  "lease_start_date": "2024-01-01",
  "lease_end_date": "2024-12-31",
  "rental_price": 500000,
  "security_deposit": 1000000,
  "service_charge": 50000,
  "amount_paid": 1550000,
  "payment_frequency": "monthly"
}
```

**Logic**:

1. Validates property is vacant
2. Creates PropertyTenant record
3. Creates Rent record
4. Updates property_status to OCCUPIED
5. Creates PropertyHistory entry
6. Emits 'tenant.moved_in' event
7. Sends welcome notification

#### POST `/properties/move-out`

**Purpose**: Move tenant out of property
**Authentication**: JWT required, Role: ADMIN or LANDLORD
**Request Body**:

```json
{
  "property_id": "uuid",
  "tenant_id": "uuid",
  "move_out_date": "2024-12-31",
  "reason": "Lease ended"
}
```

**Logic**:

1. Validates tenant occupancy
2. Updates PropertyTenant status to MOVED_OUT
3. Deactivates Rent records
4. Updates property_status to VACANT
5. Creates PropertyHistory entry
6. Deactivates any KYC links

#### GET `/properties/admin/dashboard`

**Purpose**: Get dashboard statistics
**Authentication**: JWT required, Role: ADMIN or LANDLORD
**Response**:

```json
{
  "total_properties": 50,
  "total_tenants": 45,
  "due_tenants": 5,
  "unresolved_requests": 12
}
```

**Logic**: Aggregates counts from various tables for current landlord

### 3.3 Rents (`/rents`)

#### POST `/rents`

**Purpose**: Record rent payment
**Authentication**: JWT required
**Request Body**:

```json
{
  "property_id": "uuid",
  "tenant_id": "uuid",
  "amount_paid": 500000,
  "lease_start_date": "2024-01-01",
  "lease_end_date": "2024-12-31",
  "rental_price": 500000,
  "security_deposit": 1000000,
  "service_charge": 50000,
  "payment_frequency": "monthly",
  "rent_receipts": ["receipt_url"]
}
```

**Logic**:

1. Validates property and tenant
2. Creates Rent record
3. Updates payment_status based on amount
4. Calculates expiry_date
5. Emits 'rent.paid' event
6. Sends confirmation notification

#### GET `/rents`

**Purpose**: Get all rent records
**Authentication**: JWT required
**Query Parameters**: page, size, tenant_id, property_id, status, start_date, end_date
**Response**: Paginated rent records with property and tenant details

#### GET `/rents/tenant/:tenant_id`

**Purpose**: Get rent history for specific tenant
**Authentication**: JWT required
**Response**: All rent payments for tenant

#### GET `/rents/due`

**Purpose**: Get rents due within 7 days
**Authentication**: JWT required, Role: ADMIN or LANDLORD
**Response**: Rents with lease_end_date within next 7 days
**Logic**: Used for sending rent reminders

#### GET `/rents/overdue`

**Purpose**: Get overdue rents
**Authentication**: JWT required, Role: ADMIN or LANDLORD
**Response**: Rents with lease_end_date in the past and payment_status != PAID
**Logic**: Filters by owner_id, returns overdue payments

#### GET `/rents/reminder/:id`

**Purpose**: Send rent reminder to tenant
**Authentication**: JWT required, Role: ADMIN or LANDLORD
**Logic**:

1. Finds rent record
2. Gets tenant contact info
3. Sends reminder via email and WhatsApp
4. Returns success message

#### PUT `/rents/:id`

**Purpose**: Update rent record
**Authentication**: JWT required
**Request Body**: Partial rent data
**Logic**: Updates rent fields, recalculates dates if needed

#### DELETE `/rents/:id`

**Purpose**: Delete rent record
**Authentication**: JWT required
**Logic**: Soft deletes rent record

#### POST `/rents/increase`

**Purpose**: Schedule rent increase
**Authentication**: JWT required, Role: ADMIN or LANDLORD
**Request Body**:

```json
{
  "property_id": "uuid",
  "new_rental_price": 600000,
  "new_security_deposit": 1200000,
  "new_service_charge": 60000,
  "effective_date": "2025-01-01"
}
```

**Logic**:

1. Validates property ownership
2. Creates or updates RentIncrease record
3. Schedules automatic application on effective_date
4. Sends notice to tenant

### 3.4 Service Requests (`/service-requests`)

#### POST `/service-requests`

**Purpose**: Create service request
**Authentication**: JWT required, Role: TENANT
**Request Body**:

```json
{
  "property_id": "uuid",
  "issue_category": "Plumbing",
  "description": "Leaking faucet in kitchen",
  "issue_images": ["image_url"]
}
```

**Logic**:

1. Generates unique request_id (e.g., #SR12345)
2. Gets tenant and property info
3. Creates ServiceRequest record
4. Emits 'service_request.created' event
5. Notifies landlord and facility managers via WhatsApp
6. Creates Notification record
7. Returns created request

#### GET `/service-requests`

**Purpose**: Get all service requests
**Authentication**: JWT required
**Query Parameters**: page, size, status, property_id, tenant_id, start_date, end_date
**Response**: Paginated service requests
**Logic**: Filters based on user role (tenants see their own, landlords see their properties)

#### GET `/service-requests/:id`

**Purpose**: Get single service request
**Authentication**: JWT required
**Response**: Service request with messages, tenant, property details

#### PUT `/service-requests/:id`

**Purpose**: Update service request
**Authentication**: JWT required
**Request Body**:

```json
{
  "status": "IN_PROGRESS",
  "notes": "Plumber scheduled for tomorrow",
  "assigned_to": "facility_manager_id"
}
```

**Logic**:

1. Validates access (tenant, landlord, or assigned facility manager)
2. Updates fields
3. If status changed, emits event
4. Notifies relevant parties
5. Returns updated request

#### DELETE `/service-requests/:id`

**Purpose**: Delete service request
**Authentication**: JWT required, Role: ADMIN or LANDLORD
**Logic**: Soft deletes request

### 3.5 Notifications (`/notifications`)

#### GET `/notifications`

**Purpose**: Get user's notifications
**Authentication**: JWT required
**Query Parameters**: page, size, status, type
**Response**: Paginated notifications for current user

#### PUT `/notifications/:id`

**Purpose**: Mark notification as read/completed
**Authentication**: JWT required
**Request Body**:

```json
{
  "status": "Completed"
}
```

**Logic**: Updates notification status

#### DELETE `/notifications/:id`

**Purpose**: Delete notification
**Authentication**: JWT required
**Logic**: Soft deletes notification

### 3.6 Notice Agreements (`/notice-agreements`)

#### POST `/notice-agreements`

**Purpose**: Create notice for tenant
**Authentication**: JWT required, Role: ADMIN or LANDLORD
**Request Body**:

```json
{
  "property_id": "uuid",
  "tenant_id": "uuid",
  "notice_type": "RENT_INCREASE",
  "effective_date": "2025-01-01",
  "send_via": ["EMAIL", "WHATSAPP"],
  "additional_notes": "Rent will increase by 10%",
  "notice_documents": [
    {
      "url": "document_url",
      "name": "Rent Increase Notice.pdf",
      "type": "application/pdf"
    }
  ]
}
```

**Logic**:

1. Generates unique notice_id
2. Creates NoticeAgreement record
3. Sends notice via specified channels (email/WhatsApp)
4. Returns created notice

#### GET `/notice-agreements`

**Purpose**: Get all notices
**Authentication**: JWT required
**Query Parameters**: page, size, status, notice_type, property_id, tenant_id
**Response**: Paginated notices
**Logic**: Filters based on user role

#### GET `/notice-agreements/:id`

**Purpose**: Get single notice
**Authentication**: JWT required
**Response**: Notice details

#### PUT `/notice-agreements/:id`

**Purpose**: Update notice (e.g., mark as acknowledged)
**Authentication**: JWT required
**Request Body**:

```json
{
  "status": "ACKNOWLEDGED"
}
```

**Logic**: Updates notice status, notifies landlord if acknowledged

### 3.7 KYC Links (`/kyc-links`)

#### POST `/kyc-links/generate`

**Purpose**: Generate KYC link for property
**Authentication**: JWT required, Role: LANDLORD
**Request Body**:

```json
{
  "property_id": "uuid"
}
```

**Response**:

```json
{
  "token": "uuid",
  "link": "https://frontend.com/kyc/uuid",
  "expiresAt": "2024-12-31T23:59:59Z",
  "propertyId": "uuid"
}
```

**Logic**:

1. Validates property ownership
2. Checks property is vacant
3. Generates unique token (UUID)
4. Sets expiration (7 days default)
5. Creates KYCLink record
6. Returns shareable link

#### POST `/kyc-links/send-whatsapp`

**Purpose**: Send KYC link via WhatsApp
**Authentication**: JWT required, Role: LANDLORD
**Request Body**:

```json
{
  "phone_number": "+2348012345678",
  "kyc_link": "https://frontend.com/kyc/uuid",
  "property_name": "Sunset Apartments Unit 5"
}
```

**Logic**:

1. Validates phone number
2. Checks rate limiting
3. Formats WhatsApp message
4. Sends via Twilio/WhatsApp API
5. Returns success/failure status

#### GET `/kyc-links/validate/:token`

**Purpose**: Validate KYC link token
**Authentication**: None (public)
**Response**:

```json
{
  "valid": true,
  "propertyInfo": {
    "id": "uuid",
    "name": "Sunset Apartments Unit 5",
    "location": "123 Main St, Lagos",
    "propertyType": "apartment",
    "bedrooms": 2,
    "bathrooms": 2
  }
}
```

**Logic**:

1. Finds KYCLink by token
2. Checks if active and not expired
3. Checks if property still vacant
4. Returns property info if valid

#### POST `/kyc-links/send-otp`

**Purpose**: Send OTP for phone verification
**Authentication**: None (public)
**Request Body**:

```json
{
  "kyc_token": "uuid",
  "phone_number": "+2348012345678"
}
```

**Logic**:

1. Validates KYC token
2. Generates 6-digit OTP
3. Stores in KYCOtp table (10-minute expiry)
4. Sends OTP via WhatsApp
5. Returns success message

#### POST `/kyc-links/verify-otp`

**Purpose**: Verify OTP code
**Authentication**: None (public)
**Request Body**:

```json
{
  "kyc_token": "uuid",
  "phone_number": "+2348012345678",
  "otp_code": "123456"
}
```

**Logic**:

1. Finds OTP record
2. Checks expiration
3. Validates code
4. Marks as verified
5. Returns verification status

### 3.8 KYC Applications (`/kyc-application`)

#### POST `/kyc-application/submit`

**Purpose**: Submit KYC application
**Authentication**: None (public, uses KYC token)
**Request Body**:

```json
{
  "kyc_token": "uuid",
  "first_name": "John",
  "last_name": "Doe",
  "email": "john@example.com",
  "phone_number": "+2348012345678",
  "date_of_birth": "1990-01-01",
  "gender": "male",
  "nationality": "Nigerian",
  "marital_status": "single",
  "employment_status": "employed",
  "employer_name": "ABC Company",
  "monthly_net_income": "500000",
  "reference1_name": "Jane Smith",
  "reference1_phone_number": "+2348087654321"
  // ... other KYC fields
}
```

**Logic**:

1. Validates KYC token
2. Checks phone verification
3. Generates identity_hash to prevent duplicates
4. Creates TenantKyc record
5. Creates KYCApplication record
6. Notifies landlord
7. Returns application ID

#### GET `/kyc-application/:id`

**Purpose**: Get application details
**Authentication**: JWT required, Role: LANDLORD
**Response**: Application with KYC data

#### PUT `/kyc-application/:id/review`

**Purpose**: Approve or reject application
**Authentication**: JWT required, Role: LANDLORD
**Request Body**:

```json
{
  "application_status": "APPROVED",
  "notes": "Application looks good"
}
```

**Logic**:

1. Validates ownership
2. Updates application status
3. If approved, can create tenant account
4. Notifies applicant
5. Deactivates KYC link

### 3.9 Chat (`/chat` - WebSocket)

#### Event: `join`

**Purpose**: Join chat room for service request
**Payload**: `{ requestId: "uuid" }`
**Logic**: Adds socket to room for real-time updates

#### Event: `send_message`

**Purpose**: Send chat message
**Payload**:

```json
{
  "requestId": "uuid",
  "content": "Message text",
  "sender": "TENANT"
}
```

**Logic**:

1. Validates user access to service request
2. Creates ChatMessage record
3. Broadcasts to all users in room
4. Returns message with timestamp

#### Event: `mark_read`

**Purpose**: Mark messages as read
**Payload**:

```json
{
  "requestId": "uuid",
  "sender": "TENANT"
}
```

**Logic**: Updates is_read for messages from specified sender

### 3.10 WhatsApp Bot (`/whatsapp-bot`)

#### POST `/whatsapp-bot/webhook`

**Purpose**: Receive WhatsApp messages
**Authentication**: Webhook signature validation
**Request Body**: WhatsApp webhook payload
**Logic**:

1. Validates webhook signature
2. Extracts message data
3. Identifies user by phone number
4. Routes to appropriate handler based on user role:
   - Tenant: Service request flow
   - Facility Manager: Request management flow
   - Landlord: Property management flow
   - Unknown: Waitlist/onboarding flow
5. Maintains conversation state in Redis
6. Sends appropriate responses

**Tenant Flow**:

- Menu: Service request, View tenancy, Visit site
- Service request: Collects description, creates request
- View tenancy: Shows property and rent details

**Facility Manager Flow**:

- Menu: Resolve request, View account info
- Resolve request: Lists pending requests, allows acknowledgment/resolution
- Update request: Adds notes to service request

**Landlord Flow**:

- Property management options
- Tenant management
- Report viewing

**Unknown User Flow**:

- Collects interest (property owner, manager, house hunter)
- Adds to waitlist
- Collects referrals

---

## 4. Business Logic (Services)

### 4.1 UsersService

**Core Responsibilities**:

- User authentication and authorization
- User CRUD operations
- Password management (hashing, reset)
- Team and collaborator management
- Account switching for multi-role users

**Key Methods**:

`loginUser(credentials, response)`:

1. Finds user by email
2. Validates password with bcrypt.compare()
3. Generates JWT token with user payload
4. Sets HTTP-only cookie
5. Returns user data and token

`createUser(userData, creatorId)`:

1. Validates unique email/phone
2. Hashes password with bcrypt
3. Creates Users record
4. Creates Account record
5. Links to creator
6. Returns created user

`forgotPassword(email)`:

1. Finds user by email
2. Generates 6-digit OTP
3. Creates PasswordResetToken record
4. Sends OTP via SendGrid email
5. Returns success message

`assignCollaboratorToTeam(landlordId, memberData)`:

1. Finds or creates user
2. Creates account with specified role
3. Finds or creates team
4. Creates TeamMember record
5. Sends invitation email
6. Returns team member

**Error Handling**:

- Throws NotFoundException if user not found
- Throws UnauthorizedException for invalid credentials
- Throws BadRequestException for duplicate email/phone
- Throws ForbiddenException for unauthorized access

### 4.2 PropertiesService

**Core Responsibilities**:

- Property CRUD operations
- Tenant move-in/move-out management
- Property status synchronization
- Dashboard statistics
- Property history tracking

**Key Methods**:

`createProperty(propertyData, ownerId)`:

1. Validates property data
2. Sets owner_id and status=VACANT
3. Saves property
4. Returns created property

`moveTenantIn(moveInData)`:

1. Validates property is vacant
2. Creates PropertyTenant record with status=ACTIVE
3. Creates Rent record
4. Updates property_status to OCCUPIED
5. Creates PropertyHistory entry
6. Emits 'tenant.moved_in' event
7. Sends welcome notification
8. Returns success message

`moveTenantOut(moveOutData, requesterId)`:

1. Validates tenant occupancy
2. Updates PropertyTenant status to MOVED_OUT
3. Sets move_out_date
4. Deactivates Rent records (rent_status=INACTIVE)
5. Updates property_status to VACANT
6. Creates PropertyHistory entry
7. Deactivates KYC links for property
8. Returns success message

`getAdminDashboardStats(landlordId)`:

1. Counts total properties for landlord
2. Counts active tenants
3. Counts rents due within 7 days
4. Counts unresolved service requests
5. Returns aggregated statistics

`syncPropertyStatuses()`:

1. Finds properties with active tenants but status=VACANT
2. Updates to OCCUPIED
3. Finds properties with no active tenants but status=OCCUPIED
4. Updates to VACANT
5. Creates missing PropertyHistory records
6. Returns sync results

**Error Handling**:

- Validates property ownership before operations
- Checks property status before move-in
- Validates tenant occupancy before move-out
- Handles concurrent updates with database transactions

### 4.3 RentsService

**Core Responsibilities**:

- Rent payment recording
- Rent tracking and history
- Due date calculations
- Rent reminders
- Overdue rent identification

**Key Methods**:

`payRent(rentData)`:

1. Validates property and tenant
2. Calculates expiry_date based on payment_frequency
3. Sets payment_status based on amount_paid vs rental_price
4. Creates Rent record
5. Emits 'rent.paid' event
6. Returns created rent

`getDueRentsWithinSevenDays(filters)`:

1. Calculates date 7 days from now
2. Queries rents with lease_end_date between now and 7 days
3. Filters by owner_id
4. Returns paginated results

`getOverdueRents(filters)`:

1. Queries rents with lease_end_date < current date
2. Filters by payment_status != PAID
3. Filters by owner_id
4. Returns paginated results

`sendRentReminder(rentId)`:

1. Finds rent with tenant and property
2. Formats reminder message
3. Sends via email (SendGrid)
4. Sends via WhatsApp (Twilio)
5. Returns success message

`saveOrUpdateRentIncrease(increaseData, landlordId)`:

1. Validates property ownership
2. Finds existing RentIncrease or creates new
3. Updates fields
4. Schedules automatic application
5. Sends notice to tenant
6. Returns rent increase record

**Error Handling**:

- Validates property exists and is occupied
- Validates tenant is assigned to property
- Checks for duplicate rent payments
- Handles failed email/WhatsApp sends gracefully
# Panda Homes Backend Documentation - Part 2

## Continuation of Section 4: Business Logic (Services)

### 4.4 ServiceRequestsService

**Core Responsibilities**:

- Service request creation and management
- Request assignment to facility managers
- Status updates and resolution tracking
- Notification to relevant parties

**Key Methods**:

`createServiceRequest(data)`:

1. Generates unique request_id (format: #SR + random digits)
2. Gets tenant and property information
3. Extracts tenant_name and property_name
4. Creates ServiceRequest record with status=PENDING
5. Finds facility managers assigned to property
6. Emits 'service_request.created' event
7. Returns request with facility manager list

`updateServiceRequest(id, updateData)`:

1. Finds service request
2. Validates user access (tenant, landlord, or assigned manager)
3. Updates fields (status, notes, assigned_to)
4. If status changed to RESOLVED, sets resolution_date
5. Emits status change event
6. Notifies tenant of updates
7. Returns updated request

`assignToFacilityManager(requestId, managerId)`:

1. Validates facility manager exists
2. Updates assigned_to field
3. Notifies manager via WhatsApp
4. Returns updated request

**Error Handling**:

- Validates tenant has access to property
- Checks service request exists
- Validates facility manager assignment
- Handles notification failures gracefully

### 4.5 KYCLinksService

**Core Responsibilities**:

- KYC link generation and management
- Link validation and expiration
- WhatsApp delivery with retry logic
- OTP generation and verification
- Phone number validation

**Key Methods**:

`generateKYCLink(propertyId, landlordId)`:

1. Validates property ownership
2. Checks property is vacant
3. Checks for existing active link
4. Generates UUID token
5. Sets expiration (7 days default)
6. Creates KYCLink record
7. Returns link URL

`validateKYCToken(token)`:

1. Finds KYCLink by token
2. Checks is_active flag
3. Checks expiration date
4. Validates property still exists and is vacant
5. Returns property info if valid

`sendKYCLinkViaWhatsApp(phoneNumber, kycLink, propertyName)`:

1. Validates and normalizes phone number
2. Checks rate limiting
3. Formats WhatsApp message with link
4. Sends via WhatsApp API with retry logic (3 attempts)
5. Updates rate limit counter
6. Returns success/failure status

`sendOTPForKYC(kycToken, phoneNumber)`:

1. Validates KYC token
2. Validates phone number
3. Checks for recent OTP (prevents spam)
4. Generates 6-digit OTP
5. Creates KYCOtp record (10-minute expiry)
6. Sends OTP via WhatsApp
7. Returns success message

`verifyOTPForKYC(kycToken, phoneNumber, otpCode)`:

1. Finds OTP record
2. Checks expiration
3. Validates code matches
4. Marks as verified
5. Deactivates OTP
6. Returns verification status

**Error Handling**:

- Validates property ownership
- Checks property status
- Handles WhatsApp API failures with retry
- Provides fallback messaging
- Rate limits OTP requests
- Validates phone number format

### 4.6 WhatsappBotService

**Core Responsibilities**:

- WhatsApp message handling and routing
- Conversation state management
- Role-based message flows
- Service request creation via WhatsApp
- Waitlist management

**Key Methods**:

`handleMessage(messages)`:

1. Extracts sender phone number
2. Finds user by phone number
3. Determines user role
4. Routes to appropriate handler:
   - Tenant → handleText/handleInteractive
   - Facility Manager → handleFacilityText/handleFacilityInteractive
   - Landlord → LandlordFlow handlers
   - Unknown → handleDefaultText/handleDefaultInteractive

`handleText(message, from)` - Tenant Flow:

1. Checks for special commands (menu, done)
2. Retrieves conversation state from Redis
3. If awaiting_description: Creates service request
4. If view_single_service_request: Searches requests
5. Otherwise: Shows main menu

`handleFacilityText(message, from)` - Facility Manager Flow:

1. Checks for commands (acknowledge request, menu, done)
2. Retrieves facility state from Redis
3. If acknowledged: Updates request status to IN_PROGRESS
4. If resolve-or-update: Prompts for action
5. If awaiting_update: Adds notes to request
6. If awaiting_resolution: Marks request as RESOLVED

`handleDefaultText(message, from)` - Unknown User Flow:

1. Collects user information
2. Adds to waitlist
3. Notifies sales team
4. Requests referrals

`sendButtons(to, message, buttons)`:

1. Formats WhatsApp interactive button message
2. Sends via WhatsApp API
3. Returns success status

`sendText(to, message)`:

1. Formats plain text message
2. Sends via WhatsApp API
3. Returns success status

**Conversation State Management**:

- Uses Redis for temporary state storage
- Keys format: `service_request_state_{phone_number}`
- 5-minute timeout for sessions
- States: awaiting_description, acknowledged, resolve-or-update, etc.

**Error Handling**:

- Validates user exists
- Handles invalid commands gracefully
- Provides helpful error messages
- Falls back to main menu on errors

### 4.7 NotificationService

**Core Responsibilities**:

- Creating notifications for users
- Event-driven notification generation
- Notification delivery coordination

**Key Methods**:

`createNotification(notificationData)`:

1. Creates Notification record
2. Links to user, property, and optionally service request
3. Returns created notification

**Event Listeners**:

- `@OnEvent('rent.due')`: Creates notification when rent is due
- `@OnEvent('service_request.created')`: Notifies landlord of new request
- `@OnEvent('service_request.updated')`: Notifies tenant of status change
- `@OnEvent('tenant.moved_in')`: Welcome notification for new tenant

### 4.8 ChatService

**Core Responsibilities**:

- Real-time chat message handling
- Message persistence
- Read status tracking

**Key Methods**:

`sendMessage(userId, messageData)`:

1. Validates user access to service request
2. Creates ChatMessage record
3. Returns message with timestamp

`getMessages(requestId, userId)`:

1. Validates user access
2. Retrieves all messages for request
3. Returns ordered by created_at

`markMessagesAsRead(requestId, sender)`:

1. Updates is_read=true for messages from sender
2. Returns update count

---

## 5. Configurations

### 5.1 Environment Variables (.env)

**Server Configuration**:

- `PORT` - Server port (default: 3150)
- `NODE_ENV` - Environment (production, development)
- `FRONTEND_URL` - Frontend application URL for CORS and links

**Database Configuration**:

- `PROD_DB_HOST` - PostgreSQL host
- `PROD_PORT` - PostgreSQL port
- `PROD_DB_NAME` - Database name
- `PROD_DB_USERNAME` - Database user
- `PROD_DB_PASSWORD` - Database password
- `PROD_DB_SSL` - SSL mode (require)
- `DB_MAX_CONNECTIONS` - Connection pool size (default: 5)
- `DB_CONNECTION_TIMEOUT` - Connection timeout in ms (default: 10000)
- `DB_IDLE_TIMEOUT` - Idle connection timeout in ms (default: 10000)

**Authentication**:

- `JWT_SECRET` - Secret key for JWT signing
- `JWT_EXPIRY` - Token expiration time (default: 365d)

**Email Configuration (SendGrid)**:

- `SENDGRID_API_KEY` - SendGrid API key
- `SENDGRID_API_KEY_ID` - SendGrid API key ID

**Email Configuration (SMTP Fallback)**:

- `SMTP_HOST` - SMTP server host
- `SMTP_USER` - SMTP username
- `SMTP_PASSWORD` - SMTP password
- `GMAIL_USER` - Gmail account for sending
- `GMAIL_PASSWORD` - Gmail app password

**File Storage (Cloudinary)**:

- `CLOUDINARY_NAME` - Cloudinary cloud name
- `API_KEY` - Cloudinary API key
- `API_SECRET` - Cloudinary API secret

**WhatsApp/SMS (Twilio)**:

- `TWILIO_ACCOUNT_SID` - Twilio account SID
- `TWILIO_AUTH_TOKEN` - Twilio auth token
- `TWILIO_WHATSAPP_NUMBER` - WhatsApp business number

**Pagination Defaults**:

- `DEFAULT_PER_PAGE` - Items per page (default: 10)
- `DEFAULT_PAGE_NO` - Default page number (default: 1)

**KYC Configuration**:

- `KYC_LINK_EXPIRY_DAYS` - Days until KYC link expires (default: 7)

**Rate Limiting**:

- `WHATSAPP_RATE_LIMIT_MAX` - Max WhatsApp messages per window (default: 5)
- `WHATSAPP_RATE_LIMIT_WINDOW` - Rate limit window in minutes (default: 60)

### 5.2 TypeORM Configuration (ormconfig.ts)

**Purpose**: Configures database connection and TypeORM behavior

**Key Settings**:

```typescript
{
  type: 'postgres',
  host: PROD_DB_HOST,
  port: PROD_PORT,
  username: PROD_DB_USERNAME,
  password: PROD_DB_PASSWORD,
  database: PROD_DB_NAME,
  entities: ['dist/**/*.entity{.ts,.js}'],
  synchronize: false, // Use migrations instead
  migrations: ['dist/src/migrations/*{.ts,.js}'],
  ssl: { rejectUnauthorized: false },
  extra: {
    sslmode: 'require',
    max: 5, // Connection pool size
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
    keepAlive: true
  },
  maxQueryExecutionTime: 30000,
  retryAttempts: 3,
  retryDelay: 3000,
  schema: 'public'
}
```

**Connection Pooling**: Limited to 5 connections for Neon database compatibility. Connections are released quickly with 10-second idle timeout.

**SSL**: Required for production database connection with certificate validation disabled for compatibility.

**Migrations**: Disabled synchronize to use migration-based schema management for safety.

### 5.3 CORS Configuration (utils/options.cors.ts)

**Purpose**: Controls cross-origin resource sharing

**Configuration**:

```typescript
{
  origin: FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}
```

**Security**: Restricts origins to frontend URL in production, allows credentials for cookie-based auth.

### 5.4 Swagger Configuration (main.ts)

**Purpose**: API documentation generation

**Configuration**:

```typescript
{
  title: 'Panda Homes',
  description: 'This service enables users access Panda Homes',
  version: '1.0'
}
```

**Access**: Available at `/documentationView` endpoint

### 5.5 Docker Compose (docker-compose.yml)

**Purpose**: Local development environment setup

**Services**:

- `dev-db`: PostgreSQL database
- `redis`: Redis cache
- `pgadmin`: Database management UI

---

## 6. Middleware / Security

### 6.1 Global Middleware (Applied in main.ts)

**express.json()**:

- Parses JSON request bodies
- Stores raw body for webhook signature verification
- Applied before all routes

**CORS (app.enableCors())**:

- Validates request origin
- Allows credentials (cookies)
- Configured via corsOptions

**Helmet (helmet())**:

- Sets security HTTP headers
- Prevents common vulnerabilities:
  - XSS attacks
  - Clickjacking
  - MIME sniffing
  - DNS prefetch control

**Cookie Parser (cookieParser())**:

- Parses cookies from requests
- Enables cookie-based authentication
- Used for JWT token storage

**Compression**:

- Compresses response bodies
- Reduces bandwidth usage
- Improves performance

### 6.2 Validation Pipe (Global)

**Purpose**: Validates and transforms incoming DTOs

**Configuration**:

```typescript
new ValidationPipe({
  whitelist: true, // Strip unknown properties
  transform: true, // Transform to DTO class instances
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY, // 422 for validation errors
});
```

**How It Works**:

1. Receives request body/params/query
2. Validates against DTO class decorators (class-validator)
3. Transforms plain objects to class instances
4. Strips properties not in DTO (whitelist)
5. Returns 422 with validation errors if invalid

**Example DTO**:

```typescript
export class CreatePropertyDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0)
  rental_price: number;
}
```

### 6.3 Authentication Guards

**JwtAuthGuard (jwt-auth.guard.ts)**:

- Extends Passport JWT strategy
- Validates JWT token from:
  - Authorization header (Bearer token)
  - HTTP-only cookie
- Extracts user payload
- Attaches to request.user
- Applied globally (all routes protected by default)

**SkipAuth Decorator (@SkipAuth())**:

- Marks routes as public
- Bypasses JwtAuthGuard
- Used for login, registration, webhooks

**Implementation**:

```typescript
@SkipAuth()
@Post('login')
async login(@Body() body: LoginDto) {
  // Public endpoint
}
```

### 6.4 Authorization Guards

**RoleGuard (role.guard.ts)**:

- Checks user role against required roles
- Uses @Roles() decorator
- Applied per-route or per-controller
- Throws ForbiddenException if unauthorized

**Usage**:

```typescript
@UseGuards(RoleGuard)
@Roles(RolesEnum.ADMIN, RolesEnum.LANDLORD)
@Get('dashboard')
getDashboard() {
  // Only admins and landlords can access
}
```

**How It Works**:

1. Extracts user from request (set by JwtAuthGuard)
2. Gets required roles from @Roles() metadata
3. Checks if user.role matches any required role
4. Allows access if match, throws 403 if not

### 6.5 Exception Filters

**AppExceptionsFilter (app-exceptions-filter.ts)**:

- Global exception handler
- Catches all exceptions
- Standardizes error responses
- Handles specific error types:
  - HttpException → Extracts status and message
  - QueryFailedError → Database errors
  - Unknown errors → 500 Internal Server Error

**Error Response Format**:

```json
{
  "success": false,
  "message": "Error description",
  "statusCode": 400,
  "path": "/api/endpoint"
}
```

**Database Error Handling**:

- `23505` (unique violation) → "Duplicate entry"
- `23503` (foreign key violation) → "Invalid reference"
- `23502` (not null violation) → "Missing required field"

**Validation Error Handling**:

- Converts array of validation errors to comma-separated string
- Extracts nested error messages
- Returns user-friendly messages

### 6.6 Password Security

**Hashing (bcryptjs)**:

- Uses bcrypt algorithm
- Salt rounds: 10 (default)
- Applied on user creation and password reset

**Implementation**:

```typescript
const hashedPassword = await bcrypt.hash(plainPassword, 10);
const isValid = await bcrypt.compare(plainPassword, hashedPassword);
```

### 6.7 JWT Token Security

**Token Generation**:

```typescript
{
  payload: {
    id: user.id,
    email: user.email,
    role: user.role,
    sub: user.id
  },
  secret: JWT_SECRET,
  issuer: 'PANDA-HOMES',
  expiresIn: '365d'
}
```

**Token Storage**:

- HTTP-only cookie (prevents XSS)
- Secure flag in production (HTTPS only)
- SameSite: Strict (prevents CSRF)

**Token Validation**:

- Verifies signature
- Checks expiration
- Validates issuer
- Extracts user payload

---

## 7. Database

### 7.1 Database Structure

**Database Type**: PostgreSQL (hosted on Neon)
**Schema**: public
**ORM**: TypeORM 0.3.21

**Connection Management**:

- Connection pooling (max 5 connections)
- Automatic reconnection on failure
- SSL required for security
- 10-second connection timeout
- 10-second idle timeout for quick release

### 7.2 Entity Relationship Diagram (ERD)

```
Users (Central Entity)
  ├─ One-to-Many → Accounts (userId)
  ├─ One-to-One → KYC
  └─ One-to-One → TenantKyc

Account
  ├─ Many-to-One → Users (CASCADE delete)
  ├─ One-to-Many → Properties (owner_id)
  ├─ One-to-Many → Rents (tenant_id)
  ├─ One-to-Many → PropertyTenant (tenant_id, CASCADE delete)
  ├─ One-to-Many → ServiceRequests (tenant_id)
  ├─ One-to-Many → NoticeAgreements (tenant_id)
  ├─ One-to-Many → Notifications (user_id)
  ├─ One-to-Many → TeamMembers (account_id)
  ├─ One-to-One → Team (creatorId, CASCADE delete)
  └─ One-to-Many → KYCLinks (landlord_id)

Property
  ├─ Many-to-One → Account (owner_id)
  ├─ One-to-Many → PropertyTenants (property_id)
  ├─ One-to-Many → Rents (property_id, CASCADE delete)
  ├─ One-to-Many → ServiceRequests (property_id, CASCADE delete)
  ├─ One-to-Many → PropertyHistories (property_id)
  ├─ One-to-Many → RentIncreases (property_id)
  ├─ One-to-Many → NoticeAgreements (property_id)
  ├─ One-to-Many → Notifications (property_id, CASCADE delete)
  ├─ One-to-Many → KYCLinks (property_id)
  └─ One-to-Many → KYCApplications (property_id)

ServiceRequest
  ├─ Many-to-One → Account (tenant_id)
  ├─ Many-to-One → Property (property_id, CASCADE delete)
  ├─ Many-to-One → TeamMember (assigned_to, CASCADE delete)
  ├─ One-to-Many → ChatMessages (service_request_id, CASCADE delete)
  └─ One-to-One → Notification (service_request_id, CASCADE delete)

Team
  ├─ One-to-One → Account (creatorId, CASCADE delete)
  └─ One-to-Many → TeamMembers (team_id, CASCADE delete)

KYCLink
  ├─ Many-to-One → Property (property_id)
  ├─ Many-to-One → Account (landlord_id)
  └─ One-to-Many → KYCApplications (kyc_link_id)

KYCApplication
  ├─ Many-to-One → KYCLink (kyc_link_id)
  ├─ Many-to-One → Property (property_id)
  └─ Many-to-One → TenantKyc (tenant_kyc_id)
```

### 7.3 Key Relationships Explained

**Users ↔ Accounts (One-to-Many)**:

- One user can have multiple accounts with different roles
- Enables role switching (e.g., user is both tenant and landlord)
- CASCADE delete: Deleting user deletes all accounts

**Account ↔ Properties (One-to-Many)**:

- Landlord account owns multiple properties
- owner_id links property to landlord account

**Property ↔ PropertyTenant (One-to-Many)**:

- Tracks current and historical tenants
- tenant_status indicates ACTIVE, INACTIVE, or MOVED_OUT
- CASCADE delete on tenant side

**Property ↔ Rents (One-to-Many)**:

- Multiple rent payments per property over time
- CASCADE delete: Deleting property deletes rent records

**ServiceRequest ↔ ChatMessages (One-to-Many)**:

- Each service request has its own chat thread
- CASCADE delete: Deleting request deletes messages

**Team ↔ TeamMembers (One-to-Many)**:

- Landlord creates team and adds members
- CASCADE delete: Deleting team removes all members

### 7.4 Migrations

**Migration System**: TypeORM migrations
**Location**: `src/migrations/`
**Master Migration**: `1762532428636-MasterMigration.ts`

**Running Migrations**:

```bash
npm run migration:run
```

**Generating Migrations**:

```bash
npm run migration:generate -- -n MigrationName
```

**Migration Strategy**:

- synchronize: false (manual migrations only)
- All schema changes via migrations
- Ensures data integrity across environments

### 7.5 Indexes and Performance

**Unique Indexes**:

- Users: email, phone_number
- ServiceRequest: request_id
- NoticeAgreement: notice_id
- TenantKyc: identity_hash
- KYCLink: token

**Foreign Key Indexes** (automatic):

- All foreign key columns indexed by TypeORM
- Improves join performance

**Performance Optimizations**:

- Connection pooling (5 connections)
- Query timeout: 30 seconds
- Eager loading for frequently accessed relations
- Pagination for large result sets

---

## 8. Utilities and Helpers

### 8.1 UtilService (utils/utility-service.ts)

**normalizePhoneNumber(phone: string)**:

- Removes spaces, dashes, parentheses
- Adds country code if missing (defaults to +234 for Nigeria)
- Returns international format (e.g., 2348012345678)

**generateOTP(length: number)**:

- Generates random numeric OTP
- Default length: 6 digits
- Used for password reset and phone verification

**toSentenceCase(text: string)**:

- Capitalizes first letter of each word
- Used for displaying names

### 8.2 FileUploadService (utils/cloudinary.ts)

**uploadFile(file: Express.Multer.File, folder: string)**:

- Uploads file to Cloudinary
- Organizes by folder (properties, rents, service_requests)
- Returns secure_url
- Handles image optimization

**deleteFile(publicId: string)**:

- Removes file from Cloudinary
- Used when updating/deleting records

### 8.3 Email Services

**SendGrid (Primary)**:

- Uses @sendgrid/mail package
- Configured with API key
- Sends transactional emails:
  - Password reset OTPs
  - Welcome emails
  - Rent reminders
  - Notice notifications

**Nodemailer (Fallback)**:

- SMTP-based email sending
- Used if SendGrid fails
- Configured with Gmail or custom SMTP

### 8.4 Date Helpers (utils/date.helper.ts)

**calculateLeaseEndDate(startDate, frequency)**:

- Calculates end date based on payment frequency
- Supports: monthly, quarterly, annually
- Returns Date object

**isRentDue(leaseEndDate, daysThreshold)**:

- Checks if rent is due within threshold
- Used for reminder scheduling

### 8.5 Performance Monitor (utils/performance-monitor.ts)

**Purpose**: Tracks slow queries and operations

**Features**:

- Logs queries exceeding maxQueryExecutionTime
- Monitors API response times
- Identifies performance bottlenecks

---

## 9. Error Handling & Logging

### 9.1 Error Handling Strategy

**Layered Error Handling**:

1. **Service Layer**: Throws specific exceptions (NotFoundException, BadRequestException)
2. **Controller Layer**: Catches and re-throws with context
3. **Global Filter**: AppExceptionsFilter catches all, formats response

**Error Types**:

- `NotFoundException` (404): Resource not found
- `BadRequestException` (400): Invalid input
- `UnauthorizedException` (401): Authentication failed
- `ForbiddenException` (403): Insufficient permissions
- `ConflictException` (409): Duplicate resource
- `InternalServerErrorException` (500): Unexpected errors

### 9.2 Error Response Format

**Standard Format**:

```json
{
  "success": false,
  "message": "User-friendly error message",
  "statusCode": 400,
  "path": "/api/users/123"
}
```

**Validation Errors**:

```json
{
  "success": false,
  "message": "name must be a string, rental_price must be a positive number",
  "statusCode": 422,
  "path": "/api/properties"
}
```

### 9.3 Logging

**Console Logging**:

- Server startup: Port and environment
- Database connections: Success/failure
- WhatsApp messages: Sent/failed
- Service requests: Created/updated
- Errors: Full stack traces

**Log Levels** (implicit):

- Info: console.log() - Normal operations
- Warn: console.warn() - Recoverable issues
- Error: console.error() - Failures

**What Gets Logged**:

- All HTTP requests (via NestJS logger)
- Database query errors
- External API failures (Twilio, SendGrid, Cloudinary)
- Authentication attempts
- WhatsApp bot interactions
- Service request lifecycle

---

## 10. Startup & Lifecycle

### 10.1 Application Bootstrap (main.ts)

**Initialization Sequence**:

1. **Create NestJS Application**:

```typescript
const app = await NestFactory.create<NestExpressApplication>(AppModule);
```

2. **Load Configuration**:

- ConfigService loads environment variables
- Validates required variables
- Sets defaults for optional variables

3. **Apply Global Middleware**:

- express.json() with raw body capture
- CORS with credentials
- Helmet security headers
- Cookie parser

4. **Apply Global Pipes**:

- ValidationPipe for DTO validation
- Transform plain objects to class instances
- Whitelist unknown properties

5. **Apply Global Filters**:

- AppExceptionsFilter for error handling

6. **Setup Swagger Documentation**:

- DocumentBuilder configuration
- SwaggerModule.setup() at /documentationView

7. **Start Server**:

```typescript
await app.listen(PORT, '0.0.0.0');
console.log(`🚀 Server running on port:: ${PORT}`);
```

### 10.2 Module Loading (app.module.ts)

**Module Import Order**:

1. **ConfigModule** (Global):

- Loads environment variables
- Makes ConfigService available everywhere
- Caches configuration

2. **TypeORM Module** (Async):

- Waits for ConfigService
- Establishes database connection
- Loads all entities
- Sets up connection pool

3. **AppCacheModule** (Redis):

- Connects to Redis
- Provides CacheService
- Used for session state and rate limiting

4. **EventEmitterModule**:

- Enables event-driven architecture
- Used for notifications and async operations

5. **ScheduleModule**:

- Enables cron jobs
- Used for:
  - Rent reminders
  - Overdue rent checks
  - KYC link expiration cleanup
  - Scheduled move-outs

6. **Feature Modules**:

- AuthModule
- UsersModule
- PropertiesModule
- RentsModule
- ServiceRequestsModule
- PropertyHistoryModule
- NoticeAgreementModule
- NotificationModule
- ChatModule
- TenantKycModule
- WhatsappBotModule
- KYCLinksModule
- TenanciesModule
- EventsModule

### 10.3 Database Connection Lifecycle

**Connection Establishment**:

1. TypeORM reads configuration
2. Attempts connection with retry logic (3 attempts, 3-second delay)
3. Validates schema matches entities
4. Creates connection pool (5 connections)
5. Logs success or failure

**Connection Maintenance**:

- Keep-alive packets every 10 seconds
- Idle connections released after 10 seconds
- Failed connections automatically reconnected
- Query timeout: 30 seconds

**Graceful Shutdown**:

- Closes all active connections
- Waits for pending queries
- Releases connection pool

### 10.4 Scheduled Tasks

**Rent Reminder Cron** (Daily at 9 AM):

```typescript
@Cron('0 9 * * *')
async sendRentReminders() {
  // Find rents due within 7 days
  // Send email and WhatsApp reminders
}
```

**Overdue Rent Check** (Daily at 10 AM):

```typescript
@Cron('0 10 * * *')
async checkOverdueRents() {
  // Find overdue rents
  // Send overdue notifications
  // Update payment status
}
```

**KYC Link Cleanup** (Daily at midnight):

```typescript
@Cron('0 0 * * *')
async cleanupExpiredKYCLinks() {
  // Find expired links
  // Deactivate them
  // Log cleanup results
}
```

**Scheduled Move-Outs** (Daily at 1 AM):

```typescript
@Cron('0 1 * * *')
async processScheduledMoveOuts() {
  // Find move-outs scheduled for today
  // Execute move-out process
  // Update property status
  // Notify landlord
}
```

### 10.5 WebSocket Lifecycle (Chat Gateway)

**Connection Establishment**:

1. Client connects with JWT token
2. Gateway validates token
3. Extracts user info
4. Stores socket with user mapping

**Room Management**:

- Client joins room for service request
- Room ID = service_request_id
- Multiple clients can join same room

**Message Flow**:

1. Client emits 'send_message' event
2. Gateway validates user access
3. Saves message to database
4. Broadcasts to all clients in room
5. Returns confirmation

**Disconnection**:

- Socket automatically removed
- No cleanup needed (stateless)

---

## 11. Summary

### How It All Works Together

**Panda Homes** is a comprehensive property management platform that streamlines the relationship between landlords, tenants, and facility managers through a well-architected NestJS backend.

**Core Flow**:

1. **User Onboarding**:
   - Landlords register and create accounts
   - They add properties with details and images
   - They can create teams and add facility managers

2. **Tenant Acquisition**:
   - Landlords generate shareable KYC links for vacant properties
   - Prospective tenants receive links via WhatsApp
   - Tenants complete KYC forms with phone verification
   - Landlords review applications and approve/reject

3. **Tenancy Management**:
   - Approved tenants are moved into properties
   - System creates rent records and tracks payments
   - Property status automatically updates to OCCUPIED
   - Tenants receive welcome notifications

4. **Ongoing Operations**:
   - Tenants submit service requests via web or WhatsApp
   - Facility managers receive notifications and can respond
   - Real-time chat enables communication
   - Landlords track all activities via dashboard

5. **Rent Management**:
   - System sends automatic reminders 7 days before due date
   - Tracks overdue payments
   - Supports rent increases with tenant notifications
   - Maintains complete payment history

6. **Communication**:
   - Multi-channel notifications (email, WhatsApp, in-app)
   - WhatsApp bot for hands-free interaction
   - Real-time chat for service requests
   - Formal notices for important communications

**Technical Strengths**:

- **Scalable Architecture**: Modular design with clear separation of concerns
- **Security First**: JWT authentication, role-based access, password hashing, HTTPS
- **Real-time Features**: WebSocket chat, instant notifications
- **Reliability**: Connection pooling, retry logic, graceful error handling
- **Automation**: Scheduled tasks, event-driven notifications, WhatsApp bot
- **Data Integrity**: TypeORM migrations, foreign key constraints, soft deletes
- **Performance**: Redis caching, connection pooling, query optimization

**Key Integrations**:

- **Cloudinary**: Reliable image storage and optimization
- **Twilio/WhatsApp**: Multi-channel communication
- **SendGrid**: Transactional email delivery
- **PostgreSQL**: Robust relational data storage
- **Redis**: Fast caching and session management

**Best Practices Implemented**:

- Environment-based configuration
- Comprehensive error handling
- Input validation at all layers
- API documentation with Swagger
- Database migrations for schema management
- Event-driven architecture for decoupling
- Rate limiting for external APIs
- Graceful degradation (fallback mechanisms)

This backend provides a solid foundation for a modern property management platform, with room for growth and additional features as the business scales.

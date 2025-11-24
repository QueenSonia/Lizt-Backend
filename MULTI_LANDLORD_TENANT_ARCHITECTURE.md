# Multi-Landlord Tenant Architecture

## Overview

The system allows a single person to be a tenant for multiple landlords simultaneously. This is achieved through a sophisticated multi-table architecture that separates identity, roles, and landlord-specific data.

## Database Schema

### Core Tables

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USERS TABLE                                  │
│  (One record per person - Global identity)                          │
├─────────────────────────────────────────────────────────────────────┤
│ id: uuid (PK)                                                        │
│ first_name: varchar                                                  │
│ last_name: varchar                                                   │
│ email: varchar (UNIQUE)                                              │
│ phone_number: varchar (UNIQUE) ← Normalized: 2347062639647          │
│ date_of_birth: date                                                  │
│ gender: enum                                                         │
│ nationality: varchar                                                 │
│ ... other personal fields                                            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ One-to-Many
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        ACCOUNTS TABLE                                │
│  (Multiple records per user - Role-based access)                    │
├─────────────────────────────────────────────────────────────────────┤
│ id: uuid (PK)                                                        │
│ userId: uuid (FK → users.id)                                         │
│ email: varchar                                                       │
│ role: enum (TENANT, LANDLORD, ADMIN, etc.)                          │
│ is_verified: boolean                                                 │
│ password: varchar (nullable)                                         │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ One-to-Many
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     TENANT_KYC TABLE                                 │
│  (One record per user-landlord pair)                                │
├─────────────────────────────────────────────────────────────────────┤
│ id: uuid (PK)                                                        │
│ user_id: uuid (FK → users.id)                                        │
│ admin_id: uuid (FK → users.id) ← The Landlord                       │
│ identity_hash: varchar (UNIQUE)                                      │
│ first_name: varchar                                                  │
│ last_name: varchar                                                   │
│ email: varchar                                                       │
│ phone_number: varchar                                                │
│ employment_status: enum                                              │
│ employer_name: varchar                                               │
│ monthly_net_income: varchar                                          │
│ reference1_name: varchar                                             │
│ reference1_phone_number: varchar                                     │
│ reference2_name: varchar                                             │
│ reference2_phone_number: varchar                                     │
│ ... other KYC fields specific to this landlord                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Relationship Tables

```
┌─────────────────────────────────────────────────────────────────────┐
│                   PROPERTY_TENANTS TABLE                             │
│  (Links tenants to properties)                                      │
├─────────────────────────────────────────────────────────────────────┤
│ id: uuid (PK)                                                        │
│ property_id: uuid (FK → properties.id)                               │
│ tenant_id: uuid (FK → accounts.id) ← TENANT account                 │
│ status: enum (ACTIVE, INACTIVE)                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        RENTS TABLE                                   │
│  (Tracks rent agreements)                                           │
├─────────────────────────────────────────────────────────────────────┤
│ id: uuid (PK)                                                        │
│ property_id: uuid (FK → properties.id)                               │
│ tenant_id: uuid (FK → accounts.id) ← TENANT account                 │
│ rental_price: int                                                    │
│ security_deposit: int                                                │
│ lease_start_date: timestamp                                          │
│ lease_end_date: timestamp                                            │
│ rent_status: enum (ACTIVE, INACTIVE)                                 │
│ payment_status: enum (PENDING, PAID, OWING)                         │
└─────────────────────────────────────────────────────────────────────┘
```

## How It Works: Example Scenario

### Scenario: Sonia is a tenant for two different landlords

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USERS TABLE                                  │
├─────────────────────────────────────────────────────────────────────┤
│ id: user-123                                                         │
│ first_name: "Sonia"                                                  │
│ last_name: "Akpati"                                                  │
│ email: "s@gmail.com"                                                 │
│ phone_number: "2347062639647"                                        │
│ date_of_birth: "1997-10-28"                                          │
│ gender: "female"                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ Creates multiple accounts
                              ▼
        ┌─────────────────────┴─────────────────────┐
        │                                            │
        ▼                                            ▼
┌──────────────────────┐                  ┌──────────────────────┐
│   ACCOUNTS TABLE     │                  │   ACCOUNTS TABLE     │
├──────────────────────┤                  ├──────────────────────┤
│ id: account-tenant-1 │                  │ id: account-tenant-2 │
│ userId: user-123     │                  │ userId: user-123     │
│ role: TENANT         │                  │ role: TENANT         │
│ email: s@gmail.com   │                  │ email: s@gmail.com   │
└──────────────────────┘                  └──────────────────────┘
        │                                            │
        │ Used for Landlord A                        │ Used for Landlord B
        ▼                                            ▼
┌──────────────────────┐                  ┌──────────────────────┐
│   TENANT_KYC TABLE   │                  │   TENANT_KYC TABLE   │
├──────────────────────┤                  ├──────────────────────┤
│ id: kyc-1            │                  │ id: kyc-2            │
│ user_id: user-123    │                  │ user_id: user-123    │
│ admin_id: landlord-A │                  │ admin_id: landlord-B │
│ employer_name: "ABC" │                  │ employer_name: "XYZ" │
│ monthly_income: 500k │                  │ monthly_income: 600k │
│ reference1: "John"   │                  │ reference1: "Mary"   │
└──────────────────────┘                  └──────────────────────┘
        │                                            │
        ▼                                            ▼
┌──────────────────────┐                  ┌──────────────────────┐
│ PROPERTY_TENANTS     │                  │ PROPERTY_TENANTS     │
├──────────────────────┤                  ├──────────────────────┤
│ property_id: prop-A  │                  │ property_id: prop-B  │
│ tenant_id: acct-t-1  │                  │ tenant_id: acct-t-2  │
│ status: ACTIVE       │                  │ status: ACTIVE       │
└──────────────────────┘                  └──────────────────────┘
        │                                            │
        ▼                                            ▼
┌──────────────────────┐                  ┌──────────────────────┐
│     RENTS TABLE      │                  │     RENTS TABLE      │
├──────────────────────┤                  ├──────────────────────┤
│ property_id: prop-A  │                  │ property_id: prop-B  │
│ tenant_id: acct-t-1  │                  │ tenant_id: acct-t-2  │
│ rental_price: 100k   │                  │ rental_price: 150k   │
│ rent_status: ACTIVE  │                  │ rent_status: ACTIVE  │
└──────────────────────┘                  └──────────────────────┘
```

## Key Design Principles

### 1. **Single User Identity**

- One record in `users` table per person
- Unique constraints on `email` and `phone_number`
- Stores core personal information

### 2. **Multiple Role-Based Accounts**

- One user can have multiple `accounts` with different roles
- Each account represents a different "hat" the user wears
- Example: Same person can be both LANDLORD and TENANT

### 3. **Landlord-Specific KYC Data**

- `tenant_kyc` table stores landlord-specific information
- Each landlord sees their own version of the tenant's KYC data
- Allows different employment info, references, etc. per landlord
- `admin_id` field identifies which landlord this KYC belongs to

### 4. **Independent Tenancy Relationships**

- `property_tenants` links a specific TENANT account to a property
- `rents` tracks the financial agreement for that tenancy
- Each landlord's data is completely independent

## Data Isolation

### What Each Landlord Sees:

```sql
-- Landlord A queries their tenants
SELECT u.*, tk.*, pt.*, r.*
FROM users u
JOIN accounts a ON a.userId = u.id AND a.role = 'TENANT'
JOIN tenant_kyc tk ON tk.user_id = u.id AND tk.admin_id = 'landlord-A'
JOIN property_tenants pt ON pt.tenant_id = a.id
JOIN properties p ON p.id = pt.property_id AND p.owner_id = 'landlord-A'
JOIN rents r ON r.tenant_id = a.id AND r.property_id = p.id
WHERE pt.status = 'ACTIVE';

-- Result: Only sees Sonia's tenancy in their property with their KYC data
```

### What the Tenant Sees:

```sql
-- Sonia logs in and sees all her tenancies
SELECT p.*, r.*, u_landlord.*
FROM accounts a
JOIN property_tenants pt ON pt.tenant_id = a.id
JOIN properties p ON p.id = pt.property_id
JOIN rents r ON r.tenant_id = a.id AND r.property_id = p.id
JOIN users u_landlord ON u_landlord.id = p.owner_id
WHERE a.userId = 'user-123' AND a.role = 'TENANT';

-- Result: Sees both Property A (Landlord A) and Property B (Landlord B)
```

## Benefits of This Architecture

✅ **Privacy**: Each landlord only sees their own tenant data
✅ **Flexibility**: Tenant can provide different references/employment info per landlord
✅ **No Duplication**: Single user record prevents data inconsistency
✅ **Scalability**: Tenant can rent from unlimited landlords
✅ **Role Flexibility**: Same person can be both landlord and tenant
✅ **Data Integrity**: Proper foreign keys maintain referential integrity

## Important Notes

### Phone Number Normalization

- All phone numbers are normalized before storage: `07062639647` → `2347062639647`
- Search queries must normalize input before querying
- Prevents duplicate user creation

### Account Creation Flow

1. Check if user exists by normalized phone number
2. If user exists, check if they have a TENANT account
3. If no TENANT account, create one (don't create new user)
4. Create/update landlord-specific KYC record
5. Link TENANT account to property via `property_tenants`
6. Create rent agreement in `rents` table

### Constraints

- `users.email`: UNIQUE
- `users.phone_number`: UNIQUE
- `tenant_kyc.identity_hash`: UNIQUE (prevents duplicate KYC per landlord)
- ✅ **A tenant CAN be actively assigned to MULTIPLE properties simultaneously**
- Each landlord only sees tenants in their own properties (filtered by `property.owner_id`)

## Recent Changes (Nov 24, 2025)

### ✅ Multi-Property Tenancy Enabled

**Removed** the `cleanupExistingTenantAssignments()` logic that was preventing tenants from being active in multiple properties.

**Before:**

- When Landlord B attached a tenant, the system would deactivate the tenant's assignment to Landlord A's property
- Tenant would disappear from Landlord A's property detail page
- Only one active rent record allowed per tenant

**After:**

- Tenants can be active in multiple properties across different landlords simultaneously
- Each landlord's view is isolated by property ownership
- No interference between different landlords' tenant assignments
- Multiple ACTIVE rent records allowed per tenant account

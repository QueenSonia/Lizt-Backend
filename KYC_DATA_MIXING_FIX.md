# KYC Data Mixing Issue - Fix Documentation

## Problem

When viewing tenant details for "BQ Miniflat at Ibiyinka Salvador", the system shows KYC information from the "Heaven" property instead of property-specific KYC data.

### Root Cause

Sonia Akpati is a tenant in TWO properties owned by DIFFERENT landlords:

1. **Heaven** - Owner: Sonia's House (landlady-sonia akpati) - HAS KYC ✅
2. **BQ Miniflat** - Owner: Panda Homes (tunji oginni) - NO KYC ❌

The system has only ONE TenantKyc record for Sonia (for the Heaven landlord), but she needs TWO records (one per landlord).

## How the System Should Work

**Design Intent:**

- Each user can have MULTIPLE `tenant_kyc` records (one per landlord)
- Database schema supports this: `tenant_kyc` table has `user_id` + `admin_id` (landlord)
- Queries filter by: `tenantKyc.admin_id = property.owner_id`

**Current Problem:**

- Entity relationship is `@OneToOne` (only loads ONE record)
- Should be `@OneToMany` (loads multiple records, filtered by landlord)

## Solutions

### Solution 1: Create Missing KYC Record (Quick Fix - RECOMMENDED)

Create a TenantKyc record for Sonia under the BQ Miniflat landlord.

**Run this:**

```bash
psql -U your_username -d your_database_name -f scripts/create-missing-kyc.sql
```

**What it does:**

- Creates a new `tenant_kyc` record with `admin_id = e0d02707-c7f3-4151-a87d-69ea5168073e` (BQ Miniflat landlord)
- Uses Sonia's basic information from the users table
- Allows the BQ Miniflat landlord to have their own KYC data for Sonia

**Pros:**

- ✅ Quick fix - no code changes
- ✅ Works immediately
- ✅ Each landlord can have different KYC data

**Cons:**

- ❌ Manual process - needs to be done for each tenant
- ❌ Doesn't fix the underlying entity relationship issue

### Solution 2: Fix Entity Relationship (Proper Fix - APPLIED)

Change the relationship from `@OneToOne` to `@OneToMany`.

**Changes Made:**

1. **users/entities/user.entity.ts:**

```typescript
// BEFORE:
@OneToOne(() => TenantKyc, (tenant_kyc) => tenant_kyc.user)
tenant_kyc?: TenantKyc;

// AFTER:
@OneToMany(() => TenantKyc, (tenant_kyc) => tenant_kyc.user)
tenant_kycs?: TenantKyc[]; // Array to support multiple landlords
```

2. **tenant-kyc/entities/tenant-kyc.entity.ts:**

```typescript
// BEFORE:
@OneToOne(() => Users, (user) => user.tenant_kyc, {...})

// AFTER:
@ManyToOne(() => Users, (user) => user.tenant_kycs, {...})
```

**What needs updating:**

- All code that references `user.tenant_kyc` needs to change to `user.tenant_kycs`
- The query joins already filter by `admin_id`, so they'll work correctly
- Need to handle the array (will only have one element after filtering)

**Files that need updates:**

- `properties.service.ts` - Multiple references to `tenant_kyc`
- Any other services that access tenant KYC data

**Pros:**

- ✅ Fixes the root cause
- ✅ Proper data model
- ✅ Automatic - works for all tenants

**Cons:**

- ❌ Requires code changes in multiple places
- ❌ Needs testing
- ❌ May break existing code

## Recommended Approach

### Immediate Fix (Today):

1. ✅ Run `create-missing-kyc.sql` to create the missing KYC record
2. ✅ Verify BQ Miniflat now shows correct (empty) KYC data
3. ✅ Landlord can update KYC data through the UI

### Long-term Fix (Next Sprint):

1. Complete the entity relationship change (`@OneToMany`)
2. Update all code references from `tenant_kyc` to `tenant_kycs[0]`
3. Test thoroughly
4. Deploy

## Verification

After applying Solution 1:

```sql
-- Should show 2 records for Sonia
SELECT
    tk.id,
    tk.first_name || ' ' || tk.last_name as tenant,
    landlord_account.profile_name as landlord,
    p.name as property
FROM tenant_kyc tk
JOIN accounts landlord_account ON landlord_account.id = tk.admin_id
LEFT JOIN properties p ON p.owner_id = tk.admin_id
WHERE tk.user_id = '97b1a23b-06f1-4be9-8e5c-4e98e321e958';
```

Expected result:

1. Sonia Akpati - sonia's house - Heaven
2. Sonia Akpati - Panda Homes - BQ Miniflat at Ibiyinka Salvador

## Current Status

- ✅ Entity relationships updated (`@OneToMany` / `@ManyToOne`)
- ⏳ Code references need updating (properties.service.ts and others)
- ⏳ Missing KYC record needs to be created
- ⏳ Testing required

## Next Steps

1. **Immediate:** Run `create-missing-kyc.sql` to fix the current issue
2. **Code Update:** Update all references from `tenant_kyc` to handle `tenant_kycs` array
3. **Testing:** Test property details page shows correct KYC data per landlord
4. **Documentation:** Update API docs to reflect the change

## Related Files

- `scripts/create-missing-kyc.sql` - Creates missing KYC record
- `scripts/check-sonia-kyc.sql` - Diagnostic queries
- `src/users/entities/user.entity.ts` - Entity relationship updated
- `src/tenant-kyc/entities/tenant-kyc.entity.ts` - Entity relationship updated
- `src/properties/properties.service.ts` - Needs code updates

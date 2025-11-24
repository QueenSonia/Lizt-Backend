# Multi-Property Tenancy Fix

## Problem

When a tenant was attached to a second landlord's property, they would **disappear** from the first landlord's property detail page.

### Example:

1. Landlord A attaches Sonia to Property A ✅
2. Landlord B attaches Sonia to Property B ✅
3. Sonia disappears from Landlord A's Property A ❌

## Root Cause

The system had a `cleanupExistingTenantAssignments()` method that was called every time a tenant was attached to a property. This method would:

1. Find ALL active rent records for the tenant account
2. Mark them as INACTIVE
3. Deactivate all property-tenant relationships
4. Set previous properties back to VACANT status
5. Create move-out history records

### The Logic Flow:

```typescript
// When attaching tenant to new property:
await this.cleanupExistingTenantAssignments(tenantAccount.id, manager);
// ↑ This deactivated ALL existing assignments

// Then create new assignment
await manager.save(newRent);
await manager.save(newPropertyTenant);
```

### Why This Was Problematic:

The system was designed to allow multi-landlord tenancy, but the cleanup logic was enforcing a **one-property-per-tenant** constraint. This meant:

- ❌ Tenant could only be active in ONE property at a time
- ❌ Attaching to a new property would remove them from the old one
- ❌ Landlords would lose their tenants when another landlord attached the same person

## Solution

**Removed the cleanup logic** to allow true multi-property tenancy.

### Changes Made:

```typescript
// BEFORE:
await this.cleanupExistingTenantAssignments(
  tenantAccount.id,
  queryRunner.manager,
);

// AFTER:
// NOTE: Cleanup logic removed to support multi-landlord tenancy
// A tenant can now be active in multiple properties across different landlords
// Each landlord sees only their own tenant assignments via property ownership filtering
```

### File Changed:

- `lizt-backend/src/kyc-links/tenant-attachment.service.ts` (line ~142-147)

## How It Works Now

### Data Isolation

Each landlord only sees their own tenants through property ownership filtering:

```sql
-- Landlord A's query (implicit in the application)
SELECT * FROM property_tenants pt
JOIN properties p ON p.id = pt.property_id
WHERE p.owner_id = 'landlord-A-id'
AND pt.status = 'ACTIVE';
-- Result: Only sees tenants in Landlord A's properties
```

### Tenant Can Have Multiple Active Assignments:

```
User: Sonia (phone: 2347062639647)
  └─ Account: tenant-account-1 (role: TENANT)
      ├─ PropertyTenant #1: Property A (Landlord A) - ACTIVE ✅
      │   └─ Rent #1: ₦100k/month - ACTIVE ✅
      │
      └─ PropertyTenant #2: Property B (Landlord B) - ACTIVE ✅
          └─ Rent #2: ₦150k/month - ACTIVE ✅
```

## Benefits

✅ **True Multi-Landlord Support**: Tenant can rent from multiple landlords simultaneously

✅ **Data Isolation**: Each landlord only sees their own tenant data

✅ **No Interference**: Actions by Landlord B don't affect Landlord A's data

✅ **Realistic Modeling**: Reflects real-world scenarios where people rent multiple properties

## Testing

### Test Case 1: Attach Same Tenant to Two Landlords

1. Landlord A creates KYC link for Property A
2. Tenant Sonia (07062639647) fills KYC form
3. Landlord A attaches Sonia to Property A
4. ✅ Sonia appears in Landlord A's property detail page

5. Landlord B creates KYC link for Property B
6. Tenant Sonia (07062639647) fills KYC form
7. Landlord B attaches Sonia to Property B
8. ✅ Sonia appears in Landlord B's property detail page
9. ✅ Sonia STILL appears in Landlord A's property detail page

### Test Case 2: Database Verification

```sql
-- Check that both rent records are ACTIVE
SELECT * FROM rents
WHERE tenant_id = (
  SELECT id FROM accounts
  WHERE userId = (
    SELECT id FROM users WHERE phone_number = '2347062639647'
  ) AND role = 'TENANT'
);

-- Expected: 2 rows with rent_status = 'ACTIVE'
```

### Test Case 3: Landlord Isolation

1. Login as Landlord A
2. Navigate to Properties → Property A → Tenants
3. ✅ Should see Sonia
4. ❌ Should NOT see any tenants from Landlord B's properties

5. Login as Landlord B
6. Navigate to Properties → Property B → Tenants
7. ✅ Should see Sonia
8. ❌ Should NOT see any tenants from Landlord A's properties

## Important Notes

### Current Architecture Limitation

The system currently **reuses the same TENANT account** for all landlords. This means:

- One user → One TENANT account → Multiple properties

**Potential Future Enhancement:**
Create separate TENANT accounts per landlord for even stronger isolation:

- One user → Multiple TENANT accounts (one per landlord) → One property each

This would require:

1. Modifying `createOrGetTenantAccount()` to create landlord-specific accounts
2. Updating queries to filter by both account AND landlord
3. More complex account management

### Cleanup Method Still Exists

The `cleanupExistingTenantAssignments()` method still exists in the codebase but is no longer called. It's kept for:

- Historical reference
- Potential future use cases (e.g., manual tenant reassignment)
- The `fixExistingDataInconsistencies()` method that uses similar logic

## Related Files

- `lizt-backend/src/kyc-links/tenant-attachment.service.ts` - Main fix
- `lizt-backend/MULTI_LANDLORD_TENANT_ARCHITECTURE.md` - Architecture documentation
- `lizt-backend/TENANT_ATTACHMENT_FIX.md` - Phone normalization fix

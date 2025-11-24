# Tenant Assignment Restoration Guide

## Problem

The `cleanupExistingTenantAssignments()` method incorrectly deactivated tenant assignments when tenants were attached to multiple landlords' properties. This guide will help you restore those assignments.

## What Was Affected

When a tenant was attached to a second landlord's property, the system:

- ❌ Marked their previous rent records as `INACTIVE`
- ❌ Set property-tenant relationships to `INACTIVE`
- ❌ Changed property status from `OCCUPIED` to `VACANT`
- ❌ Created move-out history records with comment: "Tenant reassigned to another property via KYC system"

## Restoration Options

### Option 1: SQL Script (Recommended - Fastest)

**Best for:** Quick restoration with direct database access

1. **Connect to your database:**

   ```bash
   psql -U your_username -d your_database_name
   ```

2. **Run the preview query first:**

   ```sql
   SELECT
       ph.id as history_id,
       ph.property_id,
       ph.tenant_id,
       ph.move_out_date,
       r.id as rent_id,
       r.rent_status,
       p.name as property_name,
       u.first_name || ' ' || u.last_name as tenant_name
   FROM property_histories ph
   LEFT JOIN rents r ON r.tenant_id = ph.tenant_id AND r.property_id = ph.property_id
   LEFT JOIN properties p ON p.id = ph.property_id
   LEFT JOIN accounts a ON a.id = ph.tenant_id
   LEFT JOIN users u ON u.id = a."userId"
   WHERE ph.move_out_reason = 'other'
     AND ph.owner_comment = 'Tenant reassigned to another property via KYC system'
     AND ph.move_out_date IS NOT NULL
     AND r.lease_end_date > NOW()
   ORDER BY ph.created_at DESC;
   ```

3. **Review the results** - Make sure these are the tenants you want to restore

4. **Run the full restoration script:**
   ```bash
   psql -U your_username -d your_database_name -f scripts/restore-deactivated-tenants.sql
   ```

### Option 2: TypeScript Script

**Best for:** Programmatic restoration with logging

1. **Compile the TypeScript:**

   ```bash
   cd lizt-backend
   npm run build
   ```

2. **Run the restoration script:**

   ```bash
   npm run ts-node scripts/restore-deactivated-tenants.ts
   ```

   Or if you have ts-node installed globally:

   ```bash
   ts-node scripts/restore-deactivated-tenants.ts
   ```

### Option 3: Manual Database Queries

**Best for:** Careful, step-by-step restoration

#### Step 1: Identify Affected Records

```sql
-- Find all incorrectly deactivated assignments
SELECT
    ph.id,
    ph.property_id,
    ph.tenant_id,
    p.name as property_name,
    u.first_name || ' ' || u.last_name as tenant_name,
    ph.move_out_date
FROM property_histories ph
JOIN properties p ON p.id = ph.property_id
JOIN accounts a ON a.id = ph.tenant_id
JOIN users u ON u.id = a."userId"
WHERE ph.move_out_reason = 'other'
  AND ph.owner_comment = 'Tenant reassigned to another property via KYC system'
  AND ph.move_out_date IS NOT NULL;
```

#### Step 2: Reactivate Rent Records

```sql
-- For each tenant_id and property_id from Step 1:
UPDATE rents
SET
    rent_status = 'active',
    payment_status = 'pending',
    updated_at = NOW()
WHERE tenant_id = 'TENANT_ID_HERE'
  AND property_id = 'PROPERTY_ID_HERE'
  AND rent_status = 'inactive'
  AND lease_end_date > NOW();
```

#### Step 3: Reactivate Property-Tenant Relationships

```sql
-- For each tenant_id and property_id:
UPDATE property_tenants
SET
    status = 'active',
    updated_at = NOW()
WHERE tenant_id = 'TENANT_ID_HERE'
  AND property_id = 'PROPERTY_ID_HERE'
  AND status = 'inactive';
```

#### Step 4: Update Property Status

```sql
-- For each property_id:
UPDATE properties
SET
    property_status = 'occupied',
    updated_at = NOW()
WHERE id = 'PROPERTY_ID_HERE'
  AND property_status = 'vacant';
```

#### Step 5: Remove Incorrect History Records

```sql
-- Remove the incorrect move-out records
DELETE FROM property_histories
WHERE move_out_reason = 'other'
  AND owner_comment = 'Tenant reassigned to another property via KYC system'
  AND move_out_date IS NOT NULL;
```

## Verification

After running the restoration, verify the results:

### Check Restored Tenants

```sql
SELECT
    p.name as property_name,
    u.first_name || ' ' || u.last_name as tenant_name,
    r.rent_status,
    pt.status as tenant_status,
    p.property_status,
    r.lease_start_date,
    r.lease_end_date
FROM properties p
JOIN rents r ON r.property_id = p.id
JOIN property_tenants pt ON pt.property_id = p.id AND pt.tenant_id = r.tenant_id
JOIN accounts a ON a.id = r.tenant_id
JOIN users u ON u.id = a."userId"
WHERE r.rent_status = 'active'
  AND pt.status = 'active'
  AND p.property_status = 'occupied'
ORDER BY p.name, u.first_name;
```

### Check for Duplicate Active Assignments (Expected)

```sql
-- This should show tenants with multiple active assignments (this is correct!)
SELECT
    u.first_name || ' ' || u.last_name as tenant_name,
    u.phone_number,
    COUNT(*) as active_properties
FROM users u
JOIN accounts a ON a."userId" = u.id AND a.role = 'tenant'
JOIN rents r ON r.tenant_id = a.id AND r.rent_status = 'active'
GROUP BY u.id, u.first_name, u.last_name, u.phone_number
HAVING COUNT(*) > 1
ORDER BY active_properties DESC;
```

### Verify No Incorrect History Records Remain

```sql
SELECT COUNT(*) as remaining_incorrect_records
FROM property_histories
WHERE move_out_reason = 'other'
  AND owner_comment = 'Tenant reassigned to another property via KYC system'
  AND move_out_date IS NOT NULL;
-- Should return 0
```

## Expected Results

After restoration:

- ✅ Tenants reappear in their landlords' property detail pages
- ✅ Rent records are marked as `ACTIVE`
- ✅ Property-tenant relationships are `ACTIVE`
- ✅ Properties show status as `OCCUPIED`
- ✅ Incorrect move-out history records are removed
- ✅ Tenants can be active in multiple properties simultaneously

## Rollback

If something goes wrong during restoration:

### If using SQL script with transaction:

```sql
ROLLBACK;
```

### If already committed:

You'll need to manually revert by:

1. Finding the restored records (check `updated_at` timestamp)
2. Setting them back to `INACTIVE` / `VACANT` status
3. Recreating the history records

**Recommendation:** Always test on a backup database first!

## Prevention

The fix has already been applied to prevent this from happening again:

- ✅ Removed `cleanupExistingTenantAssignments()` call from `attachTenantToProperty()`
- ✅ System now supports multi-property tenancy
- ✅ Each landlord's data remains isolated

## Support

If you encounter issues during restoration:

1. **Check the logs** - The TypeScript script provides detailed logging
2. **Verify database constraints** - Ensure no foreign key violations
3. **Check lease dates** - Only leases that haven't expired are restored
4. **Review property ownership** - Ensure properties belong to the correct landlords

## Example Restoration Output

```
Starting restoration of deactivated tenant assignments...

Found 5 incorrect move-out records to restore

Processing tenant abc-123 in property xyz-789:
  ✅ Reactivated rent record rent-456
  ✅ Reactivated property-tenant relationship pt-789
  ✅ Updated property xyz-789 status to OCCUPIED
  ✅ Removed incorrect move-out history record hist-321

============================================================
RESTORATION COMPLETE
============================================================
✅ Restored rent records: 5
✅ Restored property-tenant relationships: 5
✅ Restored property statuses: 5
✅ Removed incorrect history records: 5
============================================================
```

## Timeline

- **Before Fix:** Tenants disappeared when attached to multiple landlords
- **Fix Applied:** Nov 24, 2025 - Removed cleanup logic
- **Restoration:** Run this script to restore affected data
- **After Restoration:** Multi-landlord tenancy works correctly

# Quick Restoration Steps

## TL;DR - Restore Deactivated Tenants

Your tenants disappeared because the old code deactivated them when attached to multiple landlords. Here's how to fix it:

## Option 1: Using npm script (Easiest)

```bash
cd lizt-backend
npm run restore:tenants
```

That's it! The script will:

- Find all incorrectly deactivated tenant assignments
- Reactivate rent records
- Reactivate property-tenant relationships
- Update property statuses back to OCCUPIED
- Remove incorrect move-out history records
- Show you a summary of what was restored

## Option 2: Using SQL (Fastest)

```bash
# Connect to your database
psql -U your_username -d your_database_name

# Run the restoration script
\i scripts/restore-deactivated-tenants.sql
```

## What Gets Fixed

**Before:**

- Tenant attached to Landlord A's property ✅
- Tenant attached to Landlord B's property ✅
- Tenant disappears from Landlord A's property ❌

**After Restoration:**

- Tenant visible in Landlord A's property ✅
- Tenant visible in Landlord B's property ✅
- Both landlords see their tenant independently ✅

## Verification

After running the restoration, check your landlord dashboards:

1. Login as Landlord A
2. Go to Properties → Select Property A → View Tenants
3. ✅ Tenant should be visible again

4. Login as Landlord B
5. Go to Properties → Select Property B → View Tenants
6. ✅ Tenant should still be visible

## Safety

- ✅ Uses database transactions (can rollback if needed)
- ✅ Only restores leases that haven't expired
- ✅ Provides detailed logging of all changes
- ✅ Preview mode available to see what will be changed

## Need Help?

See the full guide: `RESTORATION_GUIDE.md`

## Prevention

The bug has been fixed - this won't happen again:

- ✅ Removed the cleanup logic that was causing the issue
- ✅ System now properly supports multi-landlord tenancy
- ✅ Each landlord's data remains isolated

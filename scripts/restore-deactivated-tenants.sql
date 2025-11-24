-- SQL Script to Restore Deactivated Tenant Assignments
-- Run this script to undo the damage caused by cleanupExistingTenantAssignments
-- 
-- This script will:
-- 1. Reactivate rent records that were incorrectly marked INACTIVE
-- 2. Reactivate property-tenant relationships
-- 3. Update property statuses back to OCCUPIED
-- 4. Remove incorrect move-out history records

-- IMPORTANT: Review the affected records before running the updates!

BEGIN;

-- Step 1: Preview what will be restored
SELECT 
    'PREVIEW' as action,
    ph.id as history_id,
    ph.property_id,
    ph.tenant_id,
    ph.move_out_date,
    r.id as rent_id,
    r.rent_status as current_rent_status,
    r.lease_end_date,
    pt.id as property_tenant_id,
    pt.status as current_pt_status,
    p.property_status as current_property_status,
    p.name as property_name
FROM property_histories ph
LEFT JOIN rents r ON r.tenant_id = ph.tenant_id AND r.property_id = ph.property_id
LEFT JOIN property_tenants pt ON pt.tenant_id = ph.tenant_id AND pt.property_id = ph.property_id
LEFT JOIN properties p ON p.id = ph.property_id
WHERE ph.move_out_reason = 'other'
  AND ph.owner_comment = 'Tenant reassigned to another property via KYC system'
  AND ph.move_out_date IS NOT NULL
  AND r.lease_end_date > NOW() -- Only restore if lease is still valid
ORDER BY ph.created_at DESC;

-- If the preview looks correct, uncomment the following sections to execute:

-- Step 2: Reactivate rent records
UPDATE rents r
SET 
    rent_status = 'active',
    payment_status = 'pending',
    updated_at = NOW()
FROM property_histories ph
WHERE r.tenant_id = ph.tenant_id
  AND r.property_id = ph.property_id
  AND ph.move_out_reason = 'other'
  AND ph.owner_comment = 'Tenant reassigned to another property via KYC system'
  AND ph.move_out_date IS NOT NULL
  AND r.rent_status = 'inactive'
  AND r.lease_end_date > NOW(); -- Only restore if lease is still valid

-- Step 3: Reactivate property-tenant relationships
UPDATE property_tenants pt
SET 
    status = 'active',
    updated_at = NOW()
FROM property_histories ph
WHERE pt.tenant_id = ph.tenant_id
  AND pt.property_id = ph.property_id
  AND ph.move_out_reason = 'other'
  AND ph.owner_comment = 'Tenant reassigned to another property via KYC system'
  AND ph.move_out_date IS NOT NULL
  AND pt.status = 'inactive';

-- Step 4: Update property statuses back to OCCUPIED
UPDATE properties p
SET 
    property_status = 'occupied',
    updated_at = NOW()
FROM property_histories ph
WHERE p.id = ph.property_id
  AND ph.move_out_reason = 'other'
  AND ph.owner_comment = 'Tenant reassigned to another property via KYC system'
  AND ph.move_out_date IS NOT NULL
  AND p.property_status = 'vacant'
  AND EXISTS (
    SELECT 1 FROM rents r 
    WHERE r.property_id = p.id 
    AND r.rent_status = 'active'
  );

-- Step 5: Remove incorrect move-out history records
DELETE FROM property_histories
WHERE move_out_reason = 'other'
  AND owner_comment = 'Tenant reassigned to another property via KYC system'
  AND move_out_date IS NOT NULL;

-- Step 6: Verify the restoration
SELECT 
    'VERIFICATION' as action,
    COUNT(DISTINCT r.id) as active_rents_restored,
    COUNT(DISTINCT pt.id) as active_property_tenants_restored,
    COUNT(DISTINCT p.id) as occupied_properties_restored
FROM rents r
JOIN property_tenants pt ON pt.tenant_id = r.tenant_id AND pt.property_id = r.property_id
JOIN properties p ON p.id = r.property_id
WHERE r.rent_status = 'active'
  AND pt.status = 'active'
  AND p.property_status = 'occupied'
  AND r.updated_at > NOW() - INTERVAL '5 minutes'; -- Recently updated

COMMIT;

-- If something goes wrong, run: ROLLBACK;

-- Targeted restoration for Sonia Akpati
-- Property: BQ Miniflat at Ibiyinka Salvador
-- Tenant ID: ba4cc135-4403-4a31-95ae-67696ab83b1e
-- Property ID: 7b56ca7f-a71a-414c-88bb-150c1fb7e15a

BEGIN;

-- Step 1: Preview Sonia's current status
SELECT 
    'CURRENT STATUS' as info,
    r.id as rent_id,
    r.tenant_id,
    r.property_id,
    r.rent_status,
    r.payment_status,
    r.lease_start_date,
    r.lease_end_date,
    pt.status as property_tenant_status,
    p.property_status,
    p.name as property_name,
    u.first_name || ' ' || u.last_name as tenant_name
FROM rents r
JOIN property_tenants pt ON pt.tenant_id = r.tenant_id AND pt.property_id = r.property_id
JOIN properties p ON p.id = r.property_id
JOIN accounts a ON a.id = r.tenant_id
JOIN users u ON u.id = a."userId"
WHERE r.tenant_id = 'ba4cc135-4403-4a31-95ae-67696ab83b1e'
  AND r.property_id = '7b56ca7f-a71a-414c-88bb-150c1fb7e15a';

-- Step 2: Reactivate Sonia's rent record
UPDATE rents
SET 
    rent_status = 'active',
    payment_status = 'pending',
    updated_at = NOW()
WHERE tenant_id = 'ba4cc135-4403-4a31-95ae-67696ab83b1e'
  AND property_id = '7b56ca7f-a71a-414c-88bb-150c1fb7e15a'
  AND rent_status = 'inactive';

-- Step 3: Reactivate Sonia's property-tenant relationship
UPDATE property_tenants
SET 
    status = 'active',
    updated_at = NOW()
WHERE tenant_id = 'ba4cc135-4403-4a31-95ae-67696ab83b1e'
  AND property_id = '7b56ca7f-a71a-414c-88bb-150c1fb7e15a'
  AND status = 'inactive';

-- Step 4: Update property status to OCCUPIED
UPDATE properties
SET 
    property_status = 'occupied',
    updated_at = NOW()
WHERE id = '7b56ca7f-a71a-414c-88bb-150c1fb7e15a'
  AND property_status = 'vacant';

-- Step 5: Remove incorrect move-out history record for Sonia
DELETE FROM property_histories
WHERE tenant_id = 'ba4cc135-4403-4a31-95ae-67696ab83b1e'
  AND property_id = '7b56ca7f-a71a-414c-88bb-150c1fb7e15a'
  AND move_out_reason = 'other'
  AND owner_comment = 'Tenant reassigned to another property via KYC system';

-- Step 6: Verify restoration
SELECT 
    'AFTER RESTORATION' as info,
    r.id as rent_id,
    r.tenant_id,
    r.property_id,
    r.rent_status,
    r.payment_status,
    pt.status as property_tenant_status,
    p.property_status,
    p.name as property_name,
    u.first_name || ' ' || u.last_name as tenant_name
FROM rents r
JOIN property_tenants pt ON pt.tenant_id = r.tenant_id AND pt.property_id = r.property_id
JOIN properties p ON p.id = r.property_id
JOIN accounts a ON a.id = r.tenant_id
JOIN users u ON u.id = a."userId"
WHERE r.tenant_id = 'ba4cc135-4403-4a31-95ae-67696ab83b1e'
  AND r.property_id = '7b56ca7f-a71a-414c-88bb-150c1fb7e15a';

-- Step 7: Show summary
SELECT 
    'SUMMARY' as info,
    (SELECT COUNT(*) FROM rents WHERE tenant_id = 'ba4cc135-4403-4a31-95ae-67696ab83b1e' AND rent_status = 'active') as active_rents,
    (SELECT COUNT(*) FROM property_tenants WHERE tenant_id = 'ba4cc135-4403-4a31-95ae-67696ab83b1e' AND status = 'active') as active_property_tenants,
    (SELECT property_status FROM properties WHERE id = '7b56ca7f-a71a-414c-88bb-150c1fb7e15a') as property_status;

COMMIT;

-- If something goes wrong, run: ROLLBACK;

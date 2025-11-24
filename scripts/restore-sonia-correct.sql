-- Correct restoration for Sonia Akpati
-- Tenant Account ID: 3d9a9bbb-9bd9-4c42-b121-c161792c9f09
-- Property ID: 7b56ca7f-a71a-414c-88bb-150c1fb7e15a (BQ Miniflat at Ibiyinka Salvador)
-- Rent ID: bf6eb54f-86fa-4a23-974c-44d651993b13

BEGIN;

-- Step 1: Show current status
SELECT 
    'BEFORE RESTORATION' as status,
    r.id as rent_id,
    r.rent_status,
    r.payment_status,
    pt.status as property_tenant_status,
    p.property_status,
    p.name as property_name
FROM rents r
JOIN property_tenants pt ON pt.tenant_id = r.tenant_id AND pt.property_id = r.property_id
JOIN properties p ON p.id = r.property_id
WHERE r.id = 'bf6eb54f-86fa-4a23-974c-44d651993b13';

-- Step 2: Reactivate Sonia's rent record
UPDATE rents
SET 
    rent_status = 'active',
    payment_status = 'pending',
    updated_at = NOW()
WHERE id = 'bf6eb54f-86fa-4a23-974c-44d651993b13'
  AND rent_status = 'inactive';

-- Step 3: Reactivate property-tenant relationship
UPDATE property_tenants
SET 
    status = 'active',
    updated_at = NOW()
WHERE tenant_id = '3d9a9bbb-9bd9-4c42-b121-c161792c9f09'
  AND property_id = '7b56ca7f-a71a-414c-88bb-150c1fb7e15a'
  AND status = 'inactive';

-- Step 4: Update property status to OCCUPIED
UPDATE properties
SET 
    property_status = 'occupied',
    updated_at = NOW()
WHERE id = '7b56ca7f-a71a-414c-88bb-150c1fb7e15a'
  AND property_status = 'vacant';

-- Step 5: Remove the incorrect move-out history record
-- History ID: 8d89ebe7-774e-4454-9a5e-bc11f6bcff34
DELETE FROM property_histories
WHERE id = '8d89ebe7-774e-4454-9a5e-bc11f6bcff34';

-- Step 6: Show final status
SELECT 
    'AFTER RESTORATION' as status,
    r.id as rent_id,
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
WHERE r.id = 'bf6eb54f-86fa-4a23-974c-44d651993b13';

-- Step 7: Verify Sonia now has 2 active properties
SELECT 
    'SONIA ACTIVE PROPERTIES' as info,
    COUNT(*) as active_property_count,
    STRING_AGG(p.name, ', ') as properties
FROM rents r
JOIN properties p ON p.id = r.property_id
WHERE r.tenant_id = '3d9a9bbb-9bd9-4c42-b121-c161792c9f09'
  AND r.rent_status = 'active';

COMMIT;

-- If something goes wrong, run: ROLLBACK;

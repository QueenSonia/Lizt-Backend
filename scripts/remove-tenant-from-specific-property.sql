-- Remove tenant from a SPECIFIC property only (not the entire tenant)
-- Use this when the tenant is attached to multiple properties

-- Based on your data:
-- Property ID: 7b56ca7f-a71a-414c-88bb-150c1fb7e15a (BQ Miniflat at Ibiyinka Salvador)
-- Tenant Account ID: 3d9a9bbb-9bd9-4c42-b121-c161792c9f09
-- User ID: 97b1a23b-06f1-4be9-8e5c-4e98e321e958

BEGIN;

-- Delete property-tenant relationship for THIS property only
DELETE FROM property_tenants 
WHERE tenant_id = '3d9a9bbb-9bd9-4c42-b121-c161792c9f09'
AND property_id = '7b56ca7f-a71a-414c-88bb-150c1fb7e15a';

-- Delete rent records for THIS property only
DELETE FROM rents 
WHERE tenant_id = '3d9a9bbb-9bd9-4c42-b121-c161792c9f09'
AND property_id = '7b56ca7f-a71a-414c-88bb-150c1fb7e15a';

-- Delete property history for THIS property only
DELETE FROM property_histories 
WHERE tenant_id = '3d9a9bbb-9bd9-4c42-b121-c161792c9f09'
AND property_id = '7b56ca7f-a71a-414c-88bb-150c1fb7e15a';

-- Delete KYC applications for THIS property only
DELETE FROM kyc_applications 
WHERE tenant_id = '3d9a9bbb-9bd9-4c42-b121-c161792c9f09'
AND property_id = '7b56ca7f-a71a-414c-88bb-150c1fb7e15a';

-- Delete service requests for THIS property only
DELETE FROM service_requests 
WHERE tenant_id = '3d9a9bbb-9bd9-4c42-b121-c161792c9f09'
AND property_id = '7b56ca7f-a71a-414c-88bb-150c1fb7e15a';

-- Update property status to vacant
UPDATE properties 
SET property_status = 'vacant' 
WHERE id = '7b56ca7f-a71a-414c-88bb-150c1fb7e15a';

COMMIT;

-- Verify the tenant is still attached to the other property
SELECT 
    u.first_name,
    u.last_name,
    u.email,
    p.name as property_name,
    pt.status
FROM users u
JOIN accounts a ON u.id = a."userId"
JOIN property_tenants pt ON a.id = pt.tenant_id
JOIN properties p ON pt.property_id = p.id
WHERE u.id = '97b1a23b-06f1-4be9-8e5c-4e98e321e958';

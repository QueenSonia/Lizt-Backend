-- Step 1: Find the tenant by name, email, or phone
-- Adjust the WHERE clause based on what you know about the tenant

SELECT 
    u.id as user_id,
    u.first_name,
    u.last_name,
    u.email,
    u.phone_number,
    a.id as account_id,
    a.role,
    pt.property_id,
    p.name as property_name
FROM users u
LEFT JOIN accounts a ON u.id = a."userId"
LEFT JOIN property_tenants pt ON a.id = pt.tenant_id
LEFT JOIN properties p ON pt.property_id = p.id
WHERE 
    u.first_name LIKE '%Testing Again%'
    OR u.email = 's@gmail.com'
    OR u.phone_number LIKE '%8036148259%';

-- Once you have the IDs, run this to delete everything:
-- (Replace the UUIDs with actual values from the query above)

-- BEGIN;
-- 
-- -- Delete property-tenant relationships
-- DELETE FROM property_tenants WHERE tenant_id = 'TENANT_ACCOUNT_ID_HERE';
-- 
-- -- Delete rent records
-- DELETE FROM rents WHERE tenant_id = 'TENANT_ACCOUNT_ID_HERE';
-- 
-- -- Delete property history
-- DELETE FROM property_history WHERE tenant_id = 'TENANT_ACCOUNT_ID_HERE';
-- 
-- -- Delete KYC applications
-- DELETE FROM kyc_applications WHERE tenant_id = 'TENANT_ACCOUNT_ID_HERE';
-- 
-- -- Delete service requests
-- DELETE FROM service_requests WHERE tenant_id = 'TENANT_ACCOUNT_ID_HERE';
-- 
-- -- Delete notifications
-- DELETE FROM notifications WHERE user_id = 'TENANT_USER_ID_HERE';
-- 
-- -- Delete account
-- DELETE FROM accounts WHERE id = 'TENANT_ACCOUNT_ID_HERE';
-- 
-- -- Delete user
-- DELETE FROM users WHERE id = 'TENANT_USER_ID_HERE';
-- 
-- -- Update property to vacant
-- UPDATE properties SET property_status = 'vacant' WHERE id = 'PROPERTY_ID_HERE';
-- 
-- COMMIT;

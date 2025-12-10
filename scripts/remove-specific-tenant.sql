-- Script to remove a specific tenant and all associated data
-- Replace the placeholders with actual values

-- Step 1: Find the tenant by email or phone
-- SELECT * FROM users WHERE email = 's@gmail.com' OR phone_number = '+2348036148259';
-- SELECT * FROM accounts WHERE user_id = '<user_id_from_above>';

-- Step 2: Set these variables (replace with actual IDs)
-- TENANT_USER_ID: The user.id from users table
-- TENANT_ACCOUNT_ID: The account.id from accounts table  
-- PROPERTY_ID: The property.id (BQ Miniflat at Ibiyinka Salvador)

-- Example values (REPLACE THESE):
-- \set tenant_user_id '12345678-1234-1234-1234-123456789012'
-- \set tenant_account_id '12345678-1234-1234-1234-123456789012'
-- \set property_id '12345678-1234-1234-1234-123456789012'

BEGIN;

-- Step 3: Delete in correct order to respect foreign key constraints

-- Delete property-tenant relationships
DELETE FROM property_tenants 
WHERE tenant_id = :'tenant_account_id';

-- Delete rent records
DELETE FROM rents 
WHERE tenant_id = :'tenant_account_id';

-- Delete property history
DELETE FROM property_history 
WHERE tenant_id = :'tenant_account_id';

-- Delete KYC applications
DELETE FROM kyc_applications 
WHERE tenant_id = :'tenant_account_id';

-- Delete service requests created by this tenant
DELETE FROM service_requests 
WHERE tenant_id = :'tenant_account_id';

-- Delete notifications for this tenant
DELETE FROM notifications 
WHERE user_id = :'tenant_user_id';

-- Delete the account record
DELETE FROM accounts 
WHERE id = :'tenant_account_id';

-- Delete the user record
DELETE FROM users 
WHERE id = :'tenant_user_id';

-- Update property status to vacant if needed
UPDATE properties 
SET property_status = 'vacant' 
WHERE id = :'property_id' 
AND property_status = 'occupied';

COMMIT;

-- Verify deletion
SELECT 'Tenant removed successfully' as status;

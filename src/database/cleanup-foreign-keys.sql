-- Cleanup script for foreign key constraint issues
-- Run this to fix existing data before restarting the application

-- 1. Check for orphaned tenant_kyc records (records that reference non-existent users)
SELECT tk.id, tk.user_id, tk.first_name, tk.last_name 
FROM tenant_kyc tk 
LEFT JOIN users u ON tk.user_id = u.id 
WHERE u.id IS NULL;

-- 2. Delete orphaned tenant_kyc records (uncomment to execute)
-- DELETE FROM tenant_kyc 
-- WHERE user_id NOT IN (SELECT id FROM users WHERE id IS NOT NULL);

-- 3. Check for duplicate tenant_kyc records for the same user
SELECT user_id, COUNT(*) as count 
FROM tenant_kyc 
WHERE user_id IS NOT NULL 
GROUP BY user_id 
HAVING COUNT(*) > 1;

-- 4. Delete duplicate tenant_kyc records, keeping only the most recent one (uncomment to execute)
-- DELETE FROM tenant_kyc 
-- WHERE id NOT IN (
--     SELECT DISTINCT ON (user_id) id 
--     FROM tenant_kyc 
--     WHERE user_id IS NOT NULL 
--     ORDER BY user_id, created_at DESC
-- );

-- 5. Check for users without corresponding accounts
SELECT u.id, u.first_name, u.last_name, u.email 
FROM users u 
LEFT JOIN account a ON u.id = a."userId" 
WHERE a.id IS NULL;

-- 6. Update any NULL user_id values in tenant_kyc to point to valid users (if needed)
-- This should be done carefully based on your business logic
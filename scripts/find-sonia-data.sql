-- Diagnostic queries to find Sonia Akpati's data

-- 1. Find Sonia in users table
SELECT 'USERS TABLE' as source, id, first_name, last_name, email, phone_number
FROM users
WHERE first_name ILIKE '%sonia%' AND last_name ILIKE '%akpati%';

-- 2. Find Sonia's accounts
SELECT 'ACCOUNTS TABLE' as source, a.id, a."userId", a.role, a.email, u.first_name, u.last_name
FROM accounts a
JOIN users u ON u.id = a."userId"
WHERE u.first_name ILIKE '%sonia%' AND u.last_name ILIKE '%akpati%';

-- 3. Find all rent records for Sonia (any status)
SELECT 'RENTS TABLE' as source, 
    r.id as rent_id,
    r.tenant_id,
    r.property_id,
    r.rent_status,
    r.payment_status,
    r.lease_start_date,
    r.lease_end_date,
    r.created_at,
    r.updated_at
FROM rents r
JOIN accounts a ON a.id = r.tenant_id
JOIN users u ON u.id = a."userId"
WHERE u.first_name ILIKE '%sonia%' AND u.last_name ILIKE '%akpati%'
ORDER BY r.created_at DESC;

-- 4. Find all property_tenants records for Sonia (any status)
SELECT 'PROPERTY_TENANTS TABLE' as source,
    pt.id,
    pt.tenant_id,
    pt.property_id,
    pt.status,
    pt.created_at,
    pt.updated_at,
    p.name as property_name
FROM property_tenants pt
JOIN accounts a ON a.id = pt.tenant_id
JOIN users u ON u.id = a."userId"
JOIN properties p ON p.id = pt.property_id
WHERE u.first_name ILIKE '%sonia%' AND u.last_name ILIKE '%akpati%'
ORDER BY pt.created_at DESC;

-- 5. Find property history for Sonia
SELECT 'PROPERTY_HISTORIES TABLE' as source,
    ph.id,
    ph.tenant_id,
    ph.property_id,
    ph.move_in_date,
    ph.move_out_date,
    ph.move_out_reason,
    ph.owner_comment,
    p.name as property_name
FROM property_histories ph
JOIN accounts a ON a.id = ph.tenant_id
JOIN users u ON u.id = a."userId"
JOIN properties p ON p.id = ph.property_id
WHERE u.first_name ILIKE '%sonia%' AND u.last_name ILIKE '%akpati%'
ORDER BY ph.created_at DESC;

-- 6. Find the specific property "BQ Miniflat at Ibiyinka Salvador"
SELECT 'PROPERTY' as source,
    id as property_id,
    name,
    property_status,
    owner_id
FROM properties
WHERE name ILIKE '%BQ Miniflat%' OR name ILIKE '%Ibiyinka Salvador%';

-- 7. Check if there's a mismatch between the IDs
SELECT 'ID CHECK' as source,
    'Tenant ID from your data' as description,
    'ba4cc135-4403-4a31-95ae-67696ab83b1e' as expected_id,
    a.id as actual_account_id,
    u.id as user_id,
    u.first_name || ' ' || u.last_name as name
FROM users u
LEFT JOIN accounts a ON a."userId" = u.id AND a.role = 'tenant'
WHERE u.first_name ILIKE '%sonia%' AND u.last_name ILIKE '%akpati%';

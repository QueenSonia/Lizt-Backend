-- Verification queries for multi-property offers migration

-- 1. Check if initial_property_id column exists
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'kyc_applications'
AND column_name IN ('property_id', 'initial_property_id')
ORDER BY column_name;

-- 2. Check if data was copied correctly
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN initial_property_id = property_id THEN 1 END) as matching_records,
    COUNT(CASE WHEN initial_property_id != property_id THEN 1 END) as different_records
FROM kyc_applications;

-- 3. Check foreign key constraint
SELECT 
    constraint_name,
    table_name,
    constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'kyc_applications'
AND constraint_name LIKE '%initial_property%';

-- 4. Check index
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'kyc_applications'
AND indexname LIKE '%initial_property%';

-- 5. Sample data check (first 5 records)
SELECT 
    id,
    first_name,
    last_name,
    property_id,
    initial_property_id,
    property_id = initial_property_id as ids_match
FROM kyc_applications
LIMIT 5;

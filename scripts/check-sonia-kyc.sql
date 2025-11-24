-- Check Sonia's TenantKyc records

-- Find all TenantKyc records for Sonia
SELECT 
    tk.id as tenant_kyc_id,
    tk.user_id,
    tk.admin_id,
    tk.first_name,
    tk.last_name,
    tk.email,
    tk.phone_number,
    tk.employer_name,
    tk.monthly_net_income,
    tk.reference1_name,
    tk.created_at,
    landlord.first_name || ' ' || landlord.last_name as landlord_name,
    landlord_account.profile_name as landlord_profile
FROM tenant_kyc tk
JOIN users u ON u.id = tk.user_id
LEFT JOIN accounts landlord_account ON landlord_account.id = tk.admin_id
LEFT JOIN users landlord ON landlord.id = landlord_account."userId"
WHERE u.first_name ILIKE '%sonia%' AND u.last_name ILIKE '%akpati%'
ORDER BY tk.created_at DESC;

-- Check which properties each landlord owns
SELECT 
    p.id as property_id,
    p.name as property_name,
    p.owner_id,
    owner_account.profile_name,
    owner_user.first_name || ' ' || owner_user.last_name as owner_name
FROM properties p
JOIN accounts owner_account ON owner_account.id = p.owner_id
JOIN users owner_user ON owner_user.id = owner_account."userId"
WHERE p.id IN ('7b56ca7f-a71a-414c-88bb-150c1fb7e15a', '943ea8c0-a0b3-432b-83d7-83bc76fadff0')
ORDER BY p.name;

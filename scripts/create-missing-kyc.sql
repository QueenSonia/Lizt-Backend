-- Create missing TenantKyc record for Sonia under BQ Miniflat landlord
-- This allows each landlord to have their own KYC data for Sonia

BEGIN;

-- Check if record already exists
SELECT 
    'BEFORE' as status,
    COUNT(*) as kyc_count
FROM tenant_kyc
WHERE user_id = '97b1a23b-06f1-4be9-8e5c-4e98e321e958'
  AND admin_id = 'e0d02707-c7f3-4151-a87d-69ea5168073e';

-- Insert new TenantKyc record for BQ Miniflat landlord
-- Using data from the original KYC application or default values
INSERT INTO tenant_kyc (
    id,
    user_id,
    admin_id,
    first_name,
    last_name,
    email,
    phone_number,
    date_of_birth,
    gender,
    nationality,
    state_of_origin,
    marital_status,
    religion,
    current_residence,
    employment_status,
    occupation,
    job_title,
    employer_name,
    employer_address,
    employer_phone_number,
    monthly_net_income,
    reference1_name,
    reference1_address,
    reference1_relationship,
    reference1_phone_number,
    reference2_name,
    reference2_address,
    reference2_relationship,
    reference2_phone_number,
    identity_hash,
    created_at,
    updated_at
)
SELECT 
    gen_random_uuid(),
    '97b1a23b-06f1-4be9-8e5c-4e98e321e958', -- Sonia's user_id
    'e0d02707-c7f3-4151-a87d-69ea5168073e', -- BQ Miniflat landlord (Tunji Oginni)
    'Sonia',
    'Akpati',
    'soniaakpati@gmail.com',
    '2347062639647',
    '1998-6-5'::date,
    'female',
    'Nigeria',
    'Delta',
    'single',
    'christainity',
    '',
    'employed',
    'Product Manager',
    'Panda',
    '',
    '',
    '900000',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'sonia_akpati_2347062639647_19971028_bq', -- Unique identity hash
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM tenant_kyc 
    WHERE user_id = '97b1a23b-06f1-4be9-8e5c-4e98e321e958'
    AND admin_id = 'e0d02707-c7f3-4151-a87d-69ea5168073e'
);

-- Verify creation
SELECT 
    'AFTER' as status,
    tk.id,
    tk.user_id,
    tk.admin_id,
    tk.first_name || ' ' || tk.last_name as tenant_name,
    landlord_account.profile_name as landlord,
    tk.created_at
FROM tenant_kyc tk
LEFT JOIN accounts landlord_account ON landlord_account.id = tk.admin_id
WHERE tk.user_id = '97b1a23b-06f1-4be9-8e5c-4e98e321e958'
ORDER BY tk.created_at DESC;

COMMIT;

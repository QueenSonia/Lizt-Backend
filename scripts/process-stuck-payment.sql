-- Manual Payment Processing Script
-- Use this to manually mark a payment as completed if you've verified it succeeded on Paystack
-- 
-- IMPORTANT: Only use this if you've confirmed the payment succeeded on Paystack dashboard!
-- 
-- Usage:
-- 1. Replace the reference below with your payment reference
-- 2. Run this script in your database

-- Step 1: Check current payment status
SELECT 
    id,
    offer_letter_id,
    amount,
    status,
    paystack_reference,
    created_at,
    paid_at
FROM payments
WHERE paystack_reference = 'LIZT_1771582415248_023b7a0f';

-- Step 2: Update payment status to completed
-- UNCOMMENT THE LINES BELOW AFTER VERIFYING THE PAYMENT ON PAYSTACK
/*
UPDATE payments
SET 
    status = 'completed',
    payment_method = 'card',  -- or 'bank_transfer' depending on payment method
    paid_at = NOW(),
    updated_at = NOW()
WHERE paystack_reference = 'LIZT_1771582415248_023b7a0f'
AND status = 'pending';

-- Step 3: Update offer letter amounts
-- Get the offer letter ID first
WITH payment_info AS (
    SELECT 
        p.offer_letter_id,
        p.amount as payment_amount
    FROM payments p
    WHERE p.paystack_reference = 'LIZT_1771582415248_023b7a0f'
)
UPDATE offer_letters ol
SET 
    amount_paid = COALESCE(ol.amount_paid, 0) + pi.payment_amount,
    outstanding_balance = GREATEST(0, ol.total_amount - (COALESCE(ol.amount_paid, 0) + pi.payment_amount)),
    payment_status = CASE 
        WHEN ol.total_amount - (COALESCE(ol.amount_paid, 0) + pi.payment_amount) < 0.01 
        THEN 'fully_paid'
        ELSE 'partial'
    END,
    updated_at = NOW()
FROM payment_info pi
WHERE ol.id = pi.offer_letter_id;

-- Step 4: Verify the updates
SELECT 
    p.id as payment_id,
    p.status as payment_status,
    p.amount as payment_amount,
    p.paid_at,
    ol.id as offer_letter_id,
    ol.total_amount,
    ol.amount_paid,
    ol.outstanding_balance,
    ol.payment_status as offer_payment_status
FROM payments p
JOIN offer_letters ol ON p.offer_letter_id = ol.id
WHERE p.paystack_reference = 'LIZT_1771582415248_023b7a0f';
*/

-- NOTE: This SQL script only updates the database.
-- It does NOT:
-- - Generate receipt
-- - Send notifications
-- - Create history events
-- - Secure property (if fully paid)
--
-- For complete processing, use the TypeScript script instead:
-- npx ts-node scripts/manual-verify-payment.ts LIZT_1771582415248_023b7a0f

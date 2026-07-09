-- ============================================================================
-- REPAIR: reverse the 2026-06-30 phantom renewal re-charges
-- ============================================================================
-- Target DB : real prod (Neon ep-morning-cake / neondb)
-- Author    : (review before running)
-- Date      : 2026-07-09
--
-- WHAT HAPPENED
-- On 2026-06-30 the accepted-letter charge sweep (findChargeCandidates ->
-- chargeAcceptedRenewalAtExpiry) posted `letter_accepted_charge` OB_CHARGE rows
-- for renewal letters that were ALREADY settled: either already paid via the
-- normal float->accept->pay flow (which posts an OB_PAYMENT but no
-- letter_accepted_charge marker, so the id-keyed idempotency guard missed them)
-- or already billed for the same period by a `new_period` AUTO_RENEWAL charge.
-- Result: real duplicate wallet debt on three monthly tenancies.
--
-- The forward code fix is in renewal-charge.service.ts (payment_status=unpaid
-- filter in findChargeCandidates + already_paid / period_already_charged guards
-- in chargeAcceptedRenewalAtExpiry). This script repairs the data already written.
--
-- SCOPE (exactly 10 ledger rows, all landlord e0d02707-c7f3-4151-a87d-69ea5168073e)
--   Tunji  (BQ at Longonot Heights)            6 rows  ₦16,000   -18,000 -> -2,000
--   Sonia  (BQ Miniflat @ Ibiyinka Salvador)   2 rows   ₦2,000    -3,000 -> -1,000
--   Collin (Studio @ 49a Babatope Bejide)      2 rows   ₦2,000    -3,000 -> -1,000
--
-- MECHANISM
--   1. Back up affected ledger rows + tenant_balances rows.
--   2. Soft-delete the 10 phantom OB_CHARGE rows (deleted_at + audit note).
--      getLedger() uses TypeORM find(), which excludes soft-deleted rows, so
--      they vanish from BOTH the landlord Balance Breakdown (computeTenantBalance)
--      and the tenant renewal-invoice page (getInvoiceWalletHistory).
--   3. Add each phantom amount back onto the scalar tenant_balances.balance —
--      the headline "Outstanding Balance" reads this scalar, so it MUST move.
--
-- REVERSIBLE: restore rows from the *_delbak_20260709 tables, re-subtract the
-- scalar deltas. Do NOT run twice — the WHERE deleted_at IS NULL guard makes
-- step 2 idempotent, but step 3 is NOT, so the whole thing runs once in one txn.
-- ============================================================================

BEGIN;

-- 0. Fail loudly if this has already been applied (guard against double-run).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.tables
   WHERE table_schema='public' AND table_name='tenant_balance_ledger_delbak_20260709';
  IF n > 0 THEN
    RAISE EXCEPTION 'Backup table already exists — repair appears to have been run. Aborting.';
  END IF;
END $$;

-- 1. Backups ----------------------------------------------------------------
CREATE TABLE tenant_balance_ledger_delbak_20260709 AS
SELECT * FROM tenant_balance_ledger
WHERE id IN (
  'c0ca43cb-0ecf-41c8-9637-61d11be46e19', -- Sonia  May 01-30   1000
  '975dc9cd-23fb-41fb-a0d8-ce7b146a094c', -- Sonia  May31-Jun30 1000
  '0f55d257-1e8f-48a9-aac2-e28fccf5b099', -- Collin May 01-30   1000  (paid)
  '1628eec4-e528-4366-ad7b-c344588d9484', -- Collin May31-Jun30 1000  (dup of new_period)
  '67bacc07-2f83-4b35-adc3-c151c65409a4', -- Tunji  Feb 01-28   5000
  'ac93cdf0-181c-47d9-8326-2642b1f28882', -- Tunji  Mar 01-31   4000
  'cbc724b0-199b-4217-a00b-d58d2b54c757', -- Tunji  Apr 01-30   4000
  '3aa717c5-8a1d-4a9b-93de-968f37d34eef', -- Tunji  May 01-30   1000
  '57410cf9-af5c-4130-83aa-d5eda66d0332', -- Tunji  May 01-31   1000
  '6d0edb64-46d8-4ffa-8570-ba6c2656e86a'  -- Tunji  May31-Jun30 1000
);

CREATE TABLE tenant_balances_delbak_20260709 AS
SELECT * FROM tenant_balances
WHERE landlord_id = 'e0d02707-c7f3-4151-a87d-69ea5168073e'
  AND tenant_id IN (
    '00538fe2-2740-4ce9-9938-4844681703ea', -- Tunji
    '0085a775-5973-465a-b9e4-5b7c41a88f94', -- Sonia
    '0647f5f9-5897-4ab8-8f71-ea7a5d3c71b5'  -- Collin
  );

-- Sanity: expect exactly 10 backed-up ledger rows summing to 20000.
DO $$
DECLARE n int; s numeric;
BEGIN
  SELECT count(*), COALESCE(SUM(-balance_change),0)
    INTO n, s FROM tenant_balance_ledger_delbak_20260709;
  IF n <> 10 OR s <> 20000 THEN
    RAISE EXCEPTION 'Backup sanity failed: % rows, sum %, expected 10 / 20000', n, s;
  END IF;
END $$;

-- 2. Soft-delete the phantom charges (append audit reason in metadata) -------
UPDATE tenant_balance_ledger
SET deleted_at = now(),
    metadata = COALESCE(metadata,'{}'::jsonb)
             || jsonb_build_object(
                  'reversed', true,
                  'reversal_reason', 'phantom_recharge_20260630',
                  'reversed_at', now()::text)
WHERE deleted_at IS NULL
  AND id IN (
    'c0ca43cb-0ecf-41c8-9637-61d11be46e19','975dc9cd-23fb-41fb-a0d8-ce7b146a094c',
    '0f55d257-1e8f-48a9-aac2-e28fccf5b099','1628eec4-e528-4366-ad7b-c344588d9484',
    '67bacc07-2f83-4b35-adc3-c151c65409a4','ac93cdf0-181c-47d9-8326-2642b1f28882',
    'cbc724b0-199b-4217-a00b-d58d2b54c757','3aa717c5-8a1d-4a9b-93de-968f37d34eef',
    '57410cf9-af5c-4130-83aa-d5eda66d0332','6d0edb64-46d8-4ffa-8570-ba6c2656e86a'
  );
-- Expect: UPDATE 10

-- 3. Add the phantom amounts back onto the scalar wallet balance -------------
UPDATE tenant_balances SET balance = balance + 16000, updated_at = now()
 WHERE landlord_id='e0d02707-c7f3-4151-a87d-69ea5168073e'
   AND tenant_id='00538fe2-2740-4ce9-9938-4844681703ea'; -- Tunji  -18000 -> -2000

UPDATE tenant_balances SET balance = balance + 2000, updated_at = now()
 WHERE landlord_id='e0d02707-c7f3-4151-a87d-69ea5168073e'
   AND tenant_id='0085a775-5973-465a-b9e4-5b7c41a88f94'; -- Sonia  -3000 -> -1000

UPDATE tenant_balances SET balance = balance + 2000, updated_at = now()
 WHERE landlord_id='e0d02707-c7f3-4151-a87d-69ea5168073e'
   AND tenant_id='0647f5f9-5897-4ab8-8f71-ea7a5d3c71b5'; -- Collin -3000 -> -1000

-- 4. Verify BEFORE COMMIT ---------------------------------------------------
--   Expect: Tunji -2000, Sonia -1000, Collin -1000.
SELECT tb.tenant_id, tb.balance AS new_scalar_balance
FROM tenant_balances tb
WHERE tb.landlord_id='e0d02707-c7f3-4151-a87d-69ea5168073e'
  AND tb.tenant_id IN (
    '00538fe2-2740-4ce9-9938-4844681703ea',
    '0085a775-5973-465a-b9e4-5b7c41a88f94',
    '0647f5f9-5897-4ab8-8f71-ea7a5d3c71b5');

-- Reconciliation: scalar must equal SUM of surviving (non-deleted) ledger legs
-- per pair. Any row here means a mismatch — ROLLBACK and investigate.
SELECT tb.tenant_id, tb.balance AS scalar,
       COALESCE(SUM(l.balance_change),0) AS ledger_sum
FROM tenant_balances tb
LEFT JOIN tenant_balance_ledger l
  ON l.tenant_id=tb.tenant_id AND l.landlord_id=tb.landlord_id AND l.deleted_at IS NULL
WHERE tb.landlord_id='e0d02707-c7f3-4151-a87d-69ea5168073e'
  AND tb.tenant_id IN (
    '00538fe2-2740-4ce9-9938-4844681703ea',
    '0085a775-5973-465a-b9e4-5b7c41a88f94',
    '0647f5f9-5897-4ab8-8f71-ea7a5d3c71b5')
GROUP BY tb.tenant_id, tb.balance
HAVING tb.balance <> COALESCE(SUM(l.balance_change),0);
-- Expect: 0 rows.

-- If both checks look right:
--   COMMIT;
-- else:
--   ROLLBACK;

COMMIT; -- APPLIED 2026-07-09 after dry-run verification (balances -2000/-1000/-1000, reconciliation 0 rows).

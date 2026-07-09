-- ============================================================================
-- REPAIR PHASE 2: refresh renewal-invoice totals after the phantom-recharge fix
-- ============================================================================
-- Target DB : real prod (Neon ep-morning-cake / neondb)
-- Date      : 2026-07-09
--
-- Phase 1 (phantom_renewal_recharge_repair_20260709.sql) corrected the wallet
-- scalar + ledger via raw UPDATE. Because that bypassed the app's applyChange,
-- the `tenant.balance.changed` event never fired, so refreshInvoiceTotals never
-- re-ran — the unpaid renewal invoices still carried the pre-repair (inflated)
-- total_amount / outstanding_balance / wallet_balance. Symptom: Tunji's July
-- "Next Invoice" still showed ₦18,000.
--
-- This sets each unpaid invoice to exactly what refreshInvoiceTotals would write.
-- Values computed with the app's own formula (computeRenewalFold, claimed=0
-- verified — no active plans) and independently cross-checked:
--   total_amount        = max(0, periodCharge - walletBalance - ownLetterCharge - ownPeriodCharge)
--   outstanding_balance = max(0, -walletBalance)
--   wallet_balance      = walletBalance
-- Corrected wallets: Tunji -2000, Sonia -1000, Collin -1000.
--
-- REVERSIBLE via renewal_invoices_delbak2_20260709. Idempotent guard below.
-- ============================================================================

BEGIN;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.tables
   WHERE table_schema='public' AND table_name='renewal_invoices_delbak2_20260709';
  IF n > 0 THEN
    RAISE EXCEPTION 'Phase-2 backup already exists — appears already applied. Aborting.';
  END IF;
END $$;

CREATE TABLE renewal_invoices_delbak2_20260709 AS
SELECT * FROM renewal_invoices WHERE id IN (
  'd1a1e07e-c15f-44ff-b5b7-882dfd99fb38', -- Tunji  Jul   18000 -> 2000
  '709265f0-14f0-4bd9-ba11-14d704ac7ce9', -- Sonia  May    4000 -> 2000
  'fe7dd641-5f2e-43ec-8aa2-dd02aad8f7a2', -- Sonia  May(d) 4000 -> 2000
  'e0cfdbe2-f206-4017-a8f4-064aff5e416c', -- Sonia  Jul    3000 -> 1000
  '9c9203ee-ae5b-485d-8c2e-3efb5dc8e2f3', -- Collin draft  3000 -> 1000
  '3e422d6f-7d3d-4965-abe1-9958d7fcf436'  -- Collin Jun    2000 -> 1000
);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM renewal_invoices_delbak2_20260709;
  IF n <> 6 THEN RAISE EXCEPTION 'Backup sanity: expected 6 invoice rows, got %', n; END IF;
END $$;

-- Tunji — BQ at Longonot Heights
UPDATE renewal_invoices SET total_amount=2000, outstanding_balance=2000, wallet_balance=-2000, updated_at=now()
 WHERE id='d1a1e07e-c15f-44ff-b5b7-882dfd99fb38';                 -- Jul: 18000 -> 2000

-- Sonia — BQ Miniflat @ Ibiyinka Salvador
UPDATE renewal_invoices SET total_amount=2000, outstanding_balance=1000, wallet_balance=-1000, updated_at=now()
 WHERE id='709265f0-14f0-4bd9-ba11-14d704ac7ce9';                 -- May: 4000 -> 2000
UPDATE renewal_invoices SET total_amount=2000, outstanding_balance=1000, wallet_balance=-1000, updated_at=now()
 WHERE id='fe7dd641-5f2e-43ec-8aa2-dd02aad8f7a2';                 -- May (dup): 4000 -> 2000
UPDATE renewal_invoices SET total_amount=1000, outstanding_balance=1000, wallet_balance=-1000, updated_at=now()
 WHERE id='e0cfdbe2-f206-4017-a8f4-064aff5e416c';                 -- Jul: 3000 -> 1000

-- Collin — Studio Apartment @ 49a Babatope Bejide
UPDATE renewal_invoices SET total_amount=1000, outstanding_balance=1000, wallet_balance=-1000, updated_at=now()
 WHERE id='9c9203ee-ae5b-485d-8c2e-3efb5dc8e2f3';                 -- draft: 3000 -> 1000
UPDATE renewal_invoices SET total_amount=1000, outstanding_balance=1000, wallet_balance=-1000, updated_at=now()
 WHERE id='3e422d6f-7d3d-4965-abe1-9958d7fcf436';                 -- Jun: 2000 -> 1000

-- Verify (expect Tunji 2000; Sonia 2000/2000/1000; Collin 1000/1000)
SELECT substr(id::text,1,8) id8, total_amount, outstanding_balance, wallet_balance
FROM renewal_invoices
WHERE id IN (
  'd1a1e07e-c15f-44ff-b5b7-882dfd99fb38','709265f0-14f0-4bd9-ba11-14d704ac7ce9',
  'fe7dd641-5f2e-43ec-8aa2-dd02aad8f7a2','e0cfdbe2-f206-4017-a8f4-064aff5e416c',
  '9c9203ee-ae5b-485d-8c2e-3efb5dc8e2f3','3e422d6f-7d3d-4965-abe1-9958d7fcf436')
ORDER BY 1;

COMMIT; -- APPLIED 2026-07-09.

-- Rollback: erroneous auto-renewal of Emmanuel Etim's annual tenancy on
-- 2026-05-11 07:00 (Lagos). Tenant had a SENT-but-unaccepted renewal letter;
-- the cron auto-flipped it to ACCEPTED and rolled the period forward,
-- creating a new ₦6.75M rent record + ledger debits and pushing the
-- renewal invoice's total to ₦13,500,000 (double-counted because
-- total_amount = sumAll(fees) - walletBalance and the same auto-renewal
-- both set the fees and pushed the wallet to -6,750,000).
--
-- After the cron change (rent-reminder.service.ts: monthly-only auto-renewal)
-- this state cannot reoccur, but Emmanuel's row needed a one-off cleanup so
-- the tenant sees the original 6.75M figure (just the new period's fees as
-- a normal pending letter, no double-counted prior debt).
--
-- *** EXECUTED IN PRODUCTION ON 2026-05-12 ***
-- This file documents the actual statements run, in order, against
-- Neon prod (neondb). Every step ran in its own transaction with
-- in-line verification SELECTs. See chat transcript for full output.
--
-- Affected IDs:
--   Bad new rent           07a78b7d-ce7b-4fb6-950c-dcbd563ddc97 (HARD DELETE)
--   Old rent (re-activate) 4dd38827-93ea-427f-a552-adb2d29eb551
--   Renewal invoice/letter 903c57b9-afa2-4d99-8137-d1bb0818dea6
--   Tenant balances cache  643ddd0e-8d9a-4e58-b58e-9c95e17fc630
--   Bad ledger entries     4da441cb-c7b3-4cec-bb4c-89bb6c5dbcb5 (HARD DELETE — rent -6,000,000)
--                          32ea5436-d1aa-4c8d-8d48-682015636339 (HARD DELETE — service -750,000)
--   Bad property_histories 0248e23f-c5d9-419a-b431-d50321760235 (HARD DELETE — renewal_period_started)
--                          34d5fed9-c293-4331-898e-ce578c0114ce (HARD DELETE — rent_reminder_sent)
--
--   Tenant   e6f60e99-95e2-44df-adca-165978704671 (Emmanuel Etim)
--   Landlord e0d02707-c7f3-4151-a87d-69ea5168073e
--   Property c10109b8-ac00-4ba9-9eb5-03b9480fd6be
--
-- Why hard DELETE rather than INACTIVE / soft-delete:
--   - rents.deleted_at exists but the Rent entity has no @DeleteDateColumn,
--     so TypeORM doesn't auto-filter soft-deleted rows. INACTIVE rows would
--     leak into queries like renewal-letters.service.ts:127 that order by
--     created_at DESC without filtering rent_status.
--   - tenant_balance_ledger entries: keeping the bad rows in place would
--     cause the landlord/tenant outstanding-balance breakdown UIs to render
--     misleading -6,750,000 charges (the breakdown filters charges by
--     balance_change < 0 and we'd be relying on a metadata.superseded flag
--     that is semantically reserved for landlord-edited charges, not bug
--     reversals). Hard delete keeps SUM(balance_change) === tenant_balances.balance.
--   - tenant_balance_ledger has no FK references pointing to it; loose
--     related_entity_id refs from elsewhere are tolerated.

-- ─── STEP 1: Delete the bad rent ────────────────────────────────────────
-- Snapshot captured pre-delete (in chat transcript):
--   {"id":"07a78b7d-...","rent_start_date":"2026-05-11","expiry_date":"2027-05-10",
--    "rental_price":6000000,"service_charge":750000,"payment_status":"owing",
--    "rent_status":"active","payment_frequency":"Annually", ...}
DELETE FROM rents WHERE id = '07a78b7d-ce7b-4fb6-950c-dcbd563ddc97';

-- ─── STEP 2: Re-activate the old rent ──────────────────────────────────
-- payment_status intentionally NOT touched. The cron change scopes the
-- payment_status=OWING filter to the auto-renewed branch only; the floating
-- branch matches purely on expiry_date IN (today-1, today-7).
UPDATE rents
SET rent_status = 'active', updated_at = now()
WHERE id = '4dd38827-93ea-427f-a552-adb2d29eb551';

-- ─── STEP 3: Revert the renewal letter ─────────────────────────────────
-- Snapshot pre-update:
--   letter_status='accepted', auto_renewed_at='2026-05-11 07:00:00.241+00',
--   wallet_balance=-6750000, outstanding_balance=6750000, total_amount=13500000
UPDATE renewal_invoices
SET letter_status = 'sent',
    auto_renewed_at = NULL,
    wallet_balance = 0,
    outstanding_balance = 0,
    total_amount = 6750000.00,
    updated_at = now()
WHERE id = '903c57b9-afa2-4d99-8137-d1bb0818dea6';

-- ─── STEP 4: Delete the bad ledger entries ─────────────────────────────
-- Snapshots captured pre-delete (full row JSON in chat transcript).
DELETE FROM tenant_balance_ledger
WHERE id IN (
  '4da441cb-c7b3-4cec-bb4c-89bb6c5dbcb5',  -- auto_renewal -6,000,000 (rent)
  '32ea5436-d1aa-4c8d-8d48-682015636339'   -- auto_renewal   -750,000 (service)
);

-- ─── STEP 5: Reset the tenant_balances cache ───────────────────────────
-- Without this step, getBalance() would still return -6,750,000 and the
-- next cron tick's findOrCreateRenewalInvoice would re-inflate Emmanuel's
-- total_amount back to 13,500,000 via the formula
--   total_amount = max(0, sumAll(fees) - walletBalance) = 6.75M - (-6.75M).
UPDATE tenant_balances
SET balance = 0, updated_at = now()
WHERE id = '643ddd0e-8d9a-4e58-b58e-9c95e17fc630';

-- ─── STEP 6: Delete the bad property_histories rows ────────────────────
-- Snapshots captured pre-delete (full row JSON in chat transcript).
DELETE FROM property_histories
WHERE id IN (
  '0248e23f-c5d9-419a-b431-d50321760235',  -- renewal_period_started
  '34d5fed9-c293-4331-898e-ce578c0114ce'   -- rent_reminder_sent (₦13.5M)
);

-- ─── FINAL STATE (verified 2026-05-12) ─────────────────────────────────
-- rents:                   1 row, ACTIVE, period 2025-05-11 → 2026-05-10 (floating)
-- renewal_invoices:        letter_status=sent, total_amount=6,750,000, wallet=0
-- tenant_balance_ledger:   3 historic rows, last balance_after=0
-- tenant_balances.balance: 0 (matches ledger sum)
-- property_histories:      0 rows in the 2026-05-11+ window

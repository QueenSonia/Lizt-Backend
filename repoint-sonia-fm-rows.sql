-- Re-point Sonia's 3 misrouted attachments from her FM account to her tenant account.
-- Misrouted by the pre-fix attach-to-property endpoint (now patched).
--
-- Affected rows:
--   3 property_tenants (Sweat, BET, Chocolate City)
--   3 rents          (one per property)
--   3 tenant_balance_ledger entries (initial_balance debits)
--   1 tenant_balances row (landlord-scoped wallet) — must be merged into existing tenant-account wallet

\set fm_account     '''615cbb8c-6c34-4d72-ad69-f1fe56f100fb'''
\set tenant_account '''0085a775-5973-465a-b9e4-5b7c41a88f94'''
\set landlord       '''1b0f8fb9-ac34-43a0-a8e1-bd4a747d8179'''

BEGIN;

-- 1. Re-point property_tenants
UPDATE property_tenants
   SET tenant_id = :tenant_account, updated_at = NOW()
 WHERE tenant_id = :fm_account;

-- 2. Re-point rents
UPDATE rents
   SET tenant_id = :tenant_account, updated_at = NOW()
 WHERE tenant_id = :fm_account;

-- 3. Re-point ledger entries. Tag each moved row in metadata so the audit
-- trail records which account they came from and why.
UPDATE tenant_balance_ledger
   SET tenant_id = :tenant_account,
       updated_at = NOW(),
       metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
         'repointed_from_account', :fm_account,
         'repointed_at', NOW(),
         'repointed_reason',
         'attach-to-property bug: rows originally landed on the user''s facility_manager account because the pre-fix backend accepted any account id as :tenantId'
       )
 WHERE tenant_id = :fm_account;

-- 4. Recompute balance_after across the tenant account's entire ledger.
-- The 3 just-moved rows had balance_after computed against the FM ledger's
-- running total (-1M → -2M → -3M); after the move they're interleaved with
-- the tenant account's own ledger, so the cached running balance is stale.
-- Rebuild by chronological order.
WITH ordered AS (
  SELECT id,
         SUM(balance_change) OVER (
           PARTITION BY tenant_id, landlord_id
           ORDER BY created_at, id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS new_balance_after
  FROM tenant_balance_ledger
  WHERE tenant_id = :tenant_account
    AND landlord_id = :landlord
    AND deleted_at IS NULL
)
UPDATE tenant_balance_ledger l
   SET balance_after = ordered.new_balance_after
  FROM ordered
 WHERE l.id = ordered.id
   AND l.balance_after IS DISTINCT FROM ordered.new_balance_after;

-- 5. Merge the FM-account wallet into the tenant-account wallet, then drop
-- the now-empty FM row. UNIQUE(tenant_id, landlord_id) means we can't just
-- re-point this one — it would collide with the existing tenant-account row.
UPDATE tenant_balances
   SET balance = balance
              + COALESCE((
                  SELECT balance FROM tenant_balances
                  WHERE tenant_id = :fm_account AND landlord_id = :landlord
                ), 0),
       updated_at = NOW(),
       notes = COALESCE(notes || E'\n', '')
            || 'Merged ₦'
            || trim(to_char(
                 ABS(COALESCE((SELECT balance FROM tenant_balances
                               WHERE tenant_id = :fm_account AND landlord_id = :landlord), 0)),
                 'FM999G999G999G999G999D99'
               ))
            || ' from former FM-account wallet ' || :fm_account
            || ' on ' || NOW()::date
 WHERE tenant_id = :tenant_account AND landlord_id = :landlord;

DELETE FROM tenant_balances
 WHERE tenant_id = :fm_account AND landlord_id = :landlord;

-- 6. Verify nothing remains on the FM account.
SELECT 'property_tenants' AS table_name, COUNT(*) AS remaining_on_fm FROM property_tenants WHERE tenant_id = :fm_account
UNION ALL SELECT 'rents',                COUNT(*) FROM rents                WHERE tenant_id = :fm_account
UNION ALL SELECT 'tenant_balance_ledger',COUNT(*) FROM tenant_balance_ledger WHERE tenant_id = :fm_account
UNION ALL SELECT 'tenant_balances',      COUNT(*) FROM tenant_balances      WHERE tenant_id = :fm_account
ORDER BY table_name;

-- 7. Verify tenant-account wallet matches sum of its ledger.
SELECT
  tb.balance                                                          AS wallet_balance,
  (SELECT SUM(balance_change)
     FROM tenant_balance_ledger
    WHERE tenant_id = :tenant_account
      AND landlord_id = :landlord
      AND deleted_at IS NULL)                                         AS ledger_sum,
  tb.balance
    - (SELECT SUM(balance_change)
         FROM tenant_balance_ledger
        WHERE tenant_id = :tenant_account
          AND landlord_id = :landlord
          AND deleted_at IS NULL)                                     AS drift_should_be_zero
FROM tenant_balances tb
WHERE tb.tenant_id = :tenant_account AND tb.landlord_id = :landlord;

-- 8. Verify property/rent count for tenant: was 11 active, should now be 14.
SELECT 'active_property_tenants' AS check, COUNT(*) AS count
FROM property_tenants
WHERE tenant_id = :tenant_account AND status = 'active'
UNION ALL
SELECT 'active_rents', COUNT(*) FROM rents
WHERE tenant_id = :tenant_account AND rent_status = 'active';

COMMIT;

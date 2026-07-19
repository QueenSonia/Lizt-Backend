-- One-off repair — close the maintenance requests whose tenant "Yes, it's fixed"
-- tap crashed before it could be applied.
--
-- Why: findResolutionRequest looked the request up by `{ id: requestId }` while
-- the WhatsApp button payload carries the human request_id ("#SR…"), so every
-- tap threw `invalid input syntax for type uuid` and mutated nothing. Fixed in
-- 9606ac5. These rows are still stranded in RESOLVED.
--
-- This writes the three things updateStatus() would have persisted:
--   1. maintenance_requests.status        → closed (+ the WhatsApp note)
--   2. maintenance_request_status_history → resolved→closed, actor = the tenant
--   3. maintenance_resolution_attempts    → latest attempt outcome = confirmed
--
-- It deliberately sends NOTHING. Landlord + FMs will not be told these closed,
-- and the tenants get no reply — that is the trade for not replaying the flow.
--
-- Every statement is guarded on `status = 'resolved'`, so any request already
-- auto-closed or reopened since is left untouched. Run inside a transaction and
-- eyeball the preview before COMMIT.
--
-- Usage:
--   psql "$PROD_DATABASE_URL" -f scripts/close-stranded-resolution-confirmations.sql

BEGIN;

-- ---------------------------------------------------------------- preview ---
-- Confirm these are the right requests/tenants BEFORE committing. #SR288013CKG's
-- tapping number was cut off by the log truncation, so it is unverified against
-- a phone — check the tenant name and property on that row in particular.
SELECT mr.request_id,
       mr.status,
       mr.resolution_date,
       u.first_name || ' ' || u.last_name AS tenant,
       u.phone_number,
       p.name                             AS property,
       left(mr.description, 60)           AS issue
FROM maintenance_requests mr
LEFT JOIN accounts   a ON a.id = mr.tenant_id
LEFT JOIN users      u ON u.id = a."userId"
LEFT JOIN properties p ON p.id = mr.property_id
WHERE mr.request_id IN ('#SR5297520BN', '#SR767404J6A', '#SR288013CKG')
  AND mr.deleted_at IS NULL;

-- --------------------------------------------------- 1. status history -----
-- Inserted first, while status is still 'resolved', so previous_status is right.
INSERT INTO maintenance_request_status_history
  (id, maintenance_request_id, previous_status, new_status,
   changed_by_user_id, changed_by_role, change_reason, notes,
   changed_at, created_at, updated_at)
SELECT gen_random_uuid(),
       mr.id,
       'resolved',
       'closed',
       a."userId",
       'tenant',
       'Status changed from resolved to closed',
       'Tenant confirmed issue is fully resolved via WhatsApp',
       now(), now(), now()
FROM maintenance_requests mr
JOIN accounts a ON a.id = mr.tenant_id
WHERE mr.request_id IN ('#SR5297520BN', '#SR767404J6A', '#SR288013CKG')
  AND mr.status = 'resolved'
  AND mr.deleted_at IS NULL
  AND a."userId" IS NOT NULL;

-- ------------------------------------------- 2. latest attempt outcome -----
-- Mirrors patchLatestAttemptOutcome(id, CONFIRMED): highest attempt_number only.
-- This is what reporting reads to tell a confirmed fix from an expired one.
UPDATE maintenance_resolution_attempts ra
SET outcome           = 'confirmed',
    outcome_decided_at = now(),
    updated_at        = now()
FROM (
  SELECT DISTINCT ON (ra2.maintenance_request_id) ra2.id
  FROM maintenance_resolution_attempts ra2
  JOIN maintenance_requests mr ON mr.id = ra2.maintenance_request_id
  WHERE mr.request_id IN ('#SR5297520BN', '#SR767404J6A', '#SR288013CKG')
    AND mr.status = 'resolved'
    AND mr.deleted_at IS NULL
  ORDER BY ra2.maintenance_request_id, ra2.attempt_number DESC
) latest
WHERE ra.id = latest.id;

-- --------------------------------------------------------- 3. the row ------
UPDATE maintenance_requests
SET status     = 'closed',
    notes      = 'Tenant confirmed issue is fully resolved via WhatsApp',
    updated_at = now()
WHERE request_id IN ('#SR5297520BN', '#SR767404J6A', '#SR288013CKG')
  AND status = 'resolved'
  AND deleted_at IS NULL;

-- ----------------------------------------------------------- verify --------
-- Expect: status 'closed', outcome 'confirmed', history_rows >= 1 on each.
SELECT mr.request_id,
       mr.status,
       ra.outcome,
       ra.attempt_number,
       (SELECT count(*) FROM maintenance_request_status_history h
         WHERE h.maintenance_request_id = mr.id) AS history_rows
FROM maintenance_requests mr
LEFT JOIN LATERAL (
  SELECT outcome, attempt_number
  FROM maintenance_resolution_attempts
  WHERE maintenance_request_id = mr.id
  ORDER BY attempt_number DESC
  LIMIT 1
) ra ON true
WHERE mr.request_id IN ('#SR5297520BN', '#SR767404J6A', '#SR288013CKG')
  AND mr.deleted_at IS NULL;

-- Inspect the output above, then:
--   COMMIT;   -- or   ROLLBACK;

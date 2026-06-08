-- Strip the FACILITY_MANAGER role from accounts that no longer have any
-- facility_manager team_member row.
--
-- Background: deleteTeamMember() used to remove only the team_member join row
-- and never touched accounts.roles[]. The bot's role detection reads roles[],
-- so deleted FMs (Tunji, Sonia, ...) kept getting the "you have multiple roles"
-- picker. The code is now fixed to revoke the role on delete; this script
-- back-fills the accounts that were "deleted" before the fix shipped.
--
-- Self-healing & idempotent: it targets ANY account holding facility_manager in
-- roles[] with zero remaining facility_manager team_member rows. Accounts that
-- are still FMs on some team are untouched. Re-running it is a no-op.
--
-- team_member rows are HARD-deleted (Repository.remove), so a plain
-- NOT EXISTS against team_member is correct — no deleted_at guard needed.

BEGIN;

-- 1. Preview: which accounts will be changed, and what roles they'll be left
--    with. Eyeball this before committing.
SELECT
  a.id,
  a.email,
  a.profile_name,
  a.roles                                   AS roles_before,
  array_remove(a.roles, 'facility_manager') AS roles_after
FROM accounts a
WHERE 'facility_manager' = ANY(a.roles)
  AND NOT EXISTS (
    SELECT 1 FROM team_member tm
     WHERE tm."accountId" = a.id
       AND tm."role" = 'facility_manager'
  );

-- 2. Remove the orphaned facility_manager role.
UPDATE accounts a
   SET roles = array_remove(a.roles, 'facility_manager'),
       updated_at = NOW()
 WHERE 'facility_manager' = ANY(a.roles)
   AND NOT EXISTS (
     SELECT 1 FROM team_member tm
      WHERE tm."accountId" = a.id
        AND tm."role" = 'facility_manager'
   );

-- 3. Fix any refresh token whose active_role still points at the now-revoked
--    facility_manager role. Repoint it to the account's first remaining role so
--    the next request resolves to a role the account actually holds. Tokens for
--    accounts left with no roles at all are deleted, forcing a clean re-login.
UPDATE refresh_tokens rt
   SET active_role = a.roles[1]
  FROM accounts a
 WHERE rt.account_id = a.id
   AND rt.active_role = 'facility_manager'
   AND NOT ('facility_manager' = ANY(a.roles))
   AND cardinality(a.roles) > 0;

DELETE FROM refresh_tokens rt
 USING accounts a
 WHERE rt.account_id = a.id
   AND rt.active_role = 'facility_manager'
   AND cardinality(a.roles) = 0;

-- 4. Verify: no account should still hold facility_manager without a matching
--    team_member row. Expect 0 rows.
SELECT a.id, a.email, a.roles
FROM accounts a
WHERE 'facility_manager' = ANY(a.roles)
  AND NOT EXISTS (
    SELECT 1 FROM team_member tm
     WHERE tm."accountId" = a.id
       AND tm."role" = 'facility_manager'
  );

-- 5. Verify: no refresh token left pointing at a role its account lost.
--    Expect 0 rows.
SELECT rt.id, rt.account_id, rt.active_role, a.roles
FROM refresh_tokens rt
JOIN accounts a ON a.id = rt.account_id
WHERE rt.active_role IS NOT NULL
  AND NOT (rt.active_role = ANY(a.roles));

COMMIT;

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Property-manager transition — STEP 3 of 3: TEAM CONSOLIDATION (data migration).
 *
 * Collapses the per-landlord teams into ONE team owned by the admin, so every
 * facility manager sits on the admin's team and the FM-reparent code in
 * Workstream D resolves correctly (team.creatorId = admin). Run AFTER 1917.
 *
 * `maintenance_requests.assigned_to` -> `team_member.id` (ON DELETE SET NULL),
 * so the order matters: where an FM already has a row in the admin team, we
 * REPOINT its assigned_to from the losing row to the survivor BEFORE retiring
 * the loser — otherwise the assignment would be lost. FMs with no admin-team row
 * yet are simply moved (teamId rewrite, which preserves their assigned_to).
 *
 * Idempotent: once every active FM row is on the admin team and the landlord
 * teams are retired, every step matches nothing. Ends with a hard assertion
 * that no live maintenance_request points at a missing/retired team_member.
 *
 * Parameterised via env (prod default): PM_ADMIN_PROFILE_NAME ('Property Kraft').
 *
 * down() is NOT auto-reversible (moved/retired rows + repointed assignments).
 * Restore the pre-run DB snapshot to roll back (the plan snapshots Neon first).
 */
export class PropertyManagerTeamConsolidation1919000000000
  implements MigrationInterface
{
  name = 'PropertyManagerTeamConsolidation1919000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const ADMIN_PROFILE = (
      process.env.PM_ADMIN_PROFILE_NAME ?? 'Property Kraft'
    ).trim();

    // 1. Resolve the admin.
    const adminRows = await queryRunner.query(
      `SELECT id FROM accounts
         WHERE 'admin' = ANY(roles) AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1`,
    );
    if (!adminRows?.length) {
      throw new Error(
        'PropertyManagerTeamConsolidation: no admin account found. Run 1917 first / create the admin.',
      );
    }
    const adminId: string = adminRows[0].id;

    // 2. Ensure exactly one admin team (creatorId = admin).
    let adminTeamRows = await queryRunner.query(
      `SELECT id FROM team WHERE "creatorId" = $1 AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1`,
      [adminId],
    );
    if (!adminTeamRows?.length) {
      adminTeamRows = await queryRunner.query(
        `INSERT INTO team (id, name, "creatorId")
         VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
        [`${ADMIN_PROFILE} Team`, adminId],
      );
    }
    const adminTeamId: string = adminTeamRows[0].id;

    // 3. Duplicate-collapse: for FMs that have BOTH a losing row (on another
    //    team) AND a surviving row already on the admin team, repoint their
    //    maintenance_requests.assigned_to onto the survivor.
    await queryRunner.query(
      `UPDATE maintenance_requests mr
          SET assigned_to = survivor.id
         FROM team_member losing
         JOIN team_member survivor
           ON survivor."accountId" = losing."accountId"
          AND survivor."teamId" = $1
          AND survivor.role = 'facility_manager'
          AND survivor.deleted_at IS NULL
        WHERE mr.assigned_to = losing.id
          AND losing."teamId" <> $1
          AND losing.role = 'facility_manager'
          AND losing.deleted_at IS NULL`,
      [adminTeamId],
    );

    // 4. Retire those now-redundant losing rows (soft delete).
    await queryRunner.query(
      `UPDATE team_member losing
          SET deleted_at = now()
        WHERE losing."teamId" <> $1
          AND losing.role = 'facility_manager'
          AND losing.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM team_member s
             WHERE s."accountId" = losing."accountId"
               AND s."teamId" = $1
               AND s.role = 'facility_manager'
               AND s.deleted_at IS NULL
          )`,
      [adminTeamId],
    );

    // 5. Move the remaining FM rows (no admin-team duplicate) onto the admin
    //    team. Their assigned_to keeps pointing at the same row, now re-parented.
    await queryRunner.query(
      `UPDATE team_member
          SET "teamId" = $1
        WHERE "teamId" <> $1
          AND role = 'facility_manager'
          AND deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM team_member s
             WHERE s."accountId" = team_member."accountId"
               AND s."teamId" = $1
               AND s.role = 'facility_manager'
               AND s.deleted_at IS NULL
          )`,
      [adminTeamId],
    );

    // 6. Retire the old per-landlord teams (now emptied of active FM rows).
    await queryRunner.query(
      `UPDATE team
          SET deleted_at = now()
        WHERE id <> $1
          AND deleted_at IS NULL
          AND "creatorId" IN (
            SELECT id FROM accounts WHERE 'landlord' = ANY(roles)
          )`,
      [adminTeamId],
    );

    // 7. Assert no live maintenance_request points at a missing or retired
    //    team_member — abort the whole transaction if the consolidation
    //    orphaned any assignment.
    const orphanRows = await queryRunner.query(
      `SELECT COUNT(*)::int AS n
         FROM maintenance_requests mr
        WHERE mr.assigned_to IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM team_member tm
             WHERE tm.id = mr.assigned_to AND tm.deleted_at IS NULL
          )`,
    );
    const orphans = Number(orphanRows?.[0]?.n ?? 0);
    if (orphans > 0) {
      throw new Error(
        `PropertyManagerTeamConsolidation: ${orphans} maintenance request(s) reference a retired/missing team_member after consolidation — aborting (transaction rolls back). Investigate before retrying.`,
      );
    }
  }

  public async down(): Promise<void> {
    // Not auto-reversible: rows were moved/retired and assignments repointed.
    // Roll back by restoring the pre-run database snapshot (the plan snapshots
    // Neon before the prod run).
    throw new Error(
      'PropertyManagerTeamConsolidation is not auto-reversible — restore the pre-run DB snapshot to roll back.',
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill stuck rows from the dashboard-send-bypasses-approval bug.
 *
 * Until tenancies.service.ts initiateRenewal was fixed, sending a renewal
 * letter from the dashboard (instead of clicking "approve" in the WhatsApp
 * bot) left approval_status='pending' on the row. The tenant could read and
 * OTP-accept the letter, but the /renewal-invoice/[token] pay page short-
 * circuits on approval_status==='pending' and shows "Pending Landlord
 * Approval" — blocking payment.
 *
 * Any row where the landlord clearly sent or the tenant accepted a letter
 * is, by construction, an approved row — the pending status is stale state,
 * not a meaningful decision. Flip it. Same legacy payment_status flip the
 * code-side fix does.
 */
export class BackfillApprovedOnSentRenewalLetters1785000000000
  implements MigrationInterface
{
  name = 'BackfillApprovedOnSentRenewalLetters1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "renewal_invoices"
      SET "approval_status" = 'approved'
      WHERE "approval_status" = 'pending'
        AND "letter_status" IN ('sent', 'accepted')
        AND "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      UPDATE "renewal_invoices"
      SET "payment_status" = 'unpaid'
      WHERE "payment_status" = 'pending_approval'
        AND "letter_status" IN ('sent', 'accepted')
        AND "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op: we can't safely distinguish rows that were originally pending
    // from rows that were always approved post-backfill. The forward state
    // is correct; reversing would re-introduce the bug.
  }
}

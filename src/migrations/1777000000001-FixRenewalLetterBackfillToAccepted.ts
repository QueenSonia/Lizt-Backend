import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Corrective backfill — the prior migration
 * (1777000000000-AddRenewalLetterColumns) marked existing in-wild
 * landlord invoices as `letter_status='sent'`. That broke the payment
 * page for tenants whose WhatsApp invoice link predates the new
 * accept-letter step: the new gate requires `letter_status='accepted'`
 * before payment, but those tenants never received an OTP-flow
 * letter — only an invoice link.
 *
 * Flip them to `accepted` (with `accepted_at` set from the original
 * sent timestamp) so their existing links keep working as direct
 * payment links. The `accepted_by_phone` / `acceptance_otp` columns
 * stay NULL — there genuinely was no OTP signature for these rows,
 * and the tenant page suppresses the rubber stamp when those fields
 * are empty.
 *
 * Filter targets only rows the prior migration auto-backfilled
 * (letter_body_html IS NULL — set by the new flow but absent on
 * rows created before this feature shipped).
 */
export class FixRenewalLetterBackfillToAccepted1777000000001
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "renewal_invoices"
      SET "letter_status" = 'accepted',
          "accepted_at"   = COALESCE("letter_sent_at", "updated_at", "created_at")
      WHERE "token_type"      = 'landlord'
        AND "letter_status"   = 'sent'
        AND "letter_body_html" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert: rows that we flipped have NULL acceptance_otp + NULL
    // accepted_by_phone + NULL letter_body_html — that triple is the
    // signature of "auto-backfilled, never went through real OTP flow".
    await queryRunner.query(`
      UPDATE "renewal_invoices"
      SET "letter_status" = 'sent',
          "accepted_at"   = NULL
      WHERE "token_type"          = 'landlord'
        AND "letter_status"       = 'accepted'
        AND "letter_body_html"    IS NULL
        AND "acceptance_otp"      IS NULL
        AND "accepted_by_phone"   IS NULL
    `);
  }
}

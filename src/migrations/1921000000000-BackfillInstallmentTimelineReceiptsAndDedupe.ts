import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Payment-plan installment payments already wrote a `payment_plan_installment_paid`
 * property_histories row at payment time (via PaymentPlansService.logPlanEvent),
 * but the timeline builder had no case for that event_type, so the rows never
 * rendered. The builder now renders them ("Installment N paid — ₦X (method)"),
 * which exposes two pre-existing data issues this migration cleans up:
 *
 *   A. Clickable receipts. logPlanEvent now stamps the installment's
 *      `receipt_token` into the row's `metadata` so the timeline row can
 *      deep-link to the receipt page. Rows written before that change have
 *      `metadata = NULL`. Backfill the token from the installment (joined via
 *      related_entity_id) so historical rows are clickable too. Rows whose
 *      installment is gone or never got a token are simply left non-clickable.
 *
 *   B. Duplicate manual rows. The old manual-payment path ALSO wrote a
 *      `user_added_payment` row ("Payment received") for installment payments,
 *      on top of the `payment_plan_installment_paid` row. The app no longer
 *      writes that second row, but historical ones would now double-display
 *      ("Payment received" + "Installment N paid") for the same payment.
 *      Soft-delete the redundant `user_added_payment` rows — but ONLY where a
 *      `payment_plan_installment_paid` sibling exists for the same installment,
 *      so an installment paid before logPlanEvent shipped (which has only the
 *      user_added_payment row) keeps its single record. These rows carry no
 *      receipt token of their own (receipt_token IS NULL), so removing them
 *      strands nothing in the wild; soft-delete keeps it reversible.
 *
 * Both steps are scoped + guarded so re-running is a safe no-op.
 */
export class BackfillInstallmentTimelineReceiptsAndDedupe1921000000000
  implements MigrationInterface
{
  name = 'BackfillInstallmentTimelineReceiptsAndDedupe1921000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // A. Backfill the installment receipt token into each per-installment
    //    timeline row's metadata (only where it's currently missing).
    await queryRunner.query(`
      UPDATE "property_histories" ph
      SET "metadata" = COALESCE(ph."metadata", '{}'::jsonb)
                       || jsonb_build_object('receiptToken', i."receipt_token")
      FROM "payment_plan_installments" i
      WHERE ph."event_type" = 'payment_plan_installment_paid'
        AND ph."related_entity_type" = 'payment_plan_installment'
        AND ph."related_entity_id" = i."id"
        AND i."receipt_token" IS NOT NULL
        AND (ph."metadata" IS NULL OR ph."metadata" ->> 'receiptToken' IS NULL);
    `);

    // B. Soft-delete redundant user_added_payment installment rows that already
    //    have a payment_plan_installment_paid sibling for the same installment.
    await queryRunner.query(`
      UPDATE "property_histories" u
      SET "deleted_at" = now()
      WHERE u."event_type" = 'user_added_payment'
        AND u."related_entity_type" = 'payment_plan_installment'
        AND u."deleted_at" IS NULL
        AND EXISTS (
          SELECT 1 FROM "property_histories" p
          WHERE p."event_type" = 'payment_plan_installment_paid'
            AND p."related_entity_type" = 'payment_plan_installment'
            AND p."related_entity_id" = u."related_entity_id"
            AND p."deleted_at" IS NULL
        );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the soft-deleted duplicates. Nothing else soft-deletes
    // user_added_payment installment rows, so this only un-deletes what step B
    // hid. The metadata token backfill (step A) is left in place — it is
    // additive and harmless (the same value the app now writes at payment time).
    await queryRunner.query(`
      UPDATE "property_histories"
      SET "deleted_at" = NULL
      WHERE "event_type" = 'user_added_payment'
        AND "related_entity_type" = 'payment_plan_installment'
        AND "deleted_at" IS NOT NULL;
    `);
  }
}

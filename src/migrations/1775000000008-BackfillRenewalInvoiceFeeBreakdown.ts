import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill fee_breakdown on renewal invoices created before Billing v2.
 *
 * Before this migration, renewalInvoiceToFees() fell back to hardcoded
 * recurring flags (service=true, everything else=false) when fee_breakdown
 * was empty. This caused incorrect rendering on PDFs and the tenant page
 * if a landlord had customized recurring flags.
 *
 * The fix: for each invoice with an empty fee_breakdown, look up the rent
 * record that was active at the time and build the snapshot from its actual
 * recurring flags.
 */
export class BackfillRenewalInvoiceFeeBreakdown1775000000008
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Find all renewal invoices with empty fee_breakdown.
    // Join to the rent that best matches: same property + tenant, and whose
    // date range overlaps the invoice period. If multiple rents match, pick
    // the one whose start_date is closest to the invoice start_date.
    const rows: Array<{
      invoice_id: string;
      rent_amount: string;
      service_charge: string;
      caution_deposit: string;
      legal_fee: string;
      agency_fee: string;
      other_charges: string;
      other_fees: any;
      payment_frequency: string | null;
      // rent columns
      r_rental_price: string | null;
      r_service_charge: string | null;
      r_service_charge_recurring: boolean | null;
      r_security_deposit: string | null;
      r_security_deposit_recurring: boolean | null;
      r_legal_fee: string | null;
      r_legal_fee_recurring: boolean | null;
      r_agency_fee: string | null;
      r_agency_fee_recurring: boolean | null;
      r_other_fees: any;
      r_payment_frequency: string | null;
    }> = await queryRunner.query(`
      SELECT
        ri.id             AS invoice_id,
        ri.rent_amount,
        ri.service_charge,
        ri.caution_deposit,
        ri.legal_fee,
        ri.agency_fee,
        ri.other_charges,
        ri.other_fees,
        ri.payment_frequency,
        r.rental_price             AS r_rental_price,
        r.service_charge           AS r_service_charge,
        r.service_charge_recurring AS r_service_charge_recurring,
        r.security_deposit         AS r_security_deposit,
        r.security_deposit_recurring AS r_security_deposit_recurring,
        r.legal_fee                AS r_legal_fee,
        r.legal_fee_recurring      AS r_legal_fee_recurring,
        r.agency_fee               AS r_agency_fee,
        r.agency_fee_recurring     AS r_agency_fee_recurring,
        r.other_fees               AS r_other_fees,
        r.payment_frequency        AS r_payment_frequency
      FROM renewal_invoices ri
      LEFT JOIN LATERAL (
        SELECT rent.*
        FROM rents rent
        WHERE rent.property_id = ri.property_id
          AND rent.tenant_id   = ri.tenant_id
          AND rent.deleted_at IS NULL
        ORDER BY ABS(EXTRACT(EPOCH FROM (rent.rent_start_date - ri.start_date))) ASC
        LIMIT 1
      ) r ON true
      WHERE ri.deleted_at IS NULL
        AND (ri.fee_breakdown IS NULL OR ri.fee_breakdown = '[]'::jsonb)
    `);

    if (rows.length === 0) return;

    for (const row of rows) {
      const fees: Array<{
        kind: string;
        label: string;
        amount: number;
        recurring: boolean;
        externalId?: string;
      }> = [];

      const num = (v: unknown): number => {
        if (v == null) return 0;
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };

      // Use the invoice's scalar amounts (those are what the tenant was
      // actually charged), but pull recurring flags from the rent record.
      // If no rent was found, fall back to the same defaults the code used
      // before (service=true, others=false).
      const hasRent = row.r_rental_price != null;

      const rentAmount = num(row.rent_amount);
      if (rentAmount > 0) {
        const freq =
          (row.payment_frequency || row.r_payment_frequency || '').trim();
        fees.push({
          kind: 'rent',
          label: freq ? `Rent (${freq})` : 'Rent',
          amount: rentAmount,
          recurring: true,
        });
      }

      const sc = num(row.service_charge);
      if (sc > 0) {
        fees.push({
          kind: 'service',
          label: 'Service Charge',
          amount: sc,
          recurring: hasRent ? row.r_service_charge_recurring !== false : true,
        });
      }

      const cd = num(row.caution_deposit);
      if (cd > 0) {
        fees.push({
          kind: 'caution',
          label: 'Caution Deposit',
          amount: cd,
          recurring: hasRent
            ? row.r_security_deposit_recurring === true
            : false,
        });
      }

      const lf = num(row.legal_fee);
      if (lf > 0) {
        fees.push({
          kind: 'legal',
          label: 'Legal Fee',
          amount: lf,
          recurring: hasRent ? row.r_legal_fee_recurring === true : false,
        });
      }

      const af = num(row.agency_fee);
      if (af > 0) {
        fees.push({
          kind: 'agency',
          label: 'Agency Fee',
          amount: af,
          recurring: hasRent ? row.r_agency_fee_recurring === true : false,
        });
      }

      // Legacy scalar — no recurring info possible.
      const oc = num(row.other_charges);
      if (oc > 0) {
        fees.push({
          kind: 'other',
          label: 'Other Charges',
          amount: oc,
          recurring: false,
        });
      }

      // JSONB other_fees already have their own recurring flag.
      const otherFees: any[] =
        (typeof row.other_fees === 'string'
          ? JSON.parse(row.other_fees)
          : row.other_fees) ?? [];
      for (const of_ of otherFees) {
        const amt = num(of_.amount);
        if (amt > 0) {
          fees.push({
            kind: 'other',
            label: of_.name || 'Other',
            amount: amt,
            recurring: !!of_.recurring,
            externalId: of_.externalId,
          });
        }
      }

      await queryRunner.query(
        `UPDATE renewal_invoices SET fee_breakdown = $1 WHERE id = $2`,
        [JSON.stringify(fees), row.invoice_id],
      );
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentionally no-op. Clearing fee_breakdown would reintroduce the bug.
    // The column remains; the data is simply more accurate now.
  }
}

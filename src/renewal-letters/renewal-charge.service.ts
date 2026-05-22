import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import {
  TenantBalanceLedger,
  TenantBalanceLedgerType,
} from '../tenant-balances/entities/tenant-balance-ledger.entity';
import { TenantBalancesService } from '../tenant-balances/tenant-balances.service';
import {
  RenewalInvoice,
  RenewalLetterStatus,
} from '../tenancies/entities/renewal-invoice.entity';
import { Rent } from '../rents/entities/rent.entity';
import { renewalInvoiceToFees } from '../common/billing/fees';
import { effectiveFrequency } from '../common/utils/rent-date.util';

export type ChargeSkipReason =
  | 'monthly'
  | 'expiry_in_future'
  | 'already_charged'
  | 'superseded'
  | 'not_accepted'
  | 'no_recurring_fees';

export interface ChargeResult {
  posted: number;
  skipped?: ChargeSkipReason;
}

const LETTER_CHARGE_KIND = 'letter_accepted_charge';
const LETTER_CHARGE_REVERSAL_KIND = 'letter_accepted_charge_reversal';

const startOfUtcDay = (d: Date): Date => {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
};

const isoDate = (d: Date | string): string => {
  const x = d instanceof Date ? d : new Date(d);
  return x.toISOString().split('T')[0];
};

/**
 * Charges and reversals tied to a renewal letter's acceptance.
 *
 * Scope: non-monthly tenants only. Monthly tenants are handled by the
 * existing autoRenewExpiredRent flow in RentReminderService.
 *
 * Triggers:
 *  A) verifyOtpAndAccept calls chargeAcceptedRenewalAtExpiry when the tenant
 *     accepts. If their current rent has already expired, the charge fires
 *     immediately (Emmanuel's case). Otherwise the helper no-ops and waits
 *     for the cron.
 *  B) The daily cron sweep (processAcceptedNonMonthlyLetterCharges) calls
 *     the same helper for every ACCEPTED non-monthly letter whose related
 *     rent has expired but has no charge yet.
 *  C) The supersede branch in TenanciesService calls reverseChargesForLetter
 *     when a landlord revises an already-accepted letter, so the new letter
 *     acceptance can post a fresh charge based on updated terms.
 */
@Injectable()
export class RenewalChargeService {
  private readonly logger = new Logger(RenewalChargeService.name);

  constructor(
    @InjectRepository(TenantBalanceLedger)
    private readonly ledgerRepo: Repository<TenantBalanceLedger>,
    private readonly tenantBalancesService: TenantBalancesService,
  ) {}

  /**
   * Post one OB_CHARGE per recurring fee on `letter` to the tenant's wallet,
   * keyed for idempotency on (renewal_invoice id, letter_accepted_charge).
   *
   * Caller must pass a rent loaded with the `property` relation so we can
   * resolve the landlord id.
   */
  async chargeAcceptedRenewalAtExpiry(
    letter: RenewalInvoice,
    rent: Rent,
    now: Date = new Date(),
  ): Promise<ChargeResult> {
    if (letter.superseded_by_id) return { posted: 0, skipped: 'superseded' };
    if (letter.letter_status !== RenewalLetterStatus.ACCEPTED) {
      return { posted: 0, skipped: 'not_accepted' };
    }
    if (effectiveFrequency(rent) === 'monthly') {
      return { posted: 0, skipped: 'monthly' };
    }

    const expiry = rent.expiry_date ? startOfUtcDay(new Date(rent.expiry_date)) : null;
    if (!expiry || expiry > startOfUtcDay(now)) {
      return { posted: 0, skipped: 'expiry_in_future' };
    }

    const alreadyCharged = await this.hasExistingCharge(letter.id);
    if (alreadyCharged) return { posted: 0, skipped: 'already_charged' };

    const recurringFees = renewalInvoiceToFees(letter).filter((f) => f.recurring);
    if (recurringFees.length === 0) {
      return { posted: 0, skipped: 'no_recurring_fees' };
    }

    const landlordId = rent.property?.owner_id;
    if (!landlordId) {
      this.logger.warn(
        `chargeAcceptedRenewalAtExpiry: rent ${rent.id} missing property.owner_id; skipping.`,
      );
      return { posted: 0 };
    }

    const startStr = isoDate(letter.start_date);
    const endStr = isoDate(letter.end_date);

    let posted = 0;
    for (const fee of recurringFees) {
      await this.tenantBalancesService.applyChange(
        rent.tenant_id,
        landlordId,
        -fee.amount,
        {
          type: TenantBalanceLedgerType.OB_CHARGE,
          description: `Renewal accepted — period charge: ${startStr} – ${endStr} — ${fee.label}`,
          propertyId: rent.property_id,
          relatedEntityType: 'renewal_invoice',
          relatedEntityId: letter.id,
          metadata: {
            kind: LETTER_CHARGE_KIND,
            fee_kind: fee.kind,
            ...(fee.externalId ? { externalId: fee.externalId } : {}),
            period_start: startStr,
            period_end: endStr,
          },
        },
      );
      posted += 1;
    }

    this.logger.log(
      `Posted ${posted} OB_CHARGE entries for letter ${letter.id} (tenant ${rent.tenant_id}).`,
    );
    return { posted };
  }

  /**
   * Reverse any prior letter_accepted_charge entries for `letterId`. Used
   * when a landlord supersedes an already-accepted letter — the wallet must
   * return to its pre-charge state so that accepting the new letter charges
   * the updated terms without doubling up.
   *
   * Runs inside the caller's transaction when `manager` is provided (the
   * supersede branch passes one). Each reversal entry references the
   * original via metadata.reverses_ledger_id for audit.
   */
  async reverseChargesForLetter(
    letterId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const repo = manager
      ? manager.getRepository(TenantBalanceLedger)
      : this.ledgerRepo;

    const entries = await repo.find({
      where: {
        related_entity_type: 'renewal_invoice',
        related_entity_id: letterId,
      },
    });

    const toReverse = entries.filter(
      (e) =>
        (e.metadata as Record<string, unknown> | null)?.kind ===
        LETTER_CHARGE_KIND &&
        !(e.metadata as Record<string, unknown> | null)?.reversed,
    );

    if (toReverse.length === 0) return 0;

    for (const entry of toReverse) {
      // Mark the original so a future re-supersede won't reverse it again.
      await repo.update(entry.id, {
        metadata: { ...(entry.metadata ?? {}), reversed: true },
      });

      const reversalAmount = -Number(entry.balance_change);
      await this.tenantBalancesService.applyChange(
        entry.tenant_id,
        entry.landlord_id,
        reversalAmount,
        {
          type: entry.type,
          description: `${entry.description} (reversal — letter superseded)`,
          propertyId: entry.property_id ?? undefined,
          relatedEntityType: 'renewal_invoice',
          relatedEntityId: letterId,
          metadata: {
            kind: LETTER_CHARGE_REVERSAL_KIND,
            reverses_ledger_id: entry.id,
          },
        },
        undefined,
        manager,
      );
    }

    this.logger.log(
      `Reversed ${toReverse.length} letter_accepted_charge entries for letter ${letterId}.`,
    );
    return toReverse.length;
  }

  /**
   * Sweep used by the daily cron. Returns every non-monthly ACCEPTED letter
   * whose linked active rent has expired but has no letter_accepted_charge
   * ledger entry yet. Caller iterates and invokes chargeAcceptedRenewalAtExpiry.
   */
  async findChargeCandidates(
    renewalInvoiceRepo: Repository<RenewalInvoice>,
    today: Date,
  ): Promise<Array<{ letter: RenewalInvoice; rent: Rent }>> {
    const todayStr = isoDate(startOfUtcDay(today));

    // Pull candidate letters in one query. NOT EXISTS filters out anything
    // we've already charged, so the loop below never has to skip rows.
    const result = await renewalInvoiceRepo
      .createQueryBuilder('ri')
      .innerJoin(
        Rent,
        'r',
        'r.property_id = ri.property_id AND r.tenant_id = ri.tenant_id AND r.rent_status = :active',
        { active: 'active' },
      )
      .where('ri.letter_status = :accepted', {
        accepted: RenewalLetterStatus.ACCEPTED,
      })
      .andWhere('ri.superseded_by_id IS NULL')
      .andWhere('ri.deleted_at IS NULL')
      .andWhere('DATE(r.expiry_date) <= :today', { today: todayStr })
      .andWhere("COALESCE(r.payment_frequency, '') <> 'monthly'")
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM tenant_balance_ledger l
          WHERE l.related_entity_type = 'renewal_invoice'
            AND l.related_entity_id = ri.id
            AND l.metadata->>'kind' = :kind
        )`,
        { kind: LETTER_CHARGE_KIND },
      )
      .addSelect('r.id', 'rent_id')
      .getRawAndEntities();

    if (result.entities.length === 0) return [];

    const rentIds = result.raw
      .map((row) => row.rent_id as string | undefined)
      .filter((id): id is string => !!id);

    const rentRepo = renewalInvoiceRepo.manager.getRepository(Rent);
    const rents = await rentRepo.find({
      where: { id: In(rentIds) },
      relations: ['property'],
    });
    const rentsById = new Map(rents.map((r) => [r.id, r]));

    const candidates: Array<{ letter: RenewalInvoice; rent: Rent }> = [];
    result.entities.forEach((letter, i) => {
      const rentId = result.raw[i]?.rent_id as string | undefined;
      const rent = rentId ? rentsById.get(rentId) : undefined;
      if (rent) candidates.push({ letter, rent });
    });
    return candidates;
  }

  /**
   * True when the letter has an unreversed letter_accepted_charge entry.
   * Used by markInvoiceAsPaid (Branch B) to skip its inline AUTO_RENEWAL
   * mirror — otherwise that mirror would double-charge the wallet on top of
   * what Trigger A / B already posted for this letter.
   *
   * Optionally accepts a transaction manager so the caller can read its own
   * uncommitted writes (relevant if the supersede branch ever needs to
   * re-query mid-transaction).
   */
  async letterHasAcceptedCharge(
    letterId: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    return (await this.getLetterAcceptedChargeAmount(letterId, manager)) > 0;
  }

  /**
   * Sum of unreversed letter_accepted_charge magnitudes for this letter
   * (always non-negative). This is the portion of the tenant's wallet debt
   * that was billed *via this specific invoice's* breakdown — it should NOT
   * be treated as prior arrears when computing the invoice's total_amount,
   * because it's already represented inline in the period charge.
   *
   * refreshInvoiceTotals subtracts this from walletBalance per-invoice so
   * the formula `total = period - walletBalance` doesn't double-count the
   * same period.
   */
  async getLetterAcceptedChargeAmount(
    letterId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const repo = manager
      ? manager.getRepository(TenantBalanceLedger)
      : this.ledgerRepo;
    const entries = await repo.find({
      where: {
        related_entity_type: 'renewal_invoice',
        related_entity_id: letterId,
      },
    });
    let total = 0;
    for (const e of entries) {
      if (e.metadata?.kind !== LETTER_CHARGE_KIND) continue;
      if (e.metadata?.reversed) continue;
      total += Math.abs(Number(e.balance_change));
    }
    return total;
  }

  private async hasExistingCharge(letterId: string): Promise<boolean> {
    return this.letterHasAcceptedCharge(letterId);
  }
}

export { LETTER_CHARGE_KIND, LETTER_CHARGE_REVERSAL_KIND };

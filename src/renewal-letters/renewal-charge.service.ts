import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  TenantBalanceLedger,
  TenantBalanceLedgerType,
} from '../tenant-balances/entities/tenant-balance-ledger.entity';
import { TenantBalancesService } from '../tenant-balances/tenant-balances.service';
import {
  RenewalInvoice,
  RenewalLetterStatus,
  RenewalPaymentStatus,
} from '../tenancies/entities/renewal-invoice.entity';
import { Rent } from '../rents/entities/rent.entity';
import {
  RentPaymentStatusEnum,
  RentStatusEnum,
} from '../rents/dto/create-rent.dto';
import { PropertyHistory } from '../property-history/entities/property-history.entity';
import { UtilService } from '../utils/utility-service';
import type { TenancyRenewedFromCreditParams } from '../whatsapp-bot/template-sender';
import {
  Fee,
  FeeKind,
  carryForwardRentColumns,
  renewalInvoiceToFees,
  rentToFees,
  sumAll,
  sumRecurring,
} from '../common/billing/fees';
import { advanceRentPeriod } from '../common/utils/rent-date.util';
import { computeRenewalFold } from '../common/billing/renewal-fold';
import { PropertyTenant } from '../properties/entities/property-tenants.entity';
import { TenantStatusEnum } from '../properties/dto/create-property.dto';
import {
  ScheduledMoveOut,
  ScheduledMoveOutStatus,
} from '../properties/entities/scheduled-move-out.entity';
import { PaymentPlanInstallment } from '../payment-plans/entities/payment-plan-installment.entity';
import {
  PaymentPlanScope,
  PaymentPlanStatus,
} from '../payment-plans/entities/payment-plan.entity';

export type ChargeSkipReason =
  | 'expiry_in_future'
  | 'already_charged'
  | 'already_paid'
  | 'period_already_charged'
  | 'superseded'
  | 'not_accepted'
  | 'no_fees';

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
 * Scope: all frequencies. Posts one OB_CHARGE per fee on the letter when an
 * ACCEPTED letter's linked rent has reached expiry, regardless of the rent's
 * payment frequency. Bills every fee in the letter's snapshot — recurring AND
 * one-time — because the letter IS the landlord's authoritative statement of
 * what to bill for THIS period (a one-time fee added in "Edit next period"
 * must be collected). The recurring flag governs only carry-forward into the
 * NEXT period, not what this period's letter bills. (Cron-authored next-period
 * letters only ever snapshot recurring fees via carryForwardRentColumns, so
 * sumAll == sumRecurring for them and this is a no-op there.)
 *
 * Triggers:
 *  A) verifyOtpAndAccept calls chargeAcceptedRenewalAtExpiry when the tenant
 *     accepts. If their current rent has already expired, the charge fires
 *     immediately (Emmanuel's case). Otherwise the helper no-ops and waits
 *     for the cron.
 *  B) The daily cron sweep (processAcceptedLetterCharges) calls
 *     the same helper for every ACCEPTED letter whose related rent has
 *     expired but has no charge yet.
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
    @InjectRepository(Rent)
    private readonly rentRepo: Repository<Rent>,
    @InjectRepository(RenewalInvoice)
    private readonly renewalInvoiceRepo: Repository<RenewalInvoice>,
    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepo: Repository<PropertyHistory>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepo: Repository<PropertyTenant>,
    @InjectRepository(PaymentPlanInstallment)
    private readonly installmentRepo: Repository<PaymentPlanInstallment>,
    @InjectRepository(ScheduledMoveOut)
    private readonly scheduledMoveOutRepo: Repository<ScheduledMoveOut>,
    private readonly tenantBalancesService: TenantBalancesService,
    private readonly utilService: UtilService,
  ) {}

  /**
   * Post one OB_CHARGE per fee on `letter` (recurring and one-time) to the
   * tenant's wallet, keyed for idempotency on
   * (renewal_invoice id, letter_accepted_charge).
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

    const expiry = rent.expiry_date
      ? startOfUtcDay(new Date(rent.expiry_date))
      : null;
    if (!expiry || expiry > startOfUtcDay(now)) {
      return { posted: 0, skipped: 'expiry_in_future' };
    }

    const alreadyCharged = await this.hasExistingCharge(letter.id);
    if (alreadyCharged) return { posted: 0, skipped: 'already_charged' };

    // Never OB-charge a letter the tenant has already settled. A letter paid
    // through the normal float→accept→pay flow posts an OB_PAYMENT but no
    // letter_accepted_charge marker, so the `alreadyCharged` guard above does
    // not catch it — without this check the expiry sweep re-bills every
    // previously-paid letter, manufacturing phantom debt (prod incident
    // 2026-06-30). Only genuinely UNPAID accepted letters should be charged.
    if (letter.payment_status !== RenewalPaymentStatus.UNPAID) {
      return { posted: 0, skipped: 'already_paid' };
    }

    // Bill every fee on the letter — one-time fees the landlord set in "Edit
    // next period" are part of this period's charge, not just recurring ones.
    const letterFees = renewalInvoiceToFees(letter);
    if (letterFees.length === 0) {
      return { posted: 0, skipped: 'no_fees' };
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

    // Even for an unpaid letter, skip if this exact period was already billed
    // to the wallet by the monthly auto-renewal roll-forward (a `new_period`
    // AUTO_RENEWAL charge). Otherwise the same period is charged twice — once
    // by the roll-forward and once here — because the two paths key idempotency
    // on different entity ids (rent.id vs letter.id) and never reconcile on the
    // period. Guards the unpaid half of the 2026-06-30 double-charge incident.
    const autoRenewalEntries = await this.ledgerRepo.find({
      where: {
        property_id: rent.property_id,
        type: TenantBalanceLedgerType.AUTO_RENEWAL,
      },
    });
    const periodAlreadyCharged = autoRenewalEntries.some(
      (e) =>
        Number(e.balance_change) < 0 &&
        !e.metadata?.reversed &&
        e.metadata?.period_start === startStr &&
        e.metadata?.period_end === endStr,
    );
    if (periodAlreadyCharged) {
      return { posted: 0, skipped: 'period_already_charged' };
    }

    let posted = 0;
    for (const fee of letterFees) {
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
   * Sweep used by the daily cron. Returns every ACCEPTED letter
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
      // Only letters the tenant has NOT settled. The join below matches every
      // accepted letter for the property against its single active rent with no
      // period correlation, so without this filter a paid historical letter is
      // swept up and re-charged the moment the active rent expires — the root
      // of the 2026-06-30 phantom double-charge. A paid/partial/pending letter's
      // money already flowed through OB_PAYMENT; it must never be OB-charged.
      .andWhere('ri.payment_status = :unpaid', {
        unpaid: RenewalPaymentStatus.UNPAID,
      })
      .andWhere('DATE(r.expiry_date) <= :today', { today: todayStr })
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

  /**
   * Sum of unreversed wallet debits posted for `rent`'s OWN period — the
   * AUTO_RENEWAL 'new_period' entries from the roll-forward, or the
   * INITIAL_BALANCE entry stamped at first-rent creation (always non-negative).
   *
   * Same role as getLetterAcceptedChargeAmount but for rent-linked debits:
   * when a current-period invoice exists for an OWING rent, this portion of
   * the wallet debt is already represented inline in the invoice's
   * fee_breakdown, so fold sites must add it back before treating the wallet
   * as prior arrears — otherwise the invoice totals 2× the period the
   * morning after every monthly auto-renewal.
   */
  async getRentOwnPeriodChargeAmount(
    rentId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const repo = manager
      ? manager.getRepository(TenantBalanceLedger)
      : this.ledgerRepo;
    const entries = await repo.find({
      where: {
        related_entity_type: 'rent',
        related_entity_id: rentId,
        type: In([
          TenantBalanceLedgerType.AUTO_RENEWAL,
          TenantBalanceLedgerType.INITIAL_BALANCE,
        ]),
      },
    });
    let total = 0;
    for (const e of entries) {
      const change = Number(e.balance_change);
      if (change >= 0) continue; // only debits
      if (e.metadata?.reversed) continue;
      total += Math.abs(change);
    }
    return total;
  }

  /**
   * True when the tenant's wallet credit fully covers this letter's FULL
   * period charge (every fee on the letter — recurring and one-time) — with
   * the own-letter-charge add-back so a period already OB-charged at accept
   * time still reads as covered. Mirrors RentReminderService.isNextPeriodFullyCovered.
   * Used by the acceptance flow to skip the "pay your invoice" link when
   * nothing is actually owed.
   *
   * Uses sumAll (not sumRecurring) so a one-time fee the landlord added in
   * "Edit next period" still counts toward "is this covered?": a wallet that
   * only covers the recurring slice must NOT read as covered, or the renewal
   * would settle while the one-time fee goes uncollected.
   */
  async isLetterPeriodCoveredByCredit(
    letter: RenewalInvoice,
    landlordId: string,
  ): Promise<boolean> {
    const periodCharge = sumAll(renewalInvoiceToFees(letter));
    const walletBalance = await this.tenantBalancesService.getBalance(
      letter.tenant_id,
      landlordId,
    );
    const ownLetterCharge = await this.getLetterAcceptedChargeAmount(letter.id);
    return periodCharge - (walletBalance + ownLetterCharge) <= 0;
  }

  // ---------------------------------------------------------------------------
  // Shared renew-from-credit roll-forward
  // ---------------------------------------------------------------------------

  /**
   * Roll a single rent period forward, settling it from the tenant's wallet.
   *
   * This is the shared core used by BOTH:
   *  - RentReminderService.autoRenewExpiredRent (the daily cron), once per
   *    elapsed period in its multi-period catch-up loop, and
   *  - TenanciesService.renewFromWalletCreditNow (the landlord-triggered
   *    "renew now" button on the property-detail billing summary).
   *
   * Behaviour mirrors the previous inline cron body:
   *  - atomically flips the current rent ACTIVE → INACTIVE (0-rows ⇒ another
   *    instance already handled it ⇒ skip),
   *  - creates the next-period ACTIVE rent (sourced from `letter` when given,
   *    else carrying the current rent's recurring fees forward),
   *  - debits the wallet one AUTO_RENEWAL entry per billed fee — ALL fees on
   *    the letter (recurring + one-time) when honoring one, else only the
   *    carried recurring fees,
   *  - if the wallet still covers the charge, marks the new rent PAID, settles
   *    the linked letter as paid-by-wallet-credit, and returns the params for
   *    the tenant "tenancy renewed" confirmation (the CALLER dispatches it via
   *    its own WhatsAppNotificationLogService — this service intentionally has
   *    no whatsapp dependency to avoid a module cycle),
   *  - records a renewal_period_started property-history entry.
   *
   * Dedup vs the OB charge (chargeAcceptedRenewalAtExpiry): if the
   * letter already has a letter_accepted_charge on the wallet for this period,
   * we DO NOT post fresh AUTO_RENEWAL debits — that OB charge already moved the
   * wallet, and re-debiting would double-charge. See `ownLetterCharge` below.
   *
   * Caller must pass `rent` loaded with `property` (for owner_id) and
   * `tenant.user` (for the confirmation message phone/name), and should queue
   * `renewedConfirmation` (when non-null) as 'sendTenancyRenewedFromCredit'.
   */
  async renewOneFromWalletCredit(
    rent: Rent,
    letter: RenewalInvoice | null,
    today: Date,
    source: 'cron' | 'manual',
  ): Promise<{
    outcome: 'renewed_paid' | 'renewed_owing' | 'skipped_already';
    newRent?: Rent;
    renewedConfirmation?: TenancyRenewedFromCreditParams | null;
  }> {
    const useLetter = !!letter;

    const currentExpiry = new Date(rent.expiry_date);
    currentExpiry.setUTCHours(0, 0, 0, 0);

    // When honoring a letter, take its dates verbatim (including any landlord
    // gap between old expiry and new start). Otherwise default to expiry+1 …
    // advance-by-frequency.
    let nextStart: Date;
    let nextExpiry: Date;
    if (useLetter && letter) {
      nextStart = new Date(letter.start_date);
      nextExpiry = new Date(letter.end_date);
    } else {
      nextStart = new Date(currentExpiry);
      nextStart.setDate(nextStart.getDate() + 1);
      nextExpiry = advanceRentPeriod(currentExpiry, rent);
    }

    // Atomically mark the current period inactive only if still ACTIVE. If
    // another cron instance / the button raced us, 0 rows ⇒ skip.
    const updateResult = await this.rentRepo.update(
      { id: rent.id, rent_status: RentStatusEnum.ACTIVE },
      { rent_status: RentStatusEnum.INACTIVE },
    );
    if (updateResult.affected === 0) {
      this.logger.warn(
        `Rent ${rent.id} already processed by another instance — skipping renew-from-credit (${source}).`,
      );
      return { outcome: 'skipped_already' };
    }
    rent.rent_status = RentStatusEnum.INACTIVE;

    // Fees billed for the new period. When honoring a letter, bill EVERY fee
    // it snapshots (recurring AND one-time) — the letter is the landlord's
    // authoritative statement of what to charge for this period, so a one-time
    // fee added in "Edit next period" is collected. Without a letter (the
    // carry-forward of a missed period) bill only recurring fees, since
    // one-time move-in fees must not re-bill every period.
    //
    // `letterFeesByKind` lets the new rent below source each fee's recurring
    // flag from the letter's breakdown — RenewalInvoice has no flat
    // *_recurring columns, so the breakdown is the only per-fee recurring
    // truth. Stitching a letter AMOUNT onto the OLD rent's carried flag (the
    // previous behavior) wrote one-time fees with recurring=true and re-billed
    // them on the FOLLOWING renewal.
    let chargeFees: Fee[];
    let periodCharge: number;
    let letterFeesByKind: Map<FeeKind, Fee> | null = null;
    if (useLetter && letter) {
      const letterFees = renewalInvoiceToFees(letter);
      chargeFees = letterFees;
      periodCharge = sumAll(letterFees);
      letterFeesByKind = new Map(letterFees.map((f) => [f.kind, f]));
    } else {
      const currentFees = rentToFees(rent);
      chargeFees = currentFees.filter((f) => f.recurring);
      periodCharge = sumRecurring(currentFees);
    }

    const carried = carryForwardRentColumns(rent);

    // Create the new rent up-front (tentatively OWING) so the new_period
    // ledger entries can tie to newRent.id. Letter-sourced money fields use
    // null-safe checks (not `||`) so a deliberate 0 — landlord removing a fee
    // at renewal — overwrites rather than falling back to the carried amount.
    const newRent = this.rentRepo.create({
      property_id: rent.property_id,
      tenant_id: rent.tenant_id,
      rent_start_date: nextStart,
      expiry_date: nextExpiry,
      rental_price:
        useLetter && letter ? Number(letter.rent_amount) : rent.rental_price,
      security_deposit: carried.security_deposit,
      security_deposit_recurring: carried.security_deposit_recurring,
      service_charge:
        useLetter && letter && letter.service_charge != null
          ? Number(letter.service_charge)
          : carried.service_charge,
      service_charge_recurring:
        letterFeesByKind?.get('service')?.recurring ??
        carried.service_charge_recurring,
      legal_fee:
        useLetter && letter && letter.legal_fee != null
          ? Number(letter.legal_fee)
          : carried.legal_fee,
      legal_fee_recurring:
        letterFeesByKind?.get('legal')?.recurring ??
        carried.legal_fee_recurring,
      agency_fee:
        useLetter && letter && letter.agency_fee != null
          ? Number(letter.agency_fee)
          : carried.agency_fee,
      agency_fee_recurring:
        letterFeesByKind?.get('agency')?.recurring ??
        carried.agency_fee_recurring,
      other_fees:
        useLetter && letter
          ? (letter.other_fees ?? carried.other_fees)
          : carried.other_fees,
      payment_frequency:
        useLetter && letter
          ? letter.payment_frequency || rent.payment_frequency
          : rent.payment_frequency,
      payment_status: RentPaymentStatusEnum.OWING,
      rent_status: RentStatusEnum.ACTIVE,
      amount_paid: 0,
    });
    await this.rentRepo.save(newRent);

    const landlordId = rent.property.owner_id;

    // Dedup backstop: if this letter already posted an OB_CHARGE for the
    // period (Trigger A inline accept-after-expiry, or a prior cron OB sweep),
    // that debit already moved the wallet. Posting AUTO_RENEWAL debits now
    // would double-charge — so skip them and treat the OB charge as the
    // period debit. (The dedup is keyed on whether the letter already holds a
    // charge, not on frequency, so it stays correct for every frequency.)
    const ownLetterCharge = letter
      ? await this.getLetterAcceptedChargeAmount(letter.id)
      : 0;

    if (ownLetterCharge <= 0) {
      for (const fee of chargeFees) {
        await this.tenantBalancesService.applyChange(
          rent.tenant_id,
          landlordId,
          -fee.amount,
          {
            type: TenantBalanceLedgerType.AUTO_RENEWAL,
            description: `New period charged: ${nextStart.toISOString().split('T')[0]} – ${nextExpiry.toISOString().split('T')[0]} — ${fee.label}`,
            propertyId: rent.property_id,
            relatedEntityType: 'rent',
            relatedEntityId: newRent.id,
            metadata: {
              kind: 'new_period',
              fee_kind: fee.kind,
              ...(fee.externalId ? { externalId: fee.externalId } : {}),
              period_start: nextStart.toISOString().split('T')[0],
              period_end: nextExpiry.toISOString().split('T')[0],
            },
          },
        );
      }
    } else {
      this.logger.log(
        `Rent ${rent.id}: skipping fresh AUTO_RENEWAL debits — letter ${letter?.id} already holds a ${ownLetterCharge} letter_accepted_charge for this period.`,
      );
    }

    const walletAfterCharge = await this.tenantBalancesService.getBalance(
      rent.tenant_id,
      landlordId,
    );
    const coveredByWallet = walletAfterCharge >= 0;

    let renewedConfirmation: TenancyRenewedFromCreditParams | null = null;

    if (coveredByWallet) {
      newRent.payment_status = RentPaymentStatusEnum.PAID;
      newRent.amount_paid = periodCharge;
      await this.rentRepo.save(newRent);

      // Settle the linked letter too, so the rent-PAID / invoice-UNPAID split
      // can't leave a phantom payable the tenant could pay again.
      if (letter && letter.payment_status !== RenewalPaymentStatus.PAID) {
        letter.payment_status = RenewalPaymentStatus.PAID;
        letter.amount_paid = periodCharge;
        letter.paid_at = new Date();
        letter.payment_reference = 'wallet_credit';
        await this.renewalInvoiceRepo.save(letter);
        this.logger.log(
          `Renewal invoice ${letter.id} marked PAID via wallet credit (${source} renew of rent ${rent.id}).`,
        );
      }

      // Build the confirmation params for the caller to dispatch (no whatsapp
      // dependency here — avoids a RenewalCharge ↔ WhatsappBot module cycle).
      renewedConfirmation = this.buildTenancyRenewedParams(
        rent,
        newRent,
        nextStart,
        nextExpiry,
      );
    }

    await this.propertyHistoryRepo.save(
      this.propertyHistoryRepo.create({
        property_id: newRent.property_id,
        tenant_id: newRent.tenant_id,
        event_type: 'renewal_period_started',
        event_description:
          `Renewal period started: ${nextStart.toISOString().split('T')[0]} – ${nextExpiry.toISOString().split('T')[0]}. ` +
          `Rent: ₦${Number(newRent.rental_price).toLocaleString()}. ` +
          (coveredByWallet ? 'Covered by wallet credit.' : 'Awaiting payment.'),
        related_entity_id: newRent.id,
        related_entity_type: 'rent',
        move_in_date: nextStart,
        move_out_date: nextExpiry,
        monthly_rent: Number(newRent.rental_price),
      }),
    );

    this.logger.log(
      `Renewed rent ${rent.id} → new rent ${newRent.id} ` +
        `(${nextStart.toISOString().split('T')[0]} – ${nextExpiry.toISOString().split('T')[0]}) ` +
        (coveredByWallet ? 'PAID by wallet' : 'OWING') +
        ` [${source}]`,
    );

    return {
      outcome: coveredByWallet ? 'renewed_paid' : 'renewed_owing',
      newRent,
      renewedConfirmation,
    };
  }

  /**
   * Build the params for the tenant "your tenancy has been renewed"
   * confirmation, sent whenever a period is auto-settled from wallet credit (no
   * tenant payment action). Returns null if the tenant is missing a phone or
   * first name. The CALLER queues these as 'sendTenancyRenewedFromCredit' via
   * its own WhatsAppNotificationLogService. `oldRent` carries the tenant.user
   * relation; `newRent` carries the new period's figures.
   */
  private buildTenancyRenewedParams(
    oldRent: Rent,
    newRent: Rent,
    periodStart: Date,
    periodEnd: Date,
  ): TenancyRenewedFromCreditParams | null {
    const phone = oldRent.tenant?.user?.phone_number;
    const name = this.utilService.formatPersonName(
      oldRent.tenant?.user?.first_name,
      oldRent.tenant?.user?.last_name,
    );
    if (!phone || !name) {
      this.logger.warn(
        `Skipping tenancy-renewed message for rent ${newRent.id}: missing tenant phone or name.`,
      );
      return null;
    }

    const fmtDate = (d: Date | string) =>
      new Date(d).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    const fmtAmount = (v: number | string | null | undefined) =>
      Number(v || 0).toLocaleString('en-NG');

    return {
      phone_number: phone,
      tenant_name: name,
      period_start: fmtDate(periodStart),
      period_end: fmtDate(periodEnd),
      rent_amount: fmtAmount(newRent.rental_price),
      payment_frequency: newRent.payment_frequency || 'Monthly',
      service_charge: fmtAmount(newRent.service_charge),
    };
  }

  // ---------------------------------------------------------------------------
  // Renewal-letter creation (shared: reminder cron + payment/accept catch-up)
  // ---------------------------------------------------------------------------

  /**
   * Period the next renewal invoice for this rent should cover.
   * OWING → current (unpaid) period; otherwise → next period after expiry.
   * Mirrors the branch used by findOrCreateRenewalInvoice.
   */
  getTargetPeriodRange(rent: Rent): {
    startDate: Date;
    endDate: Date;
  } {
    if (rent.payment_status === RentPaymentStatusEnum.OWING) {
      return {
        startDate: new Date(rent.rent_start_date),
        endDate: new Date(rent.expiry_date),
      };
    }
    const startDate = new Date(rent.expiry_date);
    startDate.setDate(startDate.getDate() + 1);
    const endDate = advanceRentPeriod(new Date(rent.expiry_date), rent);
    return { startDate, endDate };
  }

  /**
   * Find (and refresh) or create the renewal invoice/letter for `rent`'s
   * target period. Moved verbatim from RentReminderService so both the
   * reminder cron and the payment/accept catch-up hooks share one
   * creation path. `rent` must carry the `property` relation (owner_id).
   */
  async findOrCreateRenewalInvoice(rent: Rent): Promise<RenewalInvoice | null> {
    try {
      const propertyTenant = await this.propertyTenantRepo.findOne({
        where: {
          property_id: rent.property_id,
          tenant_id: rent.tenant_id,
          status: TenantStatusEnum.ACTIVE,
        },
      });

      if (!propertyTenant) {
        this.logger.warn(`No active PropertyTenant found for rent ${rent.id}`);
        return null;
      }

      const landlordId = rent.property.owner_id;

      // Billing v2: snapshot the Fee[] from the rent into `fee_breakdown`.
      //
      // Period-dependent rule: an OWING current-period invoice bills every
      // fee on the rent (the tenant hasn't paid the original move-in yet).
      // A next-period invoice strips one-time fees first — caution / legal /
      // agency / one-time otherFees were collected at move-in and must not
      // re-bill at every renewal. We mirror this through carryForwardRentColumns
      // so rentToFees and the legacy scalar columns below see the same
      // adjusted values.
      const isCurrentOwingPeriod =
        rent.payment_status === RentPaymentStatusEnum.OWING;
      const sourceRent = isCurrentOwingPeriod
        ? rent
        : { ...rent, ...carryForwardRentColumns(rent) };

      const fees: Fee[] = rentToFees(sourceRent);
      const periodCharge = sumAll(fees);
      const rentAmount = sourceRent.rental_price ?? sourceRent.amount_paid ?? 0;
      const serviceCharge = sourceRent.service_charge || 0;
      const legalFee = Number(sourceRent.legal_fee || 0);
      const agencyFee = Number(sourceRent.agency_fee || 0);
      const cautionDeposit = Number(sourceRent.security_deposit || 0);
      const allOtherFees = sourceRent.other_fees ?? [];

      const walletBalance = await this.tenantBalancesService.getBalance(
        rent.tenant_id,
        landlordId,
      );
      // Exclude wallet OB already owned by an active wallet-backed plan from the
      // fold — it is collected by that plan's installments, so folding it onto
      // the renewal invoice too would double-bill. Single source of truth:
      // computeRenewalFold (same as TenanciesService.refreshInvoiceTotals).
      const claimedByPlans =
        await this.tenantBalancesService.sumActiveWalletBackedPlanClaims(
          rent.tenant_id,
          landlordId,
        );
      // For an OWING rent the invoice covers the rent's OWN period — and the
      // wallet already carries that period's debit (AUTO_RENEWAL 'new_period'
      // entries from the roll-forward, or INITIAL_BALANCE for a first
      // tenancy). That debt is the same charge as the invoice's breakdown, so
      // add it back before the fold — otherwise the invoice reads 2× the
      // period the morning after every monthly auto-renewal. Mutually
      // exclusive with the letter_accepted_charge add-back below:
      // renewOneFromWalletCredit skips fresh AUTO_RENEWAL debits when the
      // letter already holds an OB charge for the period.
      const ownPeriodRentCharge = isCurrentOwingPeriod
        ? await this.getRentOwnPeriodChargeAmount(rent.id)
        : 0;
      const { totalAmount, outstandingBalance } = computeRenewalFold({
        periodCharge,
        walletBalance,
        claimedByPlans,
        ownLetterCharge: ownPeriodRentCharge,
      });
      const paymentFrequency = rent.payment_frequency || 'monthly';

      const { startDate, endDate } = this.getTargetPeriodRange(rent);

      // Refresh existing unpaid/partial landlord/draft invoice if one exists.
      // Exclude superseded rows — those are historical versions replaced
      // by a newer letter and should never be touched by the refresh cron.
      // We include token_type='draft' so the cron can promote a landlord-
      // saved draft into a sent letter when reminders begin. PARTIAL is
      // included so the partial-balance reminder fires on the same cadence
      // as full reminders; the wallet-derived field refresh below is
      // suppressed for partials because the tenant has already committed
      // to the original total via real payments.
      const existing = await this.renewalInvoiceRepo.findOne({
        where: {
          property_tenant_id: propertyTenant.id,
          // Don't resurrect an invoice for a period that has already elapsed.
          // Without this, a stale/orphaned unpaid invoice from a prior cycle
          // (e.g. a duplicate same-period row left behind by another creation
          // path) gets reminded on, pointing the tenant at the wrong period.
          // We use >= the target start (not strict equality) so a landlord
          // who deliberately set a gap before the next period — start_date
          // later than expiry+1 — is still honored rather than triggering a
          // duplicate auto-create. A DB-level unique index is NOT an option
          // here: multiple live rows per period are allowed by design
          // (tenant-token OB rows + landlord rows coexist) — see migration
          // 1776000000000-DropRenewalInvoicesTenantPeriodUniqueIndex.
          start_date: MoreThanOrEqual(startDate),
          payment_status: In([
            RenewalPaymentStatus.UNPAID,
            RenewalPaymentStatus.PARTIAL,
          ]),
          token_type: In(['landlord', 'draft']),
          superseded_by_id: IsNull(),
        },
        order: { created_at: 'DESC' },
      });

      if (existing) {
        // Fee snapshot (rent_amount, service_charge, fee_breakdown, …) AND
        // start/end dates are authoritative from the moment the landlord
        // set them — either at auto-create below, via "Renew Tenancy", or
        // via PATCH /renewal-invoice/by-id/:id ("Edit Next Period"). Don't
        // re-snapshot from the Rent entity here: that path has no way to
        // tell an intentional landlord override from stale invoice data,
        // so it would silently clobber next-period edits. (Only the
        // wallet-derived fields below should refresh on each cron tick.)
        // Suppress the wallet-derived field refresh once the tenant has
        // started paying (PARTIAL). amount_paid > 0 means real payments are
        // recorded in payment_history; rewriting total_amount from the
        // current wallet would zero out the bill mid-flow (the partial
        // payments inflated the wallet) and lose the original commitment.
        const hasPartialPayments =
          Number(existing.amount_paid ?? 0) > 0 ||
          existing.payment_status === RenewalPaymentStatus.PARTIAL;
        if (!hasPartialPayments) {
          const breakdown: Fee[] = Array.isArray(existing.fee_breakdown)
            ? existing.fee_breakdown
            : [];
          const invoicePeriodCharge = sumAll(breakdown);
          // The wallet may already carry a letter_accepted_charge posted for
          // *this same invoice's period* (accept-after-expiry flow above,
          // fired by processAcceptedLetterCharges once expiry is reached).
          // That debit is already represented in the breakdown, so counting
          // it again as wallet debt would inflate total_amount to 2× the
          // period. Add the own-letter charge back before applying the
          // formula so only *prior* arrears reduce credit.
          // Mirrors TenanciesService.refreshInvoiceTotals.
          const ownLetterCharge = await this.getLetterAcceptedChargeAmount(
            existing.id,
          );
          // Same-period rent-linked debits (AUTO_RENEWAL 'new_period' /
          // INITIAL_BALANCE) are likewise already represented in the
          // breakdown — add them back too, but only when this invoice
          // actually covers the OWING rent's own period (the existing
          // lookup is >= the target start, so it could match a later
          // letter, in which case the rent debit IS prior arrears).
          const coversRentOwnPeriod =
            isCurrentOwingPeriod &&
            new Date(existing.start_date).toISOString().split('T')[0] ===
              new Date(rent.rent_start_date).toISOString().split('T')[0];
          const ownPeriodCharge = coversRentOwnPeriod
            ? await this.getRentOwnPeriodChargeAmount(rent.id)
            : 0;
          const fold = computeRenewalFold({
            periodCharge: invoicePeriodCharge,
            walletBalance,
            claimedByPlans,
            ownLetterCharge: ownLetterCharge + ownPeriodCharge,
          });
          existing.wallet_balance = walletBalance;
          existing.outstanding_balance = fold.outstandingBalance;
          existing.total_amount = fold.totalAmount;
        }

        // Promote a landlord-saved draft to 'sent' on first reminder.
        // The cron then dispatches the renewal-letter WhatsApp template
        // (see sendRenewalReminder branching in RentReminderService). After
        // this flip the tenant URL transitions from preview-only to
        // Accept/Decline.
        if (existing.letter_status === RenewalLetterStatus.DRAFT) {
          existing.letter_status = RenewalLetterStatus.SENT;
          existing.letter_sent_at = new Date();
          existing.token_type = 'landlord';
        }

        await this.renewalInvoiceRepo.save(existing);
        return existing;
      }

      // Auto-create. fee_breakdown is the authoritative source for the
      // tenant-facing UI; legacy scalar columns are kept for back-compat
      // with the existing renewal PDF + API consumers.
      //
      // letter_status='sent' on cron auto-create: every renewal now goes
      // through the letter-then-invoice flow. letter_body_html stays NULL
      // so the tenant page renders the standard fallback (page 1 + page 2
      // boilerplate driven by the current structured fields). If the tenant
      // never accepts, the tenancy simply floats (post-expiry reminders keep
      // nudging) — we no longer auto-accept on their behalf at expiry.
      const token = uuidv4();
      const renewalInvoice = this.renewalInvoiceRepo.create({
        token,
        property_tenant_id: propertyTenant.id,
        property_id: rent.property_id,
        tenant_id: rent.tenant_id,
        start_date: startDate,
        end_date: endDate,
        rent_amount: rentAmount,
        service_charge: serviceCharge,
        legal_fee: legalFee,
        agency_fee: agencyFee,
        caution_deposit: cautionDeposit,
        other_charges: 0,
        other_fees: allOtherFees,
        fee_breakdown: fees,
        outstanding_balance: outstandingBalance,
        wallet_balance: walletBalance,
        total_amount: totalAmount,
        token_type: 'landlord',
        payment_status: RenewalPaymentStatus.UNPAID,
        payment_frequency: paymentFrequency,
        letter_status: RenewalLetterStatus.SENT,
        letter_sent_at: new Date(),
      });

      await this.renewalInvoiceRepo.save(renewalInvoice);
      this.logger.log(
        `Auto-created renewal invoice ${renewalInvoice.id} for rent ${rent.id}`,
      );
      return renewalInvoice;
    } catch (error) {
      this.logger.error(
        `Failed to find/create renewal invoice for rent ${rent.id}`,
        error,
      );
      return null;
    }
  }

  /**
   * True when an ACTIVE, TENANCY-scope payment plan exists for this renewal
   * invoice's tenancy. A tenancy plan is the agreed vehicle for the WHOLE
   * period and emits its own installment reminders (checkInstallmentReminders),
   * so the ordinary renewal/overdue reminders for the same period must be
   * suppressed — otherwise the tenant gets two sets of reminders for the same
   * money (the reported bug).
   *
   * Only scope=TENANCY suppresses. A CHARGE plan carves a single fee out of the
   * invoice (the rest of the period is still owed and legitimately reminded,
   * now at the reduced total); wallet-backed OB/ad-hoc plans settle prior
   * arrears and are already netted out of total_amount by the renewal fold.
   *
   * Keyed on the DURABLE property_tenant_id, NOT renewal_invoice_id — that
   * column is nullable and regenerated between plan creation and settlement
   * (see payment-plan.entity.ts), so it can be stale/null for a live plan.
   * Queried through installmentRepo's `plan` join to avoid injecting a
   * second repo. Fail-open: a DB error sends the reminder rather than silencing
   * a real debt, matching the wallet-claim helper's convention.
   *
   * Only suppress when the plan still FULLY COVERS the live invoice total
   * (`plan.total_amount >= total - 1`, the same 1-naira rounding tolerance
   * createPlan uses). If a landlord later revises the renewal letter into a
   * LARGER invoice, the old plan is sized to the smaller amount and a tenancy
   * plan's claim is never folded out of the new total — so without this guard
   * the tenant would be silently under-reminded for the delta. Once the plan no
   * longer covers the bill, the ordinary reminder is let through.
   */
  async isTargetPeriodCoveredByActiveTenancyPlan(
    renewalInvoice: RenewalInvoice,
  ): Promise<boolean> {
    try {
      const count = await this.installmentRepo
        .createQueryBuilder('inst')
        .leftJoin('inst.plan', 'plan')
        .where('plan.property_tenant_id = :pt', {
          pt: renewalInvoice.property_tenant_id,
        })
        .andWhere('plan.scope = :scope', { scope: PaymentPlanScope.TENANCY })
        .andWhere('plan.status = :status', {
          status: PaymentPlanStatus.ACTIVE,
        })
        .andWhere('plan.total_amount >= :minCover', {
          minCover: Number(renewalInvoice.total_amount || 0) - 1,
        })
        .getCount();
      return count > 0;
    } catch (error) {
      this.logger.error(
        `isTargetPeriodCoveredByActiveTenancyPlan failed for invoice ${renewalInvoice.id}`,
        error as Error,
      );
      return false;
    }
  }

  /**
   * True when this tenancy has an unprocessed CONFIRMED scheduled move-out —
   * the tenancy is winding down, so no renewal letter should be issued for it.
   * Mirrors the predicate behind RentReminderService.getConfirmedLapseKeys.
   */
  async hasConfirmedMoveOut(
    propertyId: string,
    tenantId: string,
  ): Promise<boolean> {
    const count = await this.scheduledMoveOutRepo.count({
      where: {
        property_id: propertyId,
        tenant_id: tenantId,
        processed: false,
        status: ScheduledMoveOutStatus.CONFIRMED,
      },
    });
    return count > 0;
  }

  /**
   * Find-or-create the NEXT-period renewal letter for a rent whose period has
   * already elapsed (a "born expired" rent left behind by a late-settled
   * letter), applying the same suppressors the reminder cron uses. Returns the
   * letter to send, or null when nothing should be sent:
   *  - the tenancy has a confirmed scheduled move-out (winding down),
   *  - no active PropertyTenant resolves (findOrCreate returns null),
   *  - the matched letter is DECLINED (the vacate path owns that tenant), or
   *  - an ACTIVE tenancy-scope plan already covers the period.
   *
   * Deliberately does NOT suppress on total_amount === 0 — matching the cron's
   * SENT-letter branch: credit may cover the money but the tenant must still
   * accept the letter. This service is WhatsApp-free by design (module cycle),
   * so the CALLER dispatches the letter link. `rent` must carry the `property`
   * relation.
   */
  async prepareCatchUpLetter(rent: Rent): Promise<RenewalInvoice | null> {
    if (await this.hasConfirmedMoveOut(rent.property_id, rent.tenant_id)) {
      this.logger.log(
        `Skipping catch-up letter for rent ${rent.id}: confirmed scheduled move-out.`,
      );
      return null;
    }
    const letter = await this.findOrCreateRenewalInvoice(rent);
    if (!letter) return null;
    if (letter.letter_status === RenewalLetterStatus.DECLINED) {
      this.logger.log(
        `Skipping catch-up letter for rent ${rent.id}: letter ${letter.id} is DECLINED.`,
      );
      return null;
    }
    if (await this.isTargetPeriodCoveredByActiveTenancyPlan(letter)) {
      this.logger.log(
        `Skipping catch-up letter for rent ${rent.id}: active tenancy plan covers the period.`,
      );
      return null;
    }
    return letter;
  }
}

export { LETTER_CHARGE_KIND, LETTER_CHARGE_REVERSAL_KIND };

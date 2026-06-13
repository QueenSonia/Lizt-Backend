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
  RenewalPaymentStatus,
} from '../tenancies/entities/renewal-invoice.entity';
import { Rent } from '../rents/entities/rent.entity';
import {
  RentPaymentStatusEnum,
  RentStatusEnum,
} from '../rents/dto/create-rent.dto';
import { PropertyHistory } from '../property-history/entities/property-history.entity';
import type { TenancyRenewedFromCreditParams } from '../whatsapp-bot/template-sender';
import {
  Fee,
  carryForwardRentColumns,
  renewalInvoiceToFees,
  rentToFees,
  sumRecurring,
} from '../common/billing/fees';
import { advanceRentPeriod } from '../common/utils/rent-date.util';

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
 * Scope: all frequencies. Posts one OB_CHARGE per recurring fee when an
 * ACCEPTED letter's linked rent has reached expiry, regardless of the rent's
 * payment frequency.
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
   * True when the tenant's wallet credit fully covers this letter's recurring
   * period charge — with the own-letter-charge add-back so a period already
   * OB-charged at accept time still reads as covered. Mirrors
   * RentReminderService.isNextPeriodFullyCovered. Used by the acceptance flow
   * to skip the "pay your invoice" link when nothing is actually owed.
   */
  async isLetterPeriodCoveredByCredit(
    letter: RenewalInvoice,
    landlordId: string,
  ): Promise<boolean> {
    const recurringCharge = sumRecurring(renewalInvoiceToFees(letter));
    const walletBalance = await this.tenantBalancesService.getBalance(
      letter.tenant_id,
      landlordId,
    );
    const ownLetterCharge = await this.getLetterAcceptedChargeAmount(letter.id);
    return recurringCharge - (walletBalance + ownLetterCharge) <= 0;
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
   *  - debits the wallet one AUTO_RENEWAL entry per recurring fee,
   *  - if the wallet still covers the charge, marks the new rent PAID, settles
   *    the linked letter as paid-by-wallet-credit, and returns the params for
   *    the tenant "tenancy renewed" confirmation (the CALLER dispatches it via
   *    its own WhatsAppNotificationLogService — this service intentionally has
   *    no whatsapp dependency to avoid a module cycle),
   *  - records a renewal_period_started property-history entry.
   *
   * Dedup vs the non-monthly OB charge (chargeAcceptedRenewalAtExpiry): if the
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

    // Period charge = sum of recurring fees for the new period. From the
    // letter snapshot when honoring one, else the current rent carried forward.
    let recurringFees: Fee[];
    let periodCharge: number;
    if (useLetter && letter) {
      const letterFees = renewalInvoiceToFees(letter);
      recurringFees = letterFees.filter((f) => f.recurring);
      periodCharge = sumRecurring(letterFees);
    } else {
      const currentFees = rentToFees(rent);
      recurringFees = currentFees.filter((f) => f.recurring);
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
      service_charge_recurring: carried.service_charge_recurring,
      legal_fee:
        useLetter && letter && letter.legal_fee != null
          ? Number(letter.legal_fee)
          : carried.legal_fee,
      legal_fee_recurring: carried.legal_fee_recurring,
      agency_fee:
        useLetter && letter && letter.agency_fee != null
          ? Number(letter.agency_fee)
          : carried.agency_fee,
      agency_fee_recurring: carried.agency_fee_recurring,
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
      for (const fee of recurringFees) {
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
    const name = oldRent.tenant?.user?.first_name;
    if (!phone || !name) {
      this.logger.warn(
        `Skipping tenancy-renewed message for rent ${newRent.id}: missing tenant phone or first name.`,
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
}

export { LETTER_CHARGE_KIND, LETTER_CHARGE_REVERSAL_KIND };

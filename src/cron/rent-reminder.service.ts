import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Rent } from '../rents/entities/rent.entity';
import {
  RentPaymentStatusEnum,
  RentStatusEnum,
} from '../rents/dto/create-rent.dto';
import { WhatsAppNotificationLogService } from '../whatsapp-bot/whatsapp-notification-log.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/enums/notification-type';
import {
  PropertyHistory,
  MoveOutReasonEnum,
} from '../property-history/entities/property-history.entity';
import {
  RenewalInvoice,
  RenewalPaymentStatus,
  RenewalLetterStatus,
} from '../tenancies/entities/renewal-invoice.entity';
import { PropertyTenant } from '../properties/entities/property-tenants.entity';
import { Property } from '../properties/entities/property.entity';
import {
  ScheduledMoveOut,
  ScheduledMoveOutStatus,
} from '../properties/entities/scheduled-move-out.entity';
import { PropertiesService } from '../properties/properties.service';
import {
  PropertyStatusEnum,
  TenantStatusEnum,
} from '../properties/dto/create-property.dto';
import { TenantBalancesService } from '../tenant-balances/tenant-balances.service';
import { RenewalChargeService } from '../renewal-letters/renewal-charge.service';
import {
  rentToFees,
  renewalInvoiceToFees,
  sumRecurring,
  sumAll,
  Fee,
  carryForwardRentColumns,
  CarriedRentColumns,
} from '../common/billing/fees';
import { computeRenewalFold } from '../common/billing/renewal-fold';
import {
  advanceRentPeriod,
  effectiveFrequency,
  RENT_REMINDER_SCHEDULE,
} from '../common/utils/rent-date.util';
import {
  PaymentPlanInstallment,
  InstallmentStatus,
} from '../payment-plans/entities/payment-plan-installment.entity';
import {
  PaymentPlanScope,
  PaymentPlanStatus,
} from '../payment-plans/entities/payment-plan.entity';

@Injectable()
export class RentReminderService {
  private readonly logger = new Logger(RentReminderService.name);

  constructor(
    @InjectRepository(Rent)
    private readonly rentRepository: Repository<Rent>,
    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepository: Repository<PropertyHistory>,
    @InjectRepository(RenewalInvoice)
    private readonly renewalInvoiceRepository: Repository<RenewalInvoice>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(PaymentPlanInstallment)
    private readonly installmentRepository: Repository<PaymentPlanInstallment>,
    @InjectRepository(ScheduledMoveOut)
    private readonly scheduledMoveOutRepository: Repository<ScheduledMoveOut>,
    private readonly whatsAppNotificationLogService: WhatsAppNotificationLogService,
    private readonly notificationService: NotificationService,
    private readonly tenantBalancesService: TenantBalancesService,
    private readonly renewalChargeService: RenewalChargeService,
    private readonly propertiesService: PropertiesService,
  ) {}

  /**
   * Build the set of `${property_id}:${tenant_id}` keys for tenancies that have
   * a CONFIRMED scheduled move-out (i.e. renewal was deactivated and the tenant
   * accepted). These are excluded from all renewal/reminder processing — the
   * tenancy is winding down. PENDING_TENANT_CONFIRMATION rows are NOT included:
   * renewal continues until the tenant actually accepts.
   */
  private async getConfirmedLapseKeys(): Promise<Set<string>> {
    const rows = await this.scheduledMoveOutRepository.find({
      where: {
        processed: false,
        status: ScheduledMoveOutStatus.CONFIRMED,
      },
    });
    return new Set(rows.map((r) => `${r.property_id}:${r.tenant_id}`));
  }

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: 'Africa/Lagos' })
  async runDailyReminderCheck() {
    this.logger.log('Starting daily rent reminder check...');
    try {
      // Tenancies with a CONFIRMED renewal deactivation are skipped by every
      // renewal/reminder step below — they're winding down to a scheduled end.
      const lapseKeys = await this.getConfirmedLapseKeys();

      await this.processAutoRenewal(lapseKeys);
      await this.processAcceptedLetterCharges(lapseKeys);
      await this.processUpcomingReminders(lapseKeys);
      await this.processPostExpiryReminders(lapseKeys);
      await this.checkInstallmentReminders();
      // Last: a failure in the (non-critical) landlord heads-up must not skip
      // the core renewal/reminder steps above.
      await this.processLandlordReviewNotices(lapseKeys);

      // Finally, end any tenancies whose CONFIRMED scheduled move-out is now
      // due. Folded into this already-daily cron so the cost-disabled
      // move-out scheduler stays off.
      await this.propertiesService.processScheduledMoveOuts();

      this.logger.log('Completed daily rent reminder check.');
    } catch (error) {
      this.logger.error('Failed to process daily rent reminders', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Accepted-letter OB charge sweep
  // ---------------------------------------------------------------------------

  /**
   * Posts the OB charge for every ACCEPTED renewal letter whose linked active
   * rent has reached its expiry_date but doesn't yet have a
   * letter_accepted_charge ledger entry.
   *
   * Why this is its own step:
   *  - processAutoRenewal only advances (and debits) a rent when the tenant has
   *    accepted AND wallet credit fully covers the period; every other rent
   *    floats, so it never gets a wallet debit at expiry through that path.
   *  - The verifyOtpAndAccept hook (Trigger A) only fires when the rent has
   *    already expired AT the moment of acceptance. Tenants who accept ahead
   *    of expiry need the cron to post their charge when expiry rolls around.
   *  - This sweep also naturally backfills any pre-existing ACCEPTED letters
   *    whose expiry is in the past at deploy time (e.g. Emmanuel) — they
   *    match the candidate query and get charged on the next tick.
   *
   * Idempotency: the candidate query has a NOT EXISTS clause against
   * tenant_balance_ledger for the same letter id + kind, so each letter is
   * processed exactly once. The helper repeats the same check defensively
   * in case the two cron instances race.
   */
  private async processAcceptedLetterCharges(
    lapseKeys: Set<string> = new Set(),
  ) {
    this.logger.log('Processing accepted letter charges...');

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    let candidates: Awaited<
      ReturnType<RenewalChargeService['findChargeCandidates']>
    >;
    try {
      candidates = await this.renewalChargeService.findChargeCandidates(
        this.renewalInvoiceRepository,
        today,
      );
    } catch (error) {
      this.logger.error(
        'Failed to load accepted-letter charge candidates',
        error,
      );
      return;
    }

    this.logger.log(`Found ${candidates.length} accepted letters to charge.`);

    for (const { letter, rent } of candidates) {
      try {
        if (lapseKeys.has(`${rent.property_id}:${rent.tenant_id}`)) {
          continue; // renewal deactivated (tenant-confirmed) — skip
        }
        const result =
          await this.renewalChargeService.chargeAcceptedRenewalAtExpiry(
            letter,
            rent,
            today,
          );
        if (result.skipped) {
          this.logger.log(
            `Skipped letter ${letter.id}: ${result.skipped} (rent ${rent.id}).`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to charge accepted letter ${letter.id} (rent ${rent.id})`,
          error,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Payment plan installment reminders
  // ---------------------------------------------------------------------------

  /**
   * Sends a WhatsApp installment reminder 1 day before the due date and on the
   * due date itself. Deduplicated per installment per day via
   * `last_reminder_sent_on` so the cron can run more than once safely.
   */
  async checkInstallmentReminders(): Promise<void> {
    this.logger.log('Processing payment plan installment reminders...');

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(today.getUTCDate() + 1);

    const todayStr = today.toISOString().split('T')[0];
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const installments = await this.installmentRepository
      .createQueryBuilder('inst')
      .leftJoinAndSelect('inst.plan', 'plan')
      .leftJoinAndSelect('plan.property', 'property')
      .leftJoinAndSelect('plan.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'user')
      .where('inst.status = :status', { status: InstallmentStatus.PENDING })
      .andWhere('plan.status = :planStatus', {
        planStatus: PaymentPlanStatus.ACTIVE,
      })
      .andWhere('DATE(inst.due_date) IN (:...dates)', {
        dates: [todayStr, tomorrowStr],
      })
      .andWhere(
        '(inst.last_reminder_sent_on IS NULL OR DATE(inst.last_reminder_sent_on) < :today)',
        { today: todayStr },
      )
      .getMany();

    this.logger.log(
      `Found ${installments.length} installments needing reminders today.`,
    );

    for (const installment of installments) {
      try {
        await this.sendInstallmentReminder(installment, today);
      } catch (error) {
        this.logger.error(
          `Failed to send installment reminder for installment ${installment.id}`,
          error,
        );
      }
    }
  }

  private async sendInstallmentReminder(
    installment: PaymentPlanInstallment,
    today: Date,
  ): Promise<void> {
    const plan = installment.plan;
    if (!plan) return;

    const phone = plan.tenant?.user?.phone_number;
    const tenantName = plan.tenant?.user?.first_name;
    const propertyName = plan.property?.name;

    if (!phone || !tenantName || !propertyName) {
      this.logger.warn(
        `Skipping installment reminder for ${installment.id}: missing tenant phone / name / property name`,
      );
      return;
    }

    const totalInstallments = await this.installmentRepository.count({
      where: { plan_id: plan.id },
    });
    const installmentLabel = `${installment.sequence} of ${totalInstallments}`;

    const amount = Number(installment.amount).toLocaleString('en-NG', {
      style: 'currency',
      currency: 'NGN',
    });
    const dueDateStr = new Date(installment.due_date).toLocaleDateString(
      'en-GB',
    );

    // Tenant-facing label: "Tenancy" reads better than the stored
    // "Entire Tenancy" sentinel for tenancy-scope plans (matches the
    // payment_plan_created_tenant send).
    const displayChargeName =
      plan.scope === PaymentPlanScope.TENANCY ? 'Tenancy' : plan.charge_name;

    await this.whatsAppNotificationLogService.queue(
      'sendInstallmentReminderTemplate',
      {
        phone_number: phone,
        tenant_name: tenantName,
        property_name: propertyName,
        charge_name: displayChargeName,
        installment_label: installmentLabel,
        amount,
        due_date: dueDateStr,
        pay_token: installment.id,
      },
      installment.id,
    );

    await this.installmentRepository.update(installment.id, {
      last_reminder_sent_on: today,
    });

    await this.propertyHistoryRepository.save(
      this.propertyHistoryRepository.create({
        property_id: plan.property_id,
        tenant_id: plan.tenant_id,
        event_type: 'payment_plan_installment_reminder_sent',
        event_description: `Reminder sent for installment ${installmentLabel} of ${plan.charge_name} — ${amount} due ${dueDateStr}`,
        related_entity_id: installment.id,
        related_entity_type: 'payment_plan_installment',
      }),
    );

    this.logger.log(
      `Queued installment reminder for installment ${installment.id} (${installmentLabel}, due ${dueDateStr}).`,
    );
  }

  // ---------------------------------------------------------------------------
  // Auto-renewal
  // ---------------------------------------------------------------------------

  /**
   * For every active rent whose expiry date has passed, automatically renew
   * it into the next period (OWING).  If the expired period was unpaid, the
   * amount is added to the tenant's TenantBalance.
   *
   * This replaces the old "roll-forward" approach which mutated expiry_date
   * in-place and accumulated debt on the rent record.
   */
  private async processAutoRenewal(lapseKeys: Set<string> = new Set()) {
    this.logger.log('Processing auto-renewal for expired rents...');
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    const expiredRents = await this.rentRepository
      .createQueryBuilder('rent')
      .leftJoinAndSelect('rent.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'user')
      .leftJoinAndSelect('rent.property', 'property')
      .leftJoinAndSelect('property.owner', 'owner')
      .leftJoinAndSelect('owner.user', 'ownerUser')
      .where('rent.rent_status = :status', { status: RentStatusEnum.ACTIVE })
      .andWhere('DATE(rent.expiry_date) < :today', { today: todayStr })
      .getMany();

    this.logger.log(
      `Found ${expiredRents.length} expired rents for auto-renewal.`,
    );

    for (const rent of expiredRents) {
      try {
        if (lapseKeys.has(`${rent.property_id}:${rent.tenant_id}`)) {
          continue; // renewal deactivated (tenant-confirmed) — skip
        }
        await this.autoRenewExpiredRent(rent, today);
      } catch (error) {
        this.logger.error(`Failed to auto-renew rent ${rent.id}`, error);
      }
    }
  }

  /**
   * Advance a single rent forward through any elapsed periods, creating one
   * new ACTIVE/OWING rent record per period.  Marks the old rent INACTIVE.
   *
   * If the expired rent was not PAID, the missed period amount is added to
   * the tenant's TenantBalance for that landlord.
   *
   * Letter-side handling at the entry point:
   *   - declined → move tenant out, skip rent roll-forward (lease ends).
   *   - accepted + wallet fully covers the next period → settle from credit.
   *   - anything else (sent / draft / not covered) → float; the tenant must
   *     accept and then pay. We never auto-accept on the tenant's behalf.
   */
  private async autoRenewExpiredRent(rent: Rent, today: Date): Promise<void> {
    const propertyTenant = await this.propertyTenantRepository.findOne({
      where: {
        property_id: rent.property_id,
        tenant_id: rent.tenant_id,
        status: TenantStatusEnum.ACTIVE,
      },
    });

    // letterSource: the unpaid SENT/ACCEPTED letter whose values should drive
    // the next period's rent row (price, fees, dates), if one exists.
    //   - DRAFT letters aren't honored — the landlord hasn't shared figures
    //     with the tenant yet, so the cron shouldn't surprise either side
    //     with a price the tenant never agreed to.
    //   - PAID letters are skipped — markInvoiceAsPaid already settled the
    //     period and synced the rent row, so there's nothing for the cron
    //     to roll forward here (and the rent shouldn't even be expired-and-
    //     ACTIVE in that case, but defense-in-depth).
    // Applies to a SINGLE period in the multi-expiry catch-up loop below.
    // Subsequent rolled-forward periods (N+2, N+3) fall back to plain
    // carry-forward — we don't propagate a one-off rent change across many
    // periods just because the cron fell several months behind.
    let letterSource: RenewalInvoice | null = null;

    const latestLetter = propertyTenant
      ? await this.renewalInvoiceRepository.findOne({
          where: {
            property_tenant_id: propertyTenant.id,
            superseded_by_id: IsNull(),
          },
          order: { created_at: 'DESC' },
        })
      : null;

    // DECLINED letter ends the tenancy regardless of frequency — the tenant
    // gave an explicit move-out signal, so non-monthly tenants still get the
    // move-out flow (not the "floating" treatment below).
    if (
      propertyTenant &&
      latestLetter?.letter_status === RenewalLetterStatus.DECLINED
    ) {
      await this.handleDeclinedRenewalAtExpiry(
        rent,
        propertyTenant,
        latestLetter,
        today,
      );
      return;
    }

    // All frequencies behave identically: the cron only ADVANCES a rent when the
    // tenant has genuinely ACCEPTED the renewal letter AND wallet credit fully
    // covers the next period — then we settle it silently from credit. Otherwise
    // the tenancy floats (old rent stays ACTIVE+expired) and the OB charge sweep
    // (processAcceptedLetterCharges) + processPostExpiryReminders carry it until
    // the tenant PAYS, which advances the period via markInvoiceAsPaid. We never
    // auto-accept a letter on the tenant's behalf — a SENT-but-unaccepted letter
    // floats just like having no letter at all.
    // Context: Tunji flagged an annual tenant auto-renewed to a ₦13.5M bill after
    // an unsigned letter (2026-05-11); requiring acceptance + full coverage for
    // every frequency keeps that from recurring.
    const accepted =
      !!latestLetter &&
      latestLetter.letter_status === RenewalLetterStatus.ACCEPTED &&
      !latestLetter.superseded_by_id;
    const covered = accepted
      ? await this.isNextPeriodFullyCovered(rent, latestLetter as RenewalInvoice)
      : false;
    if (!accepted || !covered) {
      this.logger.log(
        `Skipping auto-renewal for rent ${rent.id} (${rent.payment_frequency}): accepted=${accepted}, covered=${covered}. OB sweep / post-expiry reminders will handle it.`,
      );
      return;
    }

    if (propertyTenant) {
      // We only reach here when latestLetter is already ACCEPTED (the gate above
      // floats anything not accepted+covered). Honor it as the source for the
      // next period's figures while it is still unpaid.
      if (
        latestLetter &&
        latestLetter.letter_status === RenewalLetterStatus.ACCEPTED &&
        latestLetter.payment_status === RenewalPaymentStatus.UNPAID
      ) {
        letterSource = latestLetter;
      }
    }
    let letterConsumed = false;

    let currentRent = rent;
    let currentExpiry = new Date(rent.expiry_date);
    currentExpiry.setUTCHours(0, 0, 0, 0);

    // The per-period roll-forward (atomic flip, new-rent creation, wallet
    // debit, covered → PAID + confirmation message, history) lives in the
    // shared RenewalChargeService.renewOneFromWalletCredit so the cron and the
    // landlord-triggered "renew now" endpoint stay in lockstep. The letter is
    // consumed on the FIRST iteration only; subsequent missed periods carry the
    // current rent's recurring fees forward.
    //
    // Cron-step ordering note: runDailyReminderCheck runs processAutoRenewal
    // BEFORE processAcceptedLetterCharges. Once we flip the old rent INACTIVE
    // here, that OB-charge sweep's candidate query (active rent + expiry ≤ today)
    // no longer matches this letter — so a renewal settled here is NOT also
    // OB-charged. Keep this ordering; the helper also re-checks
    // getLetterAcceptedChargeAmount defensively.
    while (currentExpiry < today) {
      const useLetter = !!letterSource && !letterConsumed;

      // Float on ONE period: only advance a period wallet credit FULLY covers.
      // renewOneFromWalletCredit commits a period (creates rent + posts debit)
      // before deciding PAID vs OWING, so we must gate BEFORE the call — else a
      // partially-prepaid tenant gets uncovered periods turned into fresh debt.
      // Stop at the first period credit can't cover, leaving it floating.
      const periodCovered = useLetter
        ? await this.isNextPeriodFullyCovered(
            currentRent,
            letterSource as RenewalInvoice,
          )
        : await this.isCarriedPeriodFullyCovered(currentRent);
      if (!periodCovered) {
        this.logger.log(
          `Stopping catch-up for rent ${currentRent.id}: next period not fully covered by wallet credit — leaving it to float.`,
        );
        break;
      }

      const result = await this.renewalChargeService.renewOneFromWalletCredit(
        currentRent,
        useLetter ? letterSource : null,
        today,
        'cron',
      );
      if (result.outcome === 'skipped_already' || !result.newRent) {
        // Another instance advanced this rent; stop the catch-up loop.
        return;
      }
      if (useLetter) letterConsumed = true;

      // Dispatch the tenant "tenancy renewed" confirmation the helper built
      // (covered-by-credit periods only). The helper has no whatsapp
      // dependency by design, so the caller queues it.
      if (result.renewedConfirmation) {
        await this.whatsAppNotificationLogService.queue(
          'sendTenancyRenewedFromCredit',
          result.renewedConfirmation,
          result.newRent.id,
        );
      }

      // Carry the property/tenant relations onto the freshly-created rent so
      // the next catch-up iteration can still resolve owner_id / tenant.user.
      const next = result.newRent;
      next.property = currentRent.property;
      next.tenant = currentRent.tenant;

      currentRent = next;
      currentExpiry = new Date(next.expiry_date);
      currentExpiry.setUTCHours(0, 0, 0, 0);
    }
  }

  /**
   * True when the tenant's wallet credit fully covers the next period's FULL
   * charge for `letter` — every fee on the letter, recurring AND one-time.
   * Uses the same own-letter-charge add-back as findOrCreateRenewalInvoice /
   * TenanciesService.refreshInvoiceTotals so a period that was already
   * OB-charged at accept time still reads as covered.
   *
   * sumAll (not sumRecurring): a one-time fee a landlord added in "Edit next
   * period" is part of this period's charge, so credit covering only the
   * recurring slice must NOT auto-settle the renewal — otherwise the one-time
   * fee would never be collected. (Cron-authored next-period letters snapshot
   * only recurring fees, so sumAll == sumRecurring there — no behavior change.)
   */
  private async isNextPeriodFullyCovered(
    rent: Rent,
    letter: RenewalInvoice,
  ): Promise<boolean> {
    const periodCharge = sumAll(renewalInvoiceToFees(letter));
    const walletBalance = await this.tenantBalancesService.getBalance(
      rent.tenant_id,
      rent.property.owner_id,
    );
    const ownLetterCharge =
      await this.renewalChargeService.getLetterAcceptedChargeAmount(letter.id);
    const effectiveWallet = walletBalance + ownLetterCharge;
    return periodCharge - effectiveWallet <= 0;
  }

  /**
   * True when the tenant's wallet credit fully covers the recurring charge of
   * the NEXT carried-forward period for `rent` (no letter — subsequent periods
   * in the multi-period catch-up loop). Mirrors isNextPeriodFullyCovered but
   * sources the charge from the rent's own recurring fees.
   */
  private async isCarriedPeriodFullyCovered(rent: Rent): Promise<boolean> {
    const recurringCharge = sumRecurring(rentToFees(rent));
    const walletBalance = await this.tenantBalancesService.getBalance(
      rent.tenant_id,
      rent.property.owner_id,
    );
    return recurringCharge - walletBalance <= 0;
  }

  /**
   * Tenant declined the renewal letter — at expiry, end the tenancy:
   * mark the active rent INACTIVE, mark the property_tenant INACTIVE,
   * record a tenant_moved_out property history entry with their decline
   * reason, and notify the landlord. No rent roll-forward.
   */
  private async handleDeclinedRenewalAtExpiry(
    rent: Rent,
    propertyTenant: PropertyTenant,
    letter: RenewalInvoice,
    today: Date,
  ): Promise<void> {
    // 1. Mark current rent inactive (atomic — guards against concurrent runs).
    const updateResult = await this.rentRepository.update(
      { id: rent.id, rent_status: RentStatusEnum.ACTIVE },
      { rent_status: RentStatusEnum.INACTIVE },
    );
    if (updateResult.affected === 0) {
      this.logger.warn(
        `Rent ${rent.id} already processed by another instance — skipping decline-move-out.`,
      );
      return;
    }

    // 2. End the property_tenant relationship.
    await this.propertyTenantRepository.update(propertyTenant.id, {
      status: TenantStatusEnum.INACTIVE,
    });

    // 2a. Vacate the property unless another active rent remains. Skip
    // marketing/offer states so the sync doesn't clobber a parallel
    // offer-letter flow on the same property.
    const remainingActiveRents = await this.rentRepository.count({
      where: {
        property_id: rent.property_id,
        rent_status: RentStatusEnum.ACTIVE,
      },
    });
    if (remainingActiveRents === 0) {
      await this.propertyRepository
        .createQueryBuilder()
        .update(Property)
        .set({ property_status: PropertyStatusEnum.VACANT })
        .where('id = :id', { id: rent.property_id })
        .andWhere('property_status NOT IN (:...skip)', {
          skip: [
            PropertyStatusEnum.INACTIVE,
            PropertyStatusEnum.READY_FOR_MARKETING,
            PropertyStatusEnum.OFFER_PENDING,
            PropertyStatusEnum.OFFER_ACCEPTED,
          ],
        })
        .execute();
    }

    // 3. Property history — surfaces in the timeline as a normal move-out.
    const declineReason = letter.decline_reason?.trim() || null;
    const description = declineReason
      ? `Tenant declined renewal: ${declineReason}`
      : 'Tenant declined renewal (no reason provided)';
    await this.propertyHistoryRepository.save({
      property_id: rent.property_id,
      tenant_id: rent.tenant_id,
      event_type: 'tenant_moved_out',
      event_description: description,
      move_out_date: today,
      move_out_reason: MoveOutReasonEnum.OTHER,
      owner_comment: declineReason,
      related_entity_id: letter.id,
      related_entity_type: 'renewal_invoice',
    });

    // 4. Landlord notification.
    if (rent.property?.owner_id) {
      const tenantName =
        `${rent.tenant?.user?.first_name ?? ''} ${rent.tenant?.user?.last_name ?? ''}`.trim() ||
        'Tenant';
      const propName = rent.property?.name ?? 'property';
      this.notificationService
        .create({
          date: new Date().toISOString(),
          type: NotificationType.TENANCY_ENDED,
          description: `${tenantName} declined renewal — moved out of ${propName}.`,
          status: 'Completed',
          property_id: rent.property_id,
          user_id: rent.property.owner_id,
        })
        .catch((err) =>
          this.logger.error(
            `Failed to notify landlord of declined-renewal move-out for rent ${rent.id}: ${err.message}`,
          ),
        );
    }

    this.logger.log(
      `Tenant ${rent.tenant_id} moved out of property ${rent.property_id} after declining renewal (rent ${rent.id} expired).`,
    );
  }

  // ---------------------------------------------------------------------------
  // Landlord "review next period" notice (one day before the tenant's first reminder)
  // ---------------------------------------------------------------------------

  /**
   * One day before the tenant's FIRST renewal touch for a cycle (the first
   * pre-expiry reminder / letter link), notify the landlord so they can review
   * and adjust the next period's figures before the tenant sees them.
   *
   * Timing per frequency = max(reminder schedule) + 1 days before expiry:
   *   monthly 15, quarterly 31, bi-annually 91, annually 181.
   *
   * Fires on BOTH channels (in-app NotificationService + WhatsApp landlord
   * template) and for all frequencies. Deduped via the WhatsApp notification
   * log; the single-day date match is the primary guard.
   */
  private async processLandlordReviewNotices(
    lapseKeys: Set<string> = new Set(),
  ) {
    this.logger.log('Processing landlord renewal-review notices...');
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Distinct "first reminder + 1" leads across every frequency.
    const leads = new Set<number>();
    Object.values(RENT_REMINDER_SCHEDULE).forEach((days) => {
      if (days.length) leads.add(Math.max(...days) + 1);
    });
    const targetDates = Array.from(leads).map((d) => {
      const date = new Date(today);
      date.setUTCDate(today.getUTCDate() + d);
      return date.toISOString().split('T')[0];
    });
    if (targetDates.length === 0) return;

    const rents = await this.rentRepository
      .createQueryBuilder('rent')
      .leftJoinAndSelect('rent.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'user')
      .leftJoinAndSelect('rent.property', 'property')
      .leftJoinAndSelect('property.owner', 'owner')
      .leftJoinAndSelect('owner.user', 'ownerUser')
      .where('rent.rent_status = :status', { status: RentStatusEnum.ACTIVE })
      .andWhere('DATE(rent.expiry_date) IN (:...dates)', { dates: targetDates })
      .getMany();

    this.logger.log(
      `Found ${rents.length} rents for landlord renewal-review notices.`,
    );

    for (const rent of rents) {
      try {
        if (lapseKeys.has(`${rent.property_id}:${rent.tenant_id}`)) {
          continue; // renewal deactivated (tenant-confirmed) — skip
        }
        if (!rent.expiry_date) continue;
        const expiryDate = new Date(rent.expiry_date);
        expiryDate.setUTCHours(0, 0, 0, 0);
        const daysUntilExpiry = Math.floor(
          (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
        );
        const schedule =
          RENT_REMINDER_SCHEDULE[effectiveFrequency(rent)] ||
          RENT_REMINDER_SCHEDULE.monthly;
        const lead = Math.max(...schedule) + 1;
        // Only the exact "one day before the first reminder" slot for this
        // rent's own frequency (a different frequency may share the date).
        if (daysUntilExpiry !== lead) continue;
        await this.sendLandlordReviewNotice(rent, lead);
      } catch (error) {
        this.logger.error(
          `Failed to send landlord review notice for rent ${rent.id}`,
          error,
        );
      }
    }
  }

  private async sendLandlordReviewNotice(
    rent: Rent,
    daysBefore: number,
  ): Promise<void> {
    const templateName = 'sendLandlordRenewalReview';

    const ownerId = rent.property?.owner_id;
    if (!ownerId) {
      this.logger.warn(
        `Skipping landlord review notice for rent ${rent.id}: missing property owner.`,
      );
      return;
    }

    const alreadySent =
      await this.whatsAppNotificationLogService.existsForDaysBeforeExpiry(
        rent.id,
        templateName,
        daysBefore,
      );
    if (alreadySent) {
      this.logger.debug(
        `Landlord review notice already sent for rent ${rent.id} (${daysBefore}d).`,
      );
      return;
    }

    // Prefer an already-created renewal invoice (a landlord-saved letter/draft,
    // or one from a tenant request) so the heads-up matches exactly what the
    // tenant will be billed — including any landlord edits and the invoice's
    // own period dates. Otherwise project the figures from the rent read-only.
    const existingInvoice = await this.findExistingNextPeriodInvoice(rent);
    let summary: {
      startDate: Date;
      endDate: Date;
      rentAmount: number;
      serviceCharge: number;
      totalAmount: number;
    };
    if (existingInvoice) {
      summary = {
        startDate: new Date(existingInvoice.start_date),
        endDate: new Date(existingInvoice.end_date),
        rentAmount: Number(existingInvoice.rent_amount ?? 0),
        serviceCharge: Number(existingInvoice.service_charge ?? 0),
        totalAmount: Number(existingInvoice.total_amount ?? 0),
      };
    } else {
      const walletBalance = await this.tenantBalancesService.getBalance(
        rent.tenant_id,
        ownerId,
      );
      const claimedByPlans =
        await this.tenantBalancesService.sumActiveWalletBackedPlanClaims(
          rent.tenant_id,
          ownerId,
        );
      summary = this.computeNextPeriodSummary(
        rent,
        walletBalance,
        claimedByPlans,
      );
    }

    const fmtDate = (d: Date) =>
      new Date(d).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    const fmtNgn = (v: number) =>
      Number(v || 0).toLocaleString('en-NG', {
        style: 'currency',
        currency: 'NGN',
      });

    const period = `${fmtDate(summary.startDate)} - ${fmtDate(summary.endDate)}`;
    const rentAmountStr = fmtNgn(summary.rentAmount);
    const serviceChargeStr = fmtNgn(summary.serviceCharge);
    const expectedAmountStr = fmtNgn(summary.totalAmount);

    const owner = rent.property?.owner;
    const landlordName =
      owner?.profile_name ||
      `${owner?.user?.first_name ?? ''} ${owner?.user?.last_name ?? ''}`.trim() ||
      'there';
    const landlordPhone = owner?.user?.phone_number;
    const tenantName =
      `${rent.tenant?.user?.first_name ?? ''} ${rent.tenant?.user?.last_name ?? ''}`.trim() ||
      'your tenant';
    const propertyName = rent.property?.name ?? 'your property';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    // Status line: when wallet credit fully covers the period, the pay reminder
    // is suppressed. Renewal of any frequency auto-settles from credit only once
    // the tenant accepts the renewal letter, so we always word it that way.
    const renewOnStr = fmtDate(summary.startDate);
    const covered = summary.totalAmount <= 0;
    let statusNote: string;
    if (covered) {
      statusNote = `This period is fully covered by wallet credit, so no payment reminder will be sent — it auto-renews on ${renewOnStr} once ${tenantName} accepts the renewal letter.`;
    } else {
      statusNote = `Your tenant's first renewal reminder goes out tomorrow.`;
    }

    // WhatsApp first so the dedup log entry exists before the in-app write.
    if (landlordPhone) {
      await this.whatsAppNotificationLogService.queue(
        templateName,
        {
          phone_number: landlordPhone,
          landlord_name: landlordName,
          tenant_name: tenantName,
          property_name: propertyName,
          period,
          rent_amount: rentAmountStr,
          service_charge: serviceChargeStr,
          expected_amount: expectedAmountStr,
          status_note: statusNote,
          // Meta URL-button dynamic var must be clean + last, so it's the bare
          // propertyId; the base path (.../renew-tenancy/{{1}}) carries the
          // action and forwards to the Renew Tenancy screen.
          review_path: rent.property_id,
          days_before_expiry: daysBefore,
        },
        rent.id,
      );
    } else {
      this.logger.warn(
        `Landlord for rent ${rent.id} has no phone — sending in-app review notice only.`,
      );
    }

    // In-app dashboard notification (deep-links to the property via property_id).
    await this.notificationService
      .create({
        date: new Date().toISOString(),
        type: NotificationType.RENEWAL_REVIEW_DUE,
        description:
          `${tenantName}'s tenancy at ${propertyName} is coming up for renewal. ` +
          `Next period ${period} — rent ${rentAmountStr}, service charge ${serviceChargeStr}, expected from tenant ${expectedAmountStr}. ` +
          `${statusNote} ` +
          `Review or adjust the renewal now: ${frontendUrl}/landlord/renew-tenancy/${rent.property_id}`,
        status: 'Completed',
        property_id: rent.property_id,
        user_id: ownerId,
      })
      .catch((err) =>
        this.logger.error(
          `Failed to create in-app review notice for rent ${rent.id}: ${err.message}`,
        ),
      );

    this.logger.log(
      `Queued landlord renewal-review notice for rent ${rent.id} (${daysBefore}d before expiry).`,
    );
  }

  /**
   * Read-only next-period figure summary for the landlord review notice —
   * mirrors findOrCreateRenewalInvoice's math (one-time fees stripped for a
   * next period, total netted against wallet credit) WITHOUT persisting an
   * invoice. The real invoice is still created on the first reminder day.
   */
  /**
   * The already-created next-period renewal invoice for this rent, if any —
   * a non-superseded unpaid/partial landlord or draft letter covering the
   * target period. Mirrors the "existing" lookup in findOrCreateRenewalInvoice
   * (read-only — does NOT create one). Used by the landlord review notice so it
   * reports the real invoice figures when one exists.
   */
  private async findExistingNextPeriodInvoice(
    rent: Rent,
  ): Promise<RenewalInvoice | null> {
    const propertyTenant = await this.propertyTenantRepository.findOne({
      where: {
        property_id: rent.property_id,
        tenant_id: rent.tenant_id,
        status: TenantStatusEnum.ACTIVE,
      },
    });
    if (!propertyTenant) return null;

    const { startDate } = this.getTargetPeriodRange(rent);
    return this.renewalInvoiceRepository.findOne({
      where: {
        property_tenant_id: propertyTenant.id,
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
  }

  private computeNextPeriodSummary(
    rent: Rent,
    walletBalance: number,
    claimedByPlans = 0,
  ): {
    startDate: Date;
    endDate: Date;
    rentAmount: number;
    serviceCharge: number;
    totalAmount: number;
  } {
    const isCurrentOwingPeriod =
      rent.payment_status === RentPaymentStatusEnum.OWING;
    const sourceRent = isCurrentOwingPeriod
      ? rent
      : ({ ...rent, ...this.carryForwardFees(rent) } as Rent);
    const fees = rentToFees(sourceRent);
    const periodCharge = sumAll(fees);
    // Exclude plan-owned wallet OB so the reminder preview matches the actual
    // (plan-adjusted) invoice total the tenant will be billed.
    const { totalAmount } = computeRenewalFold({
      periodCharge,
      walletBalance,
      claimedByPlans,
    });
    const rentAmount = Number(
      sourceRent.rental_price ?? sourceRent.amount_paid ?? 0,
    );
    const serviceCharge = Number(sourceRent.service_charge ?? 0);
    const { startDate, endDate } = this.getTargetPeriodRange(rent);
    return { startDate, endDate, rentAmount, serviceCharge, totalAmount };
  }

  // ---------------------------------------------------------------------------
  // Upcoming reminders (before expiry)
  // ---------------------------------------------------------------------------

  private async processUpcomingReminders(lapseKeys: Set<string> = new Set()) {
    this.logger.log('Processing upcoming rent reminders...');
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Collect all valid reminder days across all frequencies (builds a set of unique values)
    const allReminderDays = new Set<number>();
    Object.values(RENT_REMINDER_SCHEDULE).forEach((days) => {
      days.forEach((day) => allReminderDays.add(day));
    });

    const targetDates = Array.from(allReminderDays).map((d) => {
      const date = new Date(today);
      date.setUTCDate(today.getUTCDate() + d);
      return date.toISOString().split('T')[0];
    });

    if (targetDates.length === 0) return;

    // Find all active rents whose expiry_date is in the targetDates list
    const rents = await this.rentRepository
      .createQueryBuilder('rent')
      .leftJoinAndSelect('rent.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'user')
      .leftJoinAndSelect('rent.property', 'property')
      .leftJoinAndSelect('property.owner', 'owner')
      .leftJoinAndSelect('owner.user', 'ownerUser')
      .where('rent.rent_status = :status', { status: RentStatusEnum.ACTIVE })
      .andWhere('DATE(rent.expiry_date) IN (:...dates)', { dates: targetDates })
      .getMany();

    this.logger.log(`Found ${rents.length} upcoming rents to remind.`);

    for (const rent of rents) {
      try {
        if (lapseKeys.has(`${rent.property_id}:${rent.tenant_id}`)) {
          continue; // renewal deactivated (tenant-confirmed) — skip
        }
        if (!rent.expiry_date) continue;

        const expiryDate = new Date(rent.expiry_date);
        expiryDate.setUTCHours(0, 0, 0, 0);
        const daysUntilExpiry = Math.floor(
          (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
        );

        const schedule =
          RENT_REMINDER_SCHEDULE[effectiveFrequency(rent)] ||
          RENT_REMINDER_SCHEDULE.monthly;

        if (!schedule.includes(daysUntilExpiry)) continue;

        await this.sendReminderIfNotSent(rent, daysUntilExpiry);
      } catch (error) {
        this.logger.error(
          `Failed to process reminder for rent ${rent.id}`,
          error,
        );
        if (rent.property?.owner_id) {
          this.notificationService
            .create({
              date: new Date().toISOString(),
              type: NotificationType.RENT_REMINDER_FAILED,
              description: `Failed to send rent reminder to ${rent.tenant?.user?.first_name ?? 'tenant'} for ${rent.property?.name ?? 'property'}.`,
              status: 'Completed',
              property_id: rent.property_id,
              user_id: rent.property.owner_id,
            })
            .catch((notifErr) =>
              this.logger.error(
                `Failed to create failure notification for rent ${rent.id}`,
                notifErr,
              ),
            );
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Post-expiry reminder (1 day after expiry, if still unpaid after auto-renewal)
  // ---------------------------------------------------------------------------

  /**
   * Sends the overdue reminder on day 1 and day 7 after the period rolled
   * over, if the tenant still hasn't paid for the next period.
   *
   * Two cases hit this path:
   *  1. **Auto-renewed (monthly)**: cron created a new ACTIVE+OWING rent
   *     starting today. Reminder fires when rent_start_date is today or 7
   *     days ago. The rent's own payment_status === OWING is meaningful
   *     here — the cron stamps it that way for the unpaid new period — so
   *     we use it as a filter.
   *  2. **Floating (non-monthly)**: cron skipped auto-renewal per the
   *     monthly-only policy. The OLD rent stays ACTIVE with an expired
   *     expiry_date; its payment_status reflects the prior period's state
   *     (often stale — e.g. 'pending' even when the wallet shows the prior
   *     period was paid via OB). For this branch we do NOT filter on the
   *     rent's payment_status; sendOverdueReminder→findOrCreateRenewalInvoice
   *     uses the renewal_invoice's payment_status as the source of truth
   *     for whether the next period is still owed.
   */
  private async processPostExpiryReminders(lapseKeys: Set<string> = new Set()) {
    this.logger.log('Processing post-expiry rent reminders...');

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const todayStr = today.toISOString().split('T')[0];
    const oneDayAgo = new Date(today);
    oneDayAgo.setUTCDate(today.getUTCDate() - 1);
    const oneDayAgoStr = oneDayAgo.toISOString().split('T')[0];
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setUTCDate(today.getUTCDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

    const rents = await this.rentRepository
      .createQueryBuilder('rent')
      .leftJoinAndSelect('rent.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'user')
      .leftJoinAndSelect('rent.property', 'property')
      .leftJoinAndSelect('property.owner', 'owner')
      .leftJoinAndSelect('owner.user', 'ownerUser')
      .where('rent.rent_status = :status', { status: RentStatusEnum.ACTIVE })
      .andWhere(
        `(
          (rent.payment_status = :paymentStatus
            AND DATE(rent.rent_start_date) IN (:...startDates))
          OR
          DATE(rent.expiry_date) IN (:...expiryDates)
        )`,
        {
          paymentStatus: RentPaymentStatusEnum.OWING,
          startDates: [todayStr, sevenDaysAgoStr],
          expiryDates: [oneDayAgoStr, sevenDaysAgoStr],
        },
      )
      .getMany();

    this.logger.log(
      `Found ${rents.length} owing rents to remind (renewed or floating).`,
    );

    for (const rent of rents) {
      try {
        if (lapseKeys.has(`${rent.property_id}:${rent.tenant_id}`)) {
          continue; // renewal deactivated (tenant-confirmed) — skip
        }
        const expiry = new Date(rent.expiry_date);
        expiry.setUTCHours(0, 0, 0, 0);
        const rentStart = new Date(rent.rent_start_date);
        rentStart.setUTCHours(0, 0, 0, 0);

        // Floating case: the rent's own period has already ended (expiry
        // < today). Use expiry_date as the due anchor so day-1 / day-7 line
        // up with "1 day past expiry" / "7 days past expiry".
        const isFloating = expiry < today;
        let dueDate: Date;
        if (isFloating) {
          dueDate = expiry;
        } else {
          // OWING rent matched on rent_start_date (today or 7 days ago).
          // If it's an auto-renewed period, the payment fell due when the
          // PREVIOUS period expired = the day before this one started.
          // Anchoring on rent_start_date itself made the creation-day tick
          // read as 0 days overdue, which `0 < 0` routed into the upcoming
          // day-0 reminder — the tenant got "is due to expire today,
          // <NEXT expiry>" instead of the overdue template, and the day-1
          // overdue was unreachable.
          const prevExpiry = new Date(rentStart);
          prevExpiry.setUTCDate(prevExpiry.getUTCDate() - 1);
          const renewed = await this.rentRepository
            .createQueryBuilder('prev')
            .where('prev.property_id = :propertyId', {
              propertyId: rent.property_id,
            })
            .andWhere('prev.tenant_id = :tenantId', {
              tenantId: rent.tenant_id,
            })
            .andWhere('prev.rent_status = :inactive', {
              inactive: RentStatusEnum.INACTIVE,
            })
            .andWhere('DATE(prev.expiry_date) = :prevExpiry', {
              prevExpiry: prevExpiry.toISOString().split('T')[0],
            })
            .getCount();
          if (renewed > 0) {
            dueDate = prevExpiry;
          } else {
            // First period of a brand-new tenancy. Nothing is "overdue" on
            // move-in day — the pre-expiry cadence covers it. The day-7
            // unpaid nudge still fires, anchored on the start date the
            // payment was due.
            if (rentStart.getTime() === today.getTime()) {
              this.logger.log(
                `Skipping post-expiry reminder for rent ${rent.id}: first period started today.`,
              );
              continue;
            }
            dueDate = rentStart;
          }
        }
        const daysOverdue = Math.floor(
          (today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysOverdue <= 0) continue;
        await this.sendOverdueReminder(rent, -daysOverdue, dueDate);
      } catch (error) {
        this.logger.error(
          `Failed to process post-expiry reminder for rent ${rent.id}`,
          error,
        );
        if (rent.property?.owner_id) {
          this.notificationService
            .create({
              date: new Date().toISOString(),
              type: NotificationType.RENT_REMINDER_FAILED,
              description: `Failed to send overdue reminder to ${rent.tenant?.user?.first_name ?? 'tenant'} for ${rent.property?.name ?? 'property'}.`,
              status: 'Completed',
              property_id: rent.property_id,
              user_id: rent.property.owner_id,
            })
            .catch((notifErr) =>
              this.logger.error(
                `Failed to create failure notification for rent ${rent.id}`,
                notifErr,
              ),
            );
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Upcoming reminder helpers (same as before, stripped of original_expiry_date)
  // ---------------------------------------------------------------------------

  private async sendReminderIfNotSent(rent: Rent, daysUntilExpiry: number) {
    if (!rent.tenant?.user?.phone_number || !rent.property?.name) {
      this.logger.warn(
        `Skipping rent reminder for rent ${rent.id}: missing tenant phone or property name`,
      );
      return;
    }

    // Overdue: rent was auto-renewed and previous period is still unpaid
    if (daysUntilExpiry < 0) {
      await this.sendOverdueReminder(rent, daysUntilExpiry);
      return;
    }

    // Every reminder now goes through the renewal flow — letter link
    // until the tenant accepts, then invoice link until they pay. The
    // "standard rent reminder with no link" branch is gone: with the
    // letter+OTP feature, every reminder is renewal-related.
    const renewalInvoice = await this.findOrCreateRenewalInvoice(rent);
    if (!renewalInvoice) {
      // Fallback only when findOrCreate could not resolve the property
      // tenant — preserves a useful "your rent expires" ping rather than
      // dropping the reminder silently.
      const baseAmount = rent.rental_price ?? rent.amount_paid ?? 0;
      const amountToPay = baseAmount + (rent.service_charge || 0);
      const formattedAmount = amountToPay.toLocaleString('en-NG', {
        style: 'currency',
        currency: 'NGN',
      });
      const expiryDateStr = new Date(rent.expiry_date).toLocaleDateString(
        'en-GB',
      );
      await this.queueStandardReminder(
        rent,
        formattedAmount,
        expiryDateStr,
        daysUntilExpiry,
      );
      await this.logReminderSent(
        rent,
        formattedAmount,
        expiryDateStr,
        daysUntilExpiry,
      );
      return;
    }

    const letterStatus = renewalInvoice.letter_status;

    // Tenant declined — don't send any more reminders for this period.
    // processOverdueRents handles the move-out + history at expiry.
    if (letterStatus === RenewalLetterStatus.DECLINED) {
      this.logger.log(
        `Skipping reminder for rent ${rent.id}: tenant declined renewal letter.`,
      );
      return;
    }

    // The "due on" date in the body is the CURRENT rent's expiry — that's
    // when the next period's payment becomes due. The Meta body now reads
    // "…your tenancy for {{2}} {{3}}." so {{3}} carries the entire verb
    // phrase: "is due to expire …" for future/today, "expired …" for past.
    // Landlord livefeed logs reuse the plain date.
    const expiryDateStr = new Date(rent.expiry_date).toLocaleDateString(
      'en-GB',
      { day: 'numeric', month: 'long', year: 'numeric' },
    );
    const bodyExpiryDateStr =
      daysUntilExpiry === 0
        ? `is due to expire today, ${expiryDateStr}`
        : daysUntilExpiry === 1
          ? `is due to expire tomorrow, ${expiryDateStr}`
          : daysUntilExpiry === -1
            ? `expired yesterday, ${expiryDateStr}`
            : daysUntilExpiry < 0
              ? `expired on ${expiryDateStr}`
              : `is due to expire on ${expiryDateStr}`;
    // The accepted-letter invoice template (rent_reminder_with_renewal) talks
    // about the RENT being due, not the tenancy expiring, so it needs its own
    // verb phrase. Its Meta body reads "…rent for {{3}} {{4}}.", so {{4}}
    // carries the entire "is due today, <date>" / "is due tomorrow, <date>" /
    // "was due yesterday, <date>" phrase (mirrors bodyExpiryDateStr above but
    // with rent-due wording).
    const bodyDueDateStr =
      daysUntilExpiry === 0
        ? `is due today, ${expiryDateStr}`
        : daysUntilExpiry === 1
          ? `is due tomorrow, ${expiryDateStr}`
          : daysUntilExpiry === -1
            ? `was due yesterday, ${expiryDateStr}`
            : daysUntilExpiry < 0
              ? `was due on ${expiryDateStr}`
              : `is due on ${expiryDateStr}`;
    // For PARTIAL invoices, the "Amount due" we surface is the remaining
    // balance (total - prior payments), not the original total — the same
    // template body works for both fresh and partial cases since the {{5}}
    // slot is just "Amount due".
    const totalAmount = Number(renewalInvoice.total_amount || 0);
    const amountPaidSoFar = Number(renewalInvoice.amount_paid ?? 0);
    const amountToPay =
      renewalInvoice.payment_status === RenewalPaymentStatus.PARTIAL
        ? Math.max(0, totalAmount - amountPaidSoFar)
        : totalAmount;
    const formattedAmount = amountToPay.toLocaleString('en-NG', {
      style: 'currency',
      currency: 'NGN',
    });

    // Suppress reminder if the period is already PAID (early payment,
    // manual mark-paid, etc.). Seed the dedup log so the slot is not
    // retried on the next cron tick.
    if (await this.isTargetPeriodPaid(rent)) {
      this.logger.log(
        `Skipping renewal reminder for rent ${rent.id}: target period already PAID.`,
      );
      await this.logReminderSent(
        rent,
        formattedAmount,
        expiryDateStr,
        daysUntilExpiry,
      );
      return;
    }

    // Branch by letter status:
    //   'sent'     → letter link (sendRenewalLetterLink → /renewal-letters/{token})
    //   'accepted' → invoice link (sendRentReminderWithRenewalTemplate → /renewal-invoice/{token})
    // PARTIAL invoices use the same accepted-letter template; only the
    // amount-due variable differs (remaining vs total — handled above).
    const useLetterTemplate = letterStatus === RenewalLetterStatus.SENT;
    const templateName = useLetterTemplate
      ? 'sendRenewalLetterLink'
      : 'sendRentReminderWithRenewalTemplate';

    // Credit-coverage gate: when wallet credit already fully covers the next
    // period (total_amount nets to 0), suppress the "pay now" reminder — the
    // invoice will auto-settle from credit at the due-date rollover. We do NOT
    // gate the acceptance letter (SENT branch): the tenant must still accept
    // for the invoice to be generated and (non-monthly) for auto-renewal to be
    // authorized. Re-evaluated every tick, so if the credit is later spent the
    // reminder resumes; we don't log a "sent" event for a message we withheld.
    if (!useLetterTemplate && Number(renewalInvoice.total_amount || 0) === 0) {
      this.logger.log(
        `Suppressing pay reminder for rent ${rent.id}: next period fully covered by wallet credit.`,
      );
      return;
    }

    const alreadySent =
      await this.whatsAppNotificationLogService.existsForDaysBeforeExpiry(
        rent.id,
        templateName,
        daysUntilExpiry,
      );

    if (alreadySent) {
      this.logger.debug(
        `Rent reminder already sent for rent ${rent.id} at ${daysUntilExpiry} days (${templateName}).`,
      );
      return;
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    if (useLetterTemplate) {
      await this.whatsAppNotificationLogService.queue(
        'sendRenewalLetterLink',
        {
          phone_number: rent.tenant.user.phone_number,
          tenant_name: rent.tenant.user.first_name,
          property_name: rent.property.name,
          expiry_date: bodyExpiryDateStr,
          renewal_token: renewalInvoice.token,
        },
        rent.id,
      );

      this.logger.log(
        `Queued renewal letter reminder for rent ${rent.id} (${daysUntilExpiry} days before expiry).`,
      );
    } else {
      // The rent_reminder_with_renewal Meta body now reads "…rent for {{3}}
      // {{4}}.", so {{4}} carries the relative due-phrase ("is due today,
      // …" / "is due tomorrow, …" / "was due yesterday, …"). Pass the
      // rent-due variant (bodyDueDateStr), NOT bodyExpiryDateStr — the latter
      // says "is due to expire today" which reads wrong next to "rent".
      await this.whatsAppNotificationLogService.queue(
        'sendRentReminderWithRenewalTemplate',
        {
          phone_number: rent.tenant.user.phone_number,
          tenant_name: rent.tenant.user.first_name,
          property_name: rent.property.name,
          rent_amount: formattedAmount,
          expiry_date: bodyDueDateStr,
          renewal_token: renewalInvoice.token,
          frontend_url: frontendUrl,
          payment_frequency: rent.payment_frequency || 'Monthly',
          days_before_expiry: daysUntilExpiry,
        },
        rent.id,
      );

      this.logger.log(
        `Queued rent reminder with invoice link for rent ${rent.id} (${daysUntilExpiry} days before expiry).`,
      );
    }

    await this.logReminderSent(
      rent,
      formattedAmount,
      expiryDateStr,
      daysUntilExpiry,
    );
  }

  private async queueStandardReminder(
    rent: Rent,
    formattedAmount: string,
    expiryDateStr: string,
    daysUntilExpiry: number,
  ) {
    await this.whatsAppNotificationLogService.queue(
      'sendRentReminderTemplate',
      {
        phone_number: rent.tenant.user.phone_number,
        tenant_name: rent.tenant.user.first_name,
        property_name: rent.property.name,
        rent_amount: formattedAmount,
        expiry_date: expiryDateStr,
        days_before_expiry: daysUntilExpiry,
      },
      rent.id,
    );
    this.logger.log(
      `Queued rent reminder for rent ${rent.id} (${daysUntilExpiry} days before expiry).`,
    );
  }

  private async sendOverdueReminder(
    rent: Rent,
    daysBefore: number,
    dueDate?: Date,
  ) {
    const templateName = 'rent_overdue_with_renewal';

    // When the payment fell due. processPostExpiryReminders passes it
    // explicitly (previous period's expiry for auto-renewed rents, own
    // expiry for floating ones, start date for an unpaid first period).
    // Fallback mirrors that logic for any other caller.
    let due = dueDate;
    if (!due) {
      const expiry = new Date(rent.expiry_date);
      expiry.setUTCHours(0, 0, 0, 0);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      if (expiry < today) {
        due = expiry;
      } else {
        due = new Date(rent.rent_start_date);
        due.setUTCHours(0, 0, 0, 0);
        due.setUTCDate(due.getUTCDate() - 1);
      }
    }
    const dueDateStr = due.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const duePhrase = daysBefore === -1 ? 'yesterday' : `on ${dueDateStr}`;

    const alreadySent =
      await this.whatsAppNotificationLogService.existsForDaysBeforeExpiry(
        rent.id,
        templateName,
        daysBefore,
      );

    if (alreadySent) {
      this.logger.debug(
        `Overdue reminder already sent for rent ${rent.id} at ${daysBefore} days.`,
      );
      return;
    }

    const renewalInvoice = await this.findOrCreateRenewalInvoice(rent);
    if (!renewalInvoice) {
      this.logger.warn(
        `Skipping overdue reminder for rent ${rent.id}: no renewal invoice.`,
      );
      return;
    }

    // Credit-coverage gate: if wallet credit fully covers the period (nets to
    // 0), don't send an overdue ping — even for a tenant who is currently past
    // due. The credit is consumed at the next rollover (next tick for floating
    // non-monthly, next expiry for monthly). Re-evaluated each run; no "sent"
    // event is logged for a withheld message.
    if (Number(renewalInvoice.total_amount || 0) === 0) {
      this.logger.log(
        `Suppressing overdue reminder for rent ${rent.id}: period fully covered by wallet credit.`,
      );
      return;
    }

    // Mirror the figure the tenant sees on the invoice page: sum of every
    // fee on the renewal invoice, minus wallet credit. `total_amount` is
    // refreshed on each cron tick by findOrCreateRenewalInvoice above.
    const formattedAmount = Number(renewalInvoice.total_amount).toLocaleString(
      'en-NG',
      { style: 'currency', currency: 'NGN' },
    );

    // Period must describe the SAME thing as the amount — i.e. the renewal
    // period the tenant is being asked to pay for — so source both from the
    // renewal invoice. Using the rent's own dates was wrong for floating
    // non-monthly tenancies: the cron leaves the expired rent ACTIVE with its
    // old period (e.g. 2025–26), so the message showed last year's dates next
    // to this year's renewal amount. For monthly auto-renewed rents the
    // invoice period equals the rent period, so this is a no-op there.
    // Fall back to the rent's dates only if the invoice somehow lacks them.
    const periodStart = renewalInvoice.start_date ?? rent.rent_start_date;
    const periodEnd = renewalInvoice.end_date ?? rent.expiry_date;
    const startDateStr = new Date(periodStart).toLocaleDateString('en-GB');
    const endDateStr = new Date(periodEnd).toLocaleDateString('en-GB');
    const period = `${startDateStr} - ${endDateStr}`;

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    await this.whatsAppNotificationLogService.queue(
      templateName,
      {
        phone_number: rent.tenant.user.phone_number,
        tenant_name: rent.tenant.user.first_name,
        rent_amount: formattedAmount,
        period,
        property_name: rent.property.name,
        due_phrase: duePhrase,
        renewal_token: renewalInvoice.token,
        frontend_url: frontendUrl,
        days_before_expiry: daysBefore,
      },
      rent.id,
    );

    this.logger.log(`Queued overdue reminder for rent ${rent.id}.`);

    await this.logReminderSent(rent, formattedAmount, period, daysBefore);
  }

  // ---------------------------------------------------------------------------
  // Renewal invoice helper
  // ---------------------------------------------------------------------------

  /**
   * Find or create an unpaid landlord renewal invoice for a rent.
   *
   * For an OWING rent (already auto-renewed):
   *   invoice period = rent's own start/expiry dates (the current unpaid period)
   * For a pre-expiry upcoming reminder:
   *   invoice period = next period (expiry + 1 day … advance by frequency)
   */
  private async findOrCreateRenewalInvoice(
    rent: Rent,
  ): Promise<RenewalInvoice | null> {
    try {
      const propertyTenant = await this.propertyTenantRepository.findOne({
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
      // re-bill at every renewal. We mirror this through carryForwardFees
      // so rentToFees and the legacy scalar columns below see the same
      // adjusted values.
      const isCurrentOwingPeriod =
        rent.payment_status === RentPaymentStatusEnum.OWING;
      const sourceRent = isCurrentOwingPeriod
        ? rent
        : ({ ...rent, ...this.carryForwardFees(rent) } as Rent);

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
        ? await this.renewalChargeService.getRentOwnPeriodChargeAmount(rent.id)
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
      const existing = await this.renewalInvoiceRepository.findOne({
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
          // *this same invoice's period* (accept-after-expiry flow in
          // RenewalChargeService, fired by processAcceptedLetterCharges
          // once expiry is reached). That debit is already represented in the
          // breakdown, so counting it again as wallet debt would inflate
          // total_amount to 2× the period. Add the own-letter charge back
          // before applying the formula so only *prior* arrears reduce credit.
          // Mirrors TenanciesService.refreshInvoiceTotals.
          const ownLetterCharge =
            await this.renewalChargeService.getLetterAcceptedChargeAmount(
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
            ? await this.renewalChargeService.getRentOwnPeriodChargeAmount(
                rent.id,
              )
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
        // (see sendRenewalReminder branching below). After this flip the
        // tenant URL transitions from preview-only to Accept/Decline.
        if (existing.letter_status === RenewalLetterStatus.DRAFT) {
          existing.letter_status = RenewalLetterStatus.SENT;
          existing.letter_sent_at = new Date();
          existing.token_type = 'landlord';
        }

        await this.renewalInvoiceRepository.save(existing);
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
      const renewalInvoice = this.renewalInvoiceRepository.create({
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

      await this.renewalInvoiceRepository.save(renewalInvoice);
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
   * Roll a rent's fee set forward into the next period:
   *   - recurring fees survive unchanged (amount + flag)
   *   - non-recurring fees (caution/legal/agency/one-time otherFees) zero out
   *
   * We can't just spread the old rent because the Rent entity uses flat
   * columns; the helper produces a typed struct the caller can assign.
   */
  private carryForwardFees(rent: Rent): CarriedRentColumns {
    return carryForwardRentColumns(rent);
  }

  // ---------------------------------------------------------------------------
  // Period range / paid-period guard
  // ---------------------------------------------------------------------------

  /**
   * Period the next renewal invoice for this rent should cover.
   * OWING → current (unpaid) period; otherwise → next period after expiry.
   * Mirrors the branch used by findOrCreateRenewalInvoice.
   */
  private getTargetPeriodRange(rent: Rent): {
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
   * True if a PAID renewal invoice already exists for the period a
   * renewal-link reminder would cover. Used to suppress reminders whose
   * link would resolve to an already-paid invoice.
   */
  private async isTargetPeriodPaid(rent: Rent): Promise<boolean> {
    const propertyTenant = await this.propertyTenantRepository.findOne({
      where: {
        property_id: rent.property_id,
        tenant_id: rent.tenant_id,
        status: TenantStatusEnum.ACTIVE,
      },
    });
    if (!propertyTenant) return false;

    const { startDate } = this.getTargetPeriodRange(rent);
    const paid = await this.renewalInvoiceRepository.findOne({
      where: {
        property_tenant_id: propertyTenant.id,
        start_date: startDate,
        payment_status: RenewalPaymentStatus.PAID,
      },
    });
    return !!paid;
  }

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  private async logReminderSent(
    rent: Rent,
    formattedAmount: string,
    expiryDateStr: string,
    daysUntilExpiry: number,
  ) {
    const tenantName = rent.tenant.user.first_name;
    const propertyName = rent.property.name;

    try {
      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.RENT_REMINDER,
        description: `Rent reminder sent to ${tenantName} for ${propertyName}. ${formattedAmount} due on ${expiryDateStr}.`,
        status: 'Completed',
        property_id: rent.property_id,
        user_id: rent.property.owner_id,
      });

      await this.propertyHistoryRepository.save(
        this.propertyHistoryRepository.create({
          property_id: rent.property_id,
          tenant_id: rent.tenant_id,
          event_type: 'rent_reminder_sent',
          event_description:
            daysUntilExpiry >= 0
              ? `Rent reminder sent to ${tenantName}. ${formattedAmount} due in ${daysUntilExpiry} days (${expiryDateStr}).`
              : `Rent reminder sent to ${tenantName}. ${formattedAmount} overdue by ${Math.abs(daysUntilExpiry)} days (was due ${expiryDateStr}).`,
          related_entity_id: rent.id,
          related_entity_type: 'rent',
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to log rent reminder for rent ${rent.id}`,
        error,
      );
    }
  }
}

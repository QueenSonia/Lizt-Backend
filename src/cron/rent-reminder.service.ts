import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
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
import { TenantStatusEnum } from '../properties/dto/create-property.dto';
import { TenantBalancesService } from '../tenant-balances/tenant-balances.service';
import { TenantBalanceLedgerType } from '../tenant-balances/entities/tenant-balance-ledger.entity';
import {
  rentToFees,
  renewalInvoiceToFees,
  sumRecurring,
  sumAll,
  Fee,
} from '../common/billing/fees';
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
    @InjectRepository(PaymentPlanInstallment)
    private readonly installmentRepository: Repository<PaymentPlanInstallment>,
    private readonly whatsAppNotificationLogService: WhatsAppNotificationLogService,
    private readonly notificationService: NotificationService,
    private readonly tenantBalancesService: TenantBalancesService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: 'Africa/Lagos' })
  async runDailyReminderCheck() {
    this.logger.log('Starting daily rent reminder check...');
    try {
      await this.processAutoRenewal();
      await this.processUpcomingReminders();
      await this.processPostExpiryReminders();
      await this.checkInstallmentReminders();
      this.logger.log('Completed daily rent reminder check.');
    } catch (error) {
      this.logger.error('Failed to process daily rent reminders', error);
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
  private async processAutoRenewal() {
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
   *   - sent     → flip to accepted + auto_renewed_at, then roll forward.
   *   - accepted / none → roll forward as today (no-op on the letter).
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

    if (propertyTenant) {
      const latestLetter = await this.renewalInvoiceRepository.findOne({
        where: {
          property_tenant_id: propertyTenant.id,
          superseded_by_id: IsNull(),
        },
        order: { created_at: 'DESC' },
      });

      if (latestLetter?.letter_status === RenewalLetterStatus.DECLINED) {
        await this.handleDeclinedRenewalAtExpiry(
          rent,
          propertyTenant,
          latestLetter,
          today,
        );
        return;
      }

      if (latestLetter?.letter_status === RenewalLetterStatus.SENT) {
        // Tenant didn't accept by expiry — auto-stamp the letter so the
        // payment-page gate lets them pay the new period's invoice and
        // the tenant page can render the AUTO-RENEWED stamp.
        latestLetter.letter_status = RenewalLetterStatus.ACCEPTED;
        latestLetter.auto_renewed_at = new Date();
        await this.renewalInvoiceRepository.save(latestLetter);
        this.logger.log(
          `Auto-renewed letter ${latestLetter.id} (sent → accepted) at expiry of rent ${rent.id}.`,
        );
      }

      // The SENT branch above always mutates to ACCEPTED, so by this point
      // the only statuses that can flow through are DRAFT and ACCEPTED. We
      // honor only ACCEPTED — DRAFT means the landlord hasn't shared the
      // figures with the tenant yet, so the cron shouldn't surprise them.
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

    while (currentExpiry < today) {
      const useLetter = !!letterSource && !letterConsumed;

      // When honoring a letter, take its dates verbatim — including any gap
      // the landlord set between the old expiry and the new start. Otherwise
      // fall back to the cron's frequency-computed default of expiry+1.
      let nextStart: Date;
      let nextExpiry: Date;
      if (useLetter && letterSource) {
        nextStart = new Date(letterSource.start_date);
        nextExpiry = new Date(letterSource.end_date);
      } else {
        nextStart = new Date(currentExpiry);
        nextStart.setDate(nextStart.getDate() + 1);
        nextExpiry = advanceRentPeriod(currentExpiry, currentRent);
      }

      // Atomically mark the current period inactive only if still ACTIVE.
      // If another cron instance already processed this rent, the update
      // affects 0 rows and we skip — this prevents double-renewal.
      const updateResult = await this.rentRepository.update(
        { id: currentRent.id, rent_status: RentStatusEnum.ACTIVE },
        { rent_status: RentStatusEnum.INACTIVE },
      );
      if (updateResult.affected === 0) {
        this.logger.warn(
          `Rent ${currentRent.id} already processed by another instance, skipping.`,
        );
        return;
      }
      currentRent.rent_status = RentStatusEnum.INACTIVE;

      // Billing v2: the period charge is the sum of every recurring fee
      // for the new period. When using the letter, that's the snapshot the
      // landlord saved (renewalInvoiceToFees prefers fee_breakdown when
      // present, falling back to the scalar columns). Otherwise it's the
      // current rent's recurring fees, carried forward.
      let recurringFees: Fee[];
      let periodCharge: number;
      if (useLetter && letterSource) {
        const letterFees = renewalInvoiceToFees(letterSource);
        recurringFees = letterFees.filter((f) => f.recurring);
        periodCharge = sumRecurring(letterFees);
      } else {
        const currentFees = rentToFees(currentRent);
        recurringFees = currentFees.filter((f) => f.recurring);
        periodCharge = sumRecurring(currentFees);
      }

      // The expiring period's charge is already on the wallet — it was
      // posted either as INITIAL_BALANCE when the first rent was created
      // (tenant-management) or as new_period when the prior cron tick
      // created this rent. Re-billing it here would double-charge.

      // Carry recurring fees forward as a fallback for any field the letter
      // doesn't carry; non-recurring fees drop out (move-in one-timers).
      const carried = this.carryForwardFees(currentRent);

      // Create the new rent up-front (tentatively OWING) so the new_period
      // ledger entries can be tied to newRent.id. That link is what lets
      // the next cron run skip a double-charge for this same period.
      // When useLetter is true, money fields source from the letter using
      // null-safe checks (not `||`) so a deliberate 0 — landlord removing a
      // fee at renewal — overwrites the previous value instead of falling
      // back to the carried-forward amount.
      const newRent = this.rentRepository.create({
        property_id: currentRent.property_id,
        tenant_id: currentRent.tenant_id,
        rent_start_date: nextStart,
        expiry_date: nextExpiry,
        rental_price:
          useLetter && letterSource
            ? Number(letterSource.rent_amount)
            : currentRent.rental_price,
        security_deposit: carried.security_deposit,
        security_deposit_recurring: carried.security_deposit_recurring,
        service_charge:
          useLetter && letterSource && letterSource.service_charge != null
            ? Number(letterSource.service_charge)
            : carried.service_charge,
        service_charge_recurring: carried.service_charge_recurring,
        legal_fee:
          useLetter && letterSource && letterSource.legal_fee != null
            ? Number(letterSource.legal_fee)
            : carried.legal_fee,
        legal_fee_recurring: carried.legal_fee_recurring,
        agency_fee:
          useLetter && letterSource && letterSource.agency_fee != null
            ? Number(letterSource.agency_fee)
            : carried.agency_fee,
        agency_fee_recurring: carried.agency_fee_recurring,
        other_fees:
          useLetter && letterSource
            ? letterSource.other_fees ?? carried.other_fees
            : carried.other_fees,
        payment_frequency:
          useLetter && letterSource
            ? letterSource.payment_frequency || currentRent.payment_frequency
            : currentRent.payment_frequency,
        payment_status: RentPaymentStatusEnum.OWING,
        rent_status: RentStatusEnum.ACTIVE,
        amount_paid: 0,
      });
      await this.rentRepository.save(newRent);
      if (useLetter) letterConsumed = true;

      // Apply the new period charge, tying it to the new rent so a later
      // renewal of this rent will see it's already been billed.
      for (const fee of recurringFees) {
        await this.tenantBalancesService.applyChange(
          currentRent.tenant_id,
          currentRent.property.owner_id,
          -fee.amount,
          {
            type: TenantBalanceLedgerType.AUTO_RENEWAL,
            description: `New period charged: ${nextStart.toISOString().split('T')[0]} – ${nextExpiry.toISOString().split('T')[0]} — ${fee.label}`,
            propertyId: currentRent.property_id,
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

      const walletAfterCharge = await this.tenantBalancesService.getBalance(
        currentRent.tenant_id,
        currentRent.property.owner_id,
      );

      // Wallet covers the new period (balance still >= 0) → mark paid silently
      const coveredByWallet = walletAfterCharge >= 0;
      if (coveredByWallet) {
        newRent.payment_status = RentPaymentStatusEnum.PAID;
        newRent.amount_paid = periodCharge;
        await this.rentRepository.save(newRent);

        // Also settle the linked renewal_invoice if we sourced from one this
        // iteration. Without this, the rent says PAID but the invoice stays
        // UNPAID, leaving the tenant a "phantom payable" they could pay via
        // the invoice token — which would route through markInvoiceAsPaid's
        // ELSE branch (PAID + ACTIVE rent) and create a duplicate rent row
        // for the same period. Don't post a corresponding ledger entry —
        // the period-charge debit above already accounts for the wallet
        // movement; this is just bookkeeping on the invoice side.
        if (useLetter && letterSource &&
            letterSource.payment_status !== RenewalPaymentStatus.PAID) {
          letterSource.payment_status = RenewalPaymentStatus.PAID;
          letterSource.amount_paid = periodCharge;
          letterSource.paid_at = new Date();
          letterSource.payment_reference = 'wallet_credit';
          await this.renewalInvoiceRepository.save(letterSource);
          this.logger.log(
            `Renewal invoice ${letterSource.id} marked PAID via wallet credit at auto-renewal of rent ${currentRent.id}.`,
          );
        }
      }

      this.logger.log(
        `Auto-renewed rent ${currentRent.id} → new rent ${newRent.id} ` +
          `(${nextStart.toISOString().split('T')[0]} – ${nextExpiry.toISOString().split('T')[0]}) ` +
          (coveredByWallet ? 'PAID by wallet' : 'OWING'),
      );

      currentRent = newRent;
      currentExpiry = new Date(nextExpiry);
      currentExpiry.setUTCHours(0, 0, 0, 0);
    }
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
  // Upcoming reminders (before expiry)
  // ---------------------------------------------------------------------------

  private async processUpcomingReminders() {
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
   * Sends the overdue reminder on day 1 and day 7 after auto-renewal,
   * if the tenant still hasn't paid (payment_status = OWING).
   */
  private async processPostExpiryReminders() {
    this.logger.log('Processing post-expiry rent reminders...');

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const todayStr = today.toISOString().split('T')[0];
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
      .andWhere('rent.payment_status = :paymentStatus', {
        paymentStatus: RentPaymentStatusEnum.OWING,
      })
      .andWhere('DATE(rent.rent_start_date) IN (:...startDates)', {
        startDates: [todayStr, sevenDaysAgoStr],
      })
      .getMany();

    this.logger.log(
      `Found ${rents.length} newly-renewed owing rents to remind.`,
    );

    for (const rent of rents) {
      try {
        const rentStart = new Date(rent.rent_start_date);
        rentStart.setUTCHours(0, 0, 0, 0);
        const daysAfterRenewal = Math.floor(
          (today.getTime() - rentStart.getTime()) / (1000 * 60 * 60 * 24),
        );
        await this.sendReminderIfNotSent(rent, -daysAfterRenewal);
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

    // Source from the renewal invoice — `rent` here is the EXPIRING period,
    // so its rental_price / expiry_date are the OLD terms. The invoice
    // carries the next period's figures (letter values when the landlord
    // sent one, otherwise the auto-create snapshot).
    const expiryDateStr = new Date(renewalInvoice.end_date).toLocaleDateString(
      'en-GB',
    );
    const amountToPay =
      Number(renewalInvoice.rent_amount || 0) +
      Number(renewalInvoice.service_charge || 0);
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
    const useLetterTemplate = letterStatus === RenewalLetterStatus.SENT;
    const templateName = useLetterTemplate
      ? 'sendRenewalLetterLink'
      : 'sendRentReminderWithRenewalTemplate';

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
      // Resolve the landlord's display name. Fall back to a generic label
      // if anything is missing — better than failing the WhatsApp send.
      const landlordName =
        rent.property?.owner?.profile_name ||
        `${rent.property?.owner?.user?.first_name ?? ''} ${rent.property?.owner?.user?.last_name ?? ''}`.trim() ||
        'Your Landlord';

      await this.whatsAppNotificationLogService.queue(
        'sendRenewalLetterLink',
        {
          phone_number: rent.tenant.user.phone_number,
          tenant_name: rent.tenant.user.first_name,
          property_name: rent.property.name,
          landlord_name: landlordName,
          renewal_token: renewalInvoice.token,
        },
        rent.id,
      );

      this.logger.log(
        `Queued renewal letter reminder for rent ${rent.id} (${daysUntilExpiry} days before expiry).`,
      );
    } else {
      await this.whatsAppNotificationLogService.queue(
        'sendRentReminderWithRenewalTemplate',
        {
          phone_number: rent.tenant.user.phone_number,
          tenant_name: rent.tenant.user.first_name,
          property_name: rent.property.name,
          rent_amount: formattedAmount,
          expiry_date: expiryDateStr,
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

  private async sendOverdueReminder(rent: Rent, daysBefore: number) {
    const templateName = 'rent_overdue_with_renewal';

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

    const baseAmount = rent.rental_price ?? rent.amount_paid ?? 0;
    const amountToPay = baseAmount + (rent.service_charge || 0);
    const formattedAmount = amountToPay.toLocaleString('en-NG', {
      style: 'currency',
      currency: 'NGN',
    });

    const startDateStr = new Date(rent.rent_start_date).toLocaleDateString(
      'en-GB',
    );
    const endDateStr = new Date(rent.expiry_date).toLocaleDateString('en-GB');
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

      // Billing v2: snapshot the full Fee[] from the rent — every fee the
      // landlord set in Edit Tenancy goes into `fee_breakdown`, recurring or
      // not. The invoice total is the sum of all of them (minus wallet).
      // The recurring flag is only consulted by the auto-renewal ledger
      // charging path (above), not by this invoice snapshot.
      const fees: Fee[] = rentToFees(rent);
      const periodCharge = sumAll(fees);
      const rentAmount = rent.rental_price ?? rent.amount_paid ?? 0;
      const serviceCharge = rent.service_charge || 0;
      const legalFee = Number(rent.legal_fee || 0);
      const agencyFee = Number(rent.agency_fee || 0);
      const cautionDeposit = Number(rent.security_deposit || 0);
      const allOtherFees = rent.other_fees ?? [];

      const walletBalance = await this.tenantBalancesService.getBalance(
        rent.tenant_id,
        landlordId,
      );
      // outstanding_balance kept for invoice compat (positive = owed)
      const outstandingBalance = walletBalance < 0 ? -walletBalance : 0;
      const totalAmount = Math.max(0, periodCharge - walletBalance);
      const paymentFrequency = rent.payment_frequency || 'monthly';

      const { startDate, endDate } = this.getTargetPeriodRange(rent);

      // Refresh existing unpaid landlord/draft invoice if one exists.
      // Exclude superseded rows — those are historical versions replaced
      // by a newer letter and should never be touched by the refresh cron.
      // We include token_type='draft' so the cron can promote a landlord-
      // saved draft into a sent letter when reminders begin.
      const existing = await this.renewalInvoiceRepository.findOne({
        where: {
          property_tenant_id: propertyTenant.id,
          payment_status: RenewalPaymentStatus.UNPAID,
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
        const breakdown: Fee[] = Array.isArray(existing.fee_breakdown)
          ? existing.fee_breakdown
          : [];
        const invoicePeriodCharge = sumAll(breakdown);
        existing.wallet_balance = walletBalance;
        existing.outstanding_balance = outstandingBalance;
        existing.total_amount = Math.max(0, invoicePeriodCharge - walletBalance);

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
      // boilerplate driven by the current structured fields). If the
      // tenant doesn't accept by expiry, processOverdueRents flips this
      // to 'accepted' + sets auto_renewed_at.
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
  private carryForwardFees(rent: Rent): {
    security_deposit: number;
    security_deposit_recurring: boolean;
    service_charge: number;
    service_charge_recurring: boolean;
    legal_fee: number | null;
    legal_fee_recurring: boolean;
    agency_fee: number | null;
    agency_fee_recurring: boolean;
    other_fees: Array<{
      externalId: string;
      name: string;
      amount: number;
      recurring: boolean;
    }>;
  } {
    return {
      service_charge: rent.service_charge_recurring
        ? rent.service_charge || 0
        : 0,
      service_charge_recurring: !!rent.service_charge_recurring,
      security_deposit: rent.security_deposit_recurring
        ? rent.security_deposit || 0
        : 0,
      security_deposit_recurring: !!rent.security_deposit_recurring,
      legal_fee: rent.legal_fee_recurring ? rent.legal_fee : null,
      legal_fee_recurring: !!rent.legal_fee_recurring,
      agency_fee: rent.agency_fee_recurring ? rent.agency_fee : null,
      agency_fee_recurring: !!rent.agency_fee_recurring,
      other_fees: (rent.other_fees ?? []).filter((f) => f.recurring),
    };
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

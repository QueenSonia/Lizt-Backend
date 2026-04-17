import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Rent } from '../rents/entities/rent.entity';
import {
  RentPaymentStatusEnum,
  RentStatusEnum,
} from '../rents/dto/create-rent.dto';
import { WhatsAppNotificationLogService } from '../whatsapp-bot/whatsapp-notification-log.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/enums/notification-type';
import { PropertyHistory } from '../property-history/entities/property-history.entity';
import {
  RenewalInvoice,
  RenewalPaymentStatus,
} from '../tenancies/entities/renewal-invoice.entity';
import { PropertyTenant } from '../properties/entities/property-tenants.entity';
import { TenantStatusEnum } from '../properties/dto/create-property.dto';
import { TenantBalancesService } from '../tenant-balances/tenant-balances.service';
import { TenantBalanceLedgerType } from '../tenant-balances/entities/tenant-balance-ledger.entity';
import { rentToFees, sumRecurring, Fee } from '../common/billing/fees';

const RENT_REMINDER_SCHEDULE = {
  monthly: [14, 7, 2, 1, 0],
  quarterly: [30, 14, 7, 2, 1, 0],
  'bi-annually': [90, 60, 30, 14, 7, 2, 1, 0],
  biannually: [90, 60, 30, 14, 7, 2, 1, 0],
  annually: [180, 90, 60, 30, 14, 7, 2, 1, 0],
};

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
      this.logger.log('Completed daily rent reminder check.');
    } catch (error) {
      this.logger.error('Failed to process daily rent reminders', error);
    }
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
   */
  private async autoRenewExpiredRent(rent: Rent, today: Date): Promise<void> {
    const frequency = (rent.payment_frequency || 'monthly').toLowerCase();

    let currentRent = rent;
    let currentExpiry = new Date(rent.expiry_date);
    currentExpiry.setUTCHours(0, 0, 0, 0);

    while (currentExpiry < today) {
      const nextStart = new Date(currentExpiry);
      nextStart.setDate(nextStart.getDate() + 1);
      const nextExpiry = this.advanceDateByOnePeriod(currentExpiry, frequency);

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
      // on the rent (rent + service + any legal/agency/otherFees the
      // landlord flagged `recurring=true`). Non-recurring fees were
      // collected once at move-in and must not re-bill each renewal.
      const currentFees = rentToFees(currentRent);
      const recurringFees = currentFees.filter((f) => f.recurring);
      const periodCharge = sumRecurring(currentFees);

      // If the expiring period was unpaid, charge it to the wallet now
      const wasUnpaid =
        currentRent.payment_status !== RentPaymentStatusEnum.PAID;

      if (wasUnpaid) {
        for (const fee of recurringFees) {
          await this.tenantBalancesService.applyChange(
            currentRent.tenant_id,
            currentRent.property.owner_id,
            -fee.amount,
            {
              type: TenantBalanceLedgerType.AUTO_RENEWAL,
              description: `Unpaid period charged: ${currentExpiry.toLocaleDateString('en-GB')} — ${fee.label}`,
              propertyId: currentRent.property_id,
              relatedEntityType: 'rent',
              relatedEntityId: currentRent.id,
              metadata: {
                kind: 'unpaid_period',
                fee_kind: fee.kind,
                ...(fee.externalId ? { externalId: fee.externalId } : {}),
              },
            },
          );
        }
      }

      // Apply the new period charge and check if wallet covers it
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

      // Carry recurring fees forward unchanged; non-recurring fees drop out
      // of the next period (they were move-in one-timers).
      const carried = this.carryForwardFees(currentRent);

      const newRent = this.rentRepository.create({
        property_id: currentRent.property_id,
        tenant_id: currentRent.tenant_id,
        rent_start_date: nextStart,
        expiry_date: nextExpiry,
        rental_price: currentRent.rental_price,
        security_deposit: carried.security_deposit,
        security_deposit_recurring: carried.security_deposit_recurring,
        service_charge: carried.service_charge,
        service_charge_recurring: carried.service_charge_recurring,
        legal_fee: carried.legal_fee,
        legal_fee_recurring: carried.legal_fee_recurring,
        agency_fee: carried.agency_fee,
        agency_fee_recurring: carried.agency_fee_recurring,
        other_fees: carried.other_fees,
        payment_frequency: currentRent.payment_frequency,
        payment_status: coveredByWallet
          ? RentPaymentStatusEnum.PAID
          : RentPaymentStatusEnum.OWING,
        rent_status: RentStatusEnum.ACTIVE,
        amount_paid: coveredByWallet ? periodCharge : 0,
      });
      await this.rentRepository.save(newRent);

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

        const frequency = (rent.payment_frequency || 'monthly').toLowerCase();
        const schedule =
          RENT_REMINDER_SCHEDULE[frequency] || RENT_REMINDER_SCHEDULE.monthly;

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

    const useRenewalTemplate = daysUntilExpiry <= 7;
    const templateName = useRenewalTemplate
      ? 'sendRentReminderWithRenewalTemplate'
      : 'sendRentReminderTemplate';

    const alreadySent =
      await this.whatsAppNotificationLogService.existsForDaysBeforeExpiry(
        rent.id,
        templateName,
        daysUntilExpiry,
      );

    if (alreadySent) {
      this.logger.debug(
        `Rent reminder already sent for rent ${rent.id} at ${daysUntilExpiry} days.`,
      );
      return;
    }

    const expiryDateStr = new Date(rent.expiry_date).toLocaleDateString(
      'en-GB',
    );
    const baseAmount = rent.rental_price ?? rent.amount_paid ?? 0;
    const amountToPay = baseAmount + (rent.service_charge || 0);
    const formattedAmount = amountToPay.toLocaleString('en-NG', {
      style: 'currency',
      currency: 'NGN',
    });

    if (useRenewalTemplate) {
      const renewalInvoice = await this.findOrCreateRenewalInvoice(rent);
      if (!renewalInvoice) {
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

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
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
        `Queued rent reminder with renewal link for rent ${rent.id} (${daysUntilExpiry} days before expiry).`,
      );
    } else {
      await this.queueStandardReminder(
        rent,
        formattedAmount,
        expiryDateStr,
        daysUntilExpiry,
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

      // Billing v2: snapshot the full Fee[] from the rent, then compute the
      // period charge (rent + every recurring fee) via the shared helper. The
      // snapshot is persisted on the invoice so the tenant-facing renderer
      // sees the exact fee set the landlord had configured at bill time.
      const fees: Fee[] = rentToFees(rent);
      const recurringFees = fees.filter((f) => f.recurring);
      const periodCharge = sumRecurring(fees);
      const rentAmount = rent.rental_price ?? rent.amount_paid ?? 0;
      const serviceCharge = rent.service_charge || 0;
      const legalFee = Number(rent.legal_fee || 0);
      const agencyFee = Number(rent.agency_fee || 0);
      const cautionDeposit = Number(rent.security_deposit || 0);
      const recurringOtherFees = (rent.other_fees ?? []).filter(
        (f) => f.recurring,
      );

      const walletBalance = await this.tenantBalancesService.getBalance(
        rent.tenant_id,
        landlordId,
      );
      // outstanding_balance kept for invoice compat (positive = owed)
      const outstandingBalance = walletBalance < 0 ? -walletBalance : 0;
      const totalAmount = Math.max(0, periodCharge - walletBalance);
      const paymentFrequency = rent.payment_frequency || 'monthly';

      // Determine invoice period dates
      let startDate: Date;
      let endDate: Date;

      if (rent.payment_status === RentPaymentStatusEnum.OWING) {
        // Current period — tenant owes for this period
        startDate = new Date(rent.rent_start_date);
        endDate = new Date(rent.expiry_date);
      } else {
        // Pre-expiry — invoice is for the upcoming next period
        startDate = new Date(rent.expiry_date);
        startDate.setDate(startDate.getDate() + 1);
        endDate = this.advanceDateByOnePeriod(
          new Date(rent.expiry_date),
          paymentFrequency.toLowerCase(),
        );
      }

      // Refresh existing unpaid landlord invoice if one exists
      const existing = await this.renewalInvoiceRepository.findOne({
        where: {
          property_tenant_id: propertyTenant.id,
          payment_status: RenewalPaymentStatus.UNPAID,
          token_type: 'landlord',
        },
        order: { created_at: 'DESC' },
      });

      if (existing) {
        existing.outstanding_balance = outstandingBalance;
        existing.wallet_balance = walletBalance;
        existing.total_amount = totalAmount;
        existing.start_date = startDate;
        existing.end_date = endDate;
        // Refresh the fee snapshot — the underlying rent may have been
        // edited (new recurring flag, added otherFee) since last run.
        existing.rent_amount = rentAmount;
        existing.service_charge = serviceCharge;
        existing.legal_fee = legalFee;
        existing.agency_fee = agencyFee;
        existing.caution_deposit = cautionDeposit;
        existing.other_fees = recurringOtherFees;
        existing.fee_breakdown = recurringFees;
        await this.renewalInvoiceRepository.save(existing);
        return existing;
      }

      // Auto-create. fee_breakdown is the authoritative source for the
      // tenant-facing UI; legacy scalar columns are kept for back-compat
      // with the existing renewal PDF + API consumers.
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
        other_fees: recurringOtherFees,
        fee_breakdown: recurringFees,
        outstanding_balance: outstandingBalance,
        wallet_balance: walletBalance,
        total_amount: totalAmount,
        payment_status: RenewalPaymentStatus.UNPAID,
        payment_frequency: paymentFrequency,
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
  // Date math helper
  // ---------------------------------------------------------------------------

  /**
   * Advance a date by exactly one payment period, month-overflow safe.
   * E.g. Jan 31 + 1 month → Feb 28/29, not Mar 2/3.
   */
  private advanceDateByOnePeriod(date: Date, frequency: string): Date {
    const result = new Date(date);
    let monthsToAdd: number;

    switch (frequency) {
      case 'monthly':
        monthsToAdd = 1;
        break;
      case 'quarterly':
        monthsToAdd = 3;
        break;
      case 'bi-annually':
      case 'biannually':
        monthsToAdd = 6;
        break;
      case 'annually':
      default:
        monthsToAdd = 12;
        break;
    }

    const expectedMonth = (result.getMonth() + monthsToAdd) % 12;
    result.setMonth(result.getMonth() + monthsToAdd);
    // Handle month-end overflow
    if (result.getMonth() !== expectedMonth) {
      result.setDate(0);
    }

    return result;
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

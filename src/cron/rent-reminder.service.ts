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

const RENT_REMINDER_SCHEDULE = {
  monthly: [14],
  quarterly: [30, 14],
  'bi-annually': [45, 30, 14],
  biannually: [45, 30, 14],
  annually: [60, 30, 14],
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
      await this.processOwingReminders();
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

      // Mark the current period inactive
      currentRent.rent_status = RentStatusEnum.INACTIVE;
      await this.rentRepository.save(currentRent);

      // If the expiring period was unpaid, record it as outstanding balance
      const wasUnpaid =
        currentRent.payment_status !== RentPaymentStatusEnum.PAID;

      if (wasUnpaid) {
        const unpaidAmount =
          (currentRent.rental_price || 0) + (currentRent.service_charge || 0);
        if (unpaidAmount > 0) {
          await this.tenantBalancesService.addOutstandingBalance(
            currentRent.tenant_id,
            currentRent.property.owner_id,
            unpaidAmount,
            {
              type: TenantBalanceLedgerType.AUTO_RENEWAL,
              description: `Rent auto-renewed: unpaid period ${currentExpiry.toLocaleDateString('en-GB')} – ${currentExpiry.toLocaleDateString('en-GB')} added to outstanding balance`,
              propertyId: currentRent.property_id,
              relatedEntityType: 'rent',
              relatedEntityId: currentRent.id,
            },
          );
        }
      }

      // Create the new period as ACTIVE/OWING
      const newRent = this.rentRepository.create({
        property_id: currentRent.property_id,
        tenant_id: currentRent.tenant_id,
        rent_start_date: nextStart,
        expiry_date: nextExpiry,
        rental_price: currentRent.rental_price,
        security_deposit: currentRent.security_deposit,
        service_charge: currentRent.service_charge,
        payment_frequency: currentRent.payment_frequency,
        payment_status: RentPaymentStatusEnum.OWING,
        rent_status: RentStatusEnum.ACTIVE,
        amount_paid: 0,
      });
      await this.rentRepository.save(newRent);

      this.logger.log(
        `Auto-renewed rent ${currentRent.id} → new rent ${newRent.id} ` +
          `(${nextStart.toISOString().split('T')[0]} – ${nextExpiry.toISOString().split('T')[0]})` +
          (wasUnpaid ? ', OB updated' : ''),
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

    // Collect all valid reminder days across all frequencies
    const allReminderDays = new Set<number>();
    Object.values(RENT_REMINDER_SCHEDULE).forEach((days) => {
      days.forEach((day) => allReminderDays.add(day));
    });
    // Include last 7 days before expiry for daily renewal-link reminders
    for (let d = 0; d <= 7; d++) allReminderDays.add(d);

    const targetDates = Array.from(allReminderDays).map((d) => {
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

        if (!schedule.includes(daysUntilExpiry) && daysUntilExpiry > 7)
          continue;

        await this.sendReminderIfNotSent(rent, daysUntilExpiry);
      } catch (error) {
        this.logger.error(
          `Failed to process reminder for rent ${rent.id}`,
          error,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Owing reminders (after auto-renewal, tenant has unpaid current period)
  // ---------------------------------------------------------------------------

  /**
   * For every active OWING rent, send a daily renewal reminder with payment
   * link until the tenant pays.
   */
  private async processOwingReminders() {
    this.logger.log('Processing owing rent reminders...');

    const owingRents = await this.rentRepository
      .createQueryBuilder('rent')
      .leftJoinAndSelect('rent.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'user')
      .leftJoinAndSelect('rent.property', 'property')
      .where('rent.rent_status = :status', { status: RentStatusEnum.ACTIVE })
      .andWhere('rent.payment_status = :paymentStatus', {
        paymentStatus: RentPaymentStatusEnum.OWING,
      })
      .getMany();

    this.logger.log(`Found ${owingRents.length} owing rents to remind.`);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    for (const rent of owingRents) {
      try {
        if (!rent.tenant?.user?.phone_number || !rent.property?.name) continue;

        const activeTenant = await this.propertyTenantRepository.findOne({
          where: {
            property_id: rent.property_id,
            tenant_id: rent.tenant_id,
            status: TenantStatusEnum.ACTIVE,
          },
        });

        if (!activeTenant) {
          this.logger.debug(
            `Skipping owing reminder for rent ${rent.id}: tenant no longer attached.`,
          );
          continue;
        }

        const renewalInvoice = await this.findOrCreateRenewalInvoice(rent);
        if (!renewalInvoice) continue;

        const rentStart = new Date(rent.rent_start_date);
        const daysOverdue = Math.floor(
          (today.getTime() - rentStart.getTime()) / (1000 * 60 * 60 * 24),
        );

        await this.sendOwingRenewalReminder(rent, daysOverdue, renewalInvoice);
      } catch (error) {
        this.logger.error(
          `Failed to process owing reminder for rent ${rent.id}`,
          error,
        );
      }
    }
  }

  private async sendOwingRenewalReminder(
    rent: Rent,
    daysOwing: number,
    renewalInvoice: RenewalInvoice,
  ) {
    const templateName = 'sendRentReminderWithRenewalTemplate';

    const alreadySent =
      await this.whatsAppNotificationLogService.existsForDaysBeforeExpiry(
        rent.id,
        templateName,
        -daysOwing,
      );

    if (alreadySent) {
      this.logger.debug(
        `Owing reminder already sent today for rent ${rent.id}.`,
      );
      return;
    }

    const firstOwingRent = await this.rentRepository.findOne({
      where: {
        tenant_id: rent.tenant_id,
        property_id: rent.property_id,
        payment_status: RentPaymentStatusEnum.OWING,
      },
      order: { rent_start_date: 'ASC' },
    });
    const overdueFromDate =
      firstOwingRent?.rent_start_date ?? rent.rent_start_date;
    const expiryDateStr = new Date(overdueFromDate).toLocaleDateString('en-GB');

    const baseAmount = rent.rental_price ?? rent.amount_paid ?? 0;
    const amountToPay = baseAmount + (rent.service_charge || 0);
    const formattedAmount = amountToPay.toLocaleString('en-NG', {
      style: 'currency',
      currency: 'NGN',
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    await this.whatsAppNotificationLogService.queue(
      templateName,
      {
        phone_number: rent.tenant.user.phone_number,
        tenant_name: rent.tenant.user.first_name,
        property_name: rent.property.name,
        rent_amount: formattedAmount,
        expiry_date: expiryDateStr,
        renewal_token: renewalInvoice.token,
        frontend_url: frontendUrl,
        payment_frequency: rent.payment_frequency || 'Monthly',
        days_before_expiry: -daysOwing,
      },
      rent.id,
    );

    this.logger.log(
      `Queued owing renewal reminder for rent ${rent.id} (${daysOwing} days owing).`,
    );

    await this.logReminderSent(
      rent,
      formattedAmount,
      expiryDateStr,
      -daysOwing,
    );
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

      const rentAmount = rent.rental_price ?? rent.amount_paid ?? 0;
      const serviceCharge = rent.service_charge || 0;
      const landlordId = rent.property.owner_id;

      const outstandingBalance =
        await this.tenantBalancesService.getOutstandingBalance(
          rent.tenant_id,
          landlordId,
        );

      const totalAmount = rentAmount + serviceCharge + outstandingBalance;
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
        existing.total_amount =
          parseFloat(existing.rent_amount.toString()) +
          parseFloat(existing.service_charge.toString()) +
          outstandingBalance;
        existing.start_date = startDate;
        existing.end_date = endDate;
        await this.renewalInvoiceRepository.save(existing);
        return existing;
      }

      // Auto-create
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
        legal_fee: 0,
        other_charges: 0,
        outstanding_balance: outstandingBalance,
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

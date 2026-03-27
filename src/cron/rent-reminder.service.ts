import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Rent } from '../rents/entities/rent.entity';
import { RentStatusEnum } from '../rents/dto/create-rent.dto';
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
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: 'Africa/Lagos' })
  async runDailyReminderCheck() {
    this.logger.log('Starting daily rent reminder check...');
    try {
      await this.processUpcomingReminders();
      await this.processOverdueReminders();
      this.logger.log('Completed daily rent reminder check.');
    } catch (error) {
      this.logger.error('Failed to process daily rent reminders', error);
    }
  }

  private async processUpcomingReminders() {
    this.logger.log('Processing upcoming rent reminders...');
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Collect all valid reminder days across all frequencies
    const allReminderDays = new Set<number>();
    Object.values(RENT_REMINDER_SCHEDULE).forEach((days) => {
      days.forEach((day) => allReminderDays.add(day));
    });
    // Also include days 0-7 for daily reminders in the last 7 days
    for (let d = 0; d <= 7; d++) allReminderDays.add(d);

    // Determine target dates corresponding to those exact gaps
    const targetDates = Array.from(allReminderDays).map((d) => {
      const date = new Date(today);
      date.setUTCDate(today.getUTCDate() + d);
      return date.toISOString().split('T')[0]; // YYYY-MM-DD format
    });

    if (targetDates.length === 0) return;

    // Optimized DB Query: Fetch only rents expiring exactly on one of the target dates
    const rents = await this.rentRepository
      .createQueryBuilder('rent')
      .leftJoinAndSelect('rent.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'user')
      .leftJoinAndSelect('rent.property', 'property')
      .where('rent.rent_status = :status', { status: RentStatusEnum.ACTIVE })
      .andWhere('DATE(rent.expiry_date) IN (:...dates)', { dates: targetDates })
      .getMany();

    this.logger.log(
      `Found ${rents.length} potential upcoming rents to remind.`,
    );

    for (const rent of rents) {
      try {
        if (!rent.expiry_date) continue;

        const expiryDate = new Date(rent.expiry_date);
        expiryDate.setUTCHours(0, 0, 0, 0);

        const daysUntilExpiry = Math.floor(
          (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
        );

        // Normalize string (e.g. 'Bi-Annually' -> 'bi-annually')
        const frequency = (rent.payment_frequency || 'monthly').toLowerCase();
        const schedule =
          RENT_REMINDER_SCHEDULE[frequency] || RENT_REMINDER_SCHEDULE.monthly;

        // Send on scheduled days + every day for the last 7 days
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

  /**
   * Process overdue rents: keep sending daily renewal reminders
   * until payment is completed or tenant is no longer attached.
   */
  private async processOverdueReminders() {
    this.logger.log('Processing overdue rent reminders...');
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    // Fetch active rents whose expiry date has passed (cap at 90 days to avoid unbounded queries)
    const ninetyDaysAgo = new Date(today);
    ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90);
    const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().split('T')[0];

    const overdueRents = await this.rentRepository
      .createQueryBuilder('rent')
      .leftJoinAndSelect('rent.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'user')
      .leftJoinAndSelect('rent.property', 'property')
      .where('rent.rent_status = :status', { status: RentStatusEnum.ACTIVE })
      .andWhere('DATE(rent.expiry_date) < :today', { today: todayStr })
      .andWhere('DATE(rent.expiry_date) >= :cutoff', { cutoff: ninetyDaysAgoStr })
      .getMany();

    this.logger.log(
      `Found ${overdueRents.length} overdue rents to check.`,
    );

    for (const rent of overdueRents) {
      try {
        if (!rent.expiry_date) continue;
        if (!rent.tenant?.user?.phone_number || !rent.property?.name) continue;

        // Check if tenant is still actively attached
        const activeTenant = await this.propertyTenantRepository.findOne({
          where: {
            property_id: rent.property_id,
            tenant_id: rent.tenant_id,
            status: TenantStatusEnum.ACTIVE,
          },
        });

        if (!activeTenant) {
          this.logger.debug(
            `Skipping overdue reminder for rent ${rent.id}: tenant no longer attached.`,
          );
          continue;
        }

        // Check if renewal invoice is still unpaid
        const unpaidInvoice = await this.renewalInvoiceRepository.findOne({
          where: {
            property_tenant_id: activeTenant.id,
            payment_status: RenewalPaymentStatus.UNPAID,
          },
        });

        if (!unpaidInvoice) {
          this.logger.debug(
            `Skipping overdue reminder for rent ${rent.id}: renewal invoice already paid or not found.`,
          );
          continue;
        }

        const expiryDate = new Date(rent.expiry_date);
        expiryDate.setUTCHours(0, 0, 0, 0);
        const daysUntilExpiry = Math.floor(
          (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
        );

        await this.sendOverdueRenewalReminder(
          rent,
          daysUntilExpiry,
          unpaidInvoice,
        );
      } catch (error) {
        this.logger.error(
          `Failed to process overdue reminder for rent ${rent.id}`,
          error,
        );
      }
    }
  }

  private async sendOverdueRenewalReminder(
    rent: Rent,
    daysUntilExpiry: number,
    renewalInvoice: RenewalInvoice,
  ) {
    const templateName = 'sendRentReminderWithRenewalTemplate';

    const alreadySent =
      await this.whatsAppNotificationLogService.existsForDaysBeforeExpiry(
        rent.id,
        templateName,
        daysUntilExpiry,
      );

    if (alreadySent) {
      this.logger.debug(
        `Overdue reminder already sent for rent ${rent.id} at ${daysUntilExpiry} days.`,
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
        days_before_expiry: daysUntilExpiry,
      },
      rent.id,
    );

    this.logger.log(
      `Queued overdue renewal reminder for rent ${rent.id} (${Math.abs(daysUntilExpiry)} days overdue).`,
    );

    await this.logReminderSent(
      rent,
      formattedAmount,
      expiryDateStr,
      daysUntilExpiry,
    );
  }

  private async sendReminderIfNotSent(rent: Rent, daysUntilExpiry: number) {
    if (!rent.tenant?.user?.phone_number || !rent.property?.name) {
      this.logger.warn(
        `Skipping rent reminder for rent ${rent.id}: missing tenant phone number or property name`,
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
    ); // dd/mm/yyyy

    // Use rental_price if defined, fallback to amount_paid, plus service charge
    const baseAmount = rent.rental_price ?? rent.amount_paid ?? 0;
    const amountToPay = baseAmount + (rent.service_charge || 0);
    const formattedAmount = amountToPay.toLocaleString('en-NG', {
      style: 'currency',
      currency: 'NGN',
    });

    if (useRenewalTemplate) {
      // Find or create a renewal invoice for the last 7 days
      const renewalInvoice = await this.findOrCreateRenewalInvoice(rent);
      if (!renewalInvoice) {
        this.logger.warn(
          `Could not find or create renewal invoice for rent ${rent.id}, falling back to standard reminder.`,
        );
        // Fall back to standard reminder
        await this.queueStandardReminder(
          rent,
          formattedAmount,
          expiryDateStr,
          daysUntilExpiry,
        );
        // Still log the reminder even on fallback
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
          days_before_expiry: daysUntilExpiry,
        },
        rent.id,
      );

      this.logger.log(
        `Queued rent reminder WITH renewal link for rent ${rent.id} (${daysUntilExpiry} days before expiry).`,
      );
    } else {
      await this.queueStandardReminder(
        rent,
        formattedAmount,
        expiryDateStr,
        daysUntilExpiry,
      );
    }

    // Log to live feed and property/tenant history
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

  /**
   * Find an existing unpaid renewal invoice for this rent, or auto-create one
   * using the current rent terms.
   */
  private async findOrCreateRenewalInvoice(
    rent: Rent,
  ): Promise<RenewalInvoice | null> {
    try {
      // Find the PropertyTenant record
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

      // Check for existing unpaid renewal invoice
      const existing = await this.renewalInvoiceRepository.findOne({
        where: {
          property_tenant_id: propertyTenant.id,
          payment_status: RenewalPaymentStatus.UNPAID,
        },
        order: { created_at: 'DESC' },
      });

      if (existing) {
        this.logger.log(
          `Reusing existing renewal invoice ${existing.id} for rent ${rent.id}`,
        );
        return existing;
      }

      // Auto-create a renewal invoice using current rent terms
      const startDate = new Date(rent.expiry_date);
      startDate.setDate(startDate.getDate() + 1);

      const paymentFrequency = rent.payment_frequency || 'monthly';
      const endDate = new Date(startDate);
      switch (paymentFrequency.toLowerCase()) {
        case 'monthly':
          endDate.setMonth(endDate.getMonth() + 1);
          break;
        case 'quarterly':
          endDate.setMonth(endDate.getMonth() + 3);
          break;
        case 'bi-annually':
        case 'biannually':
          endDate.setMonth(endDate.getMonth() + 6);
          break;
        case 'annually':
        default:
          endDate.setFullYear(endDate.getFullYear() + 1);
          break;
      }
      endDate.setDate(endDate.getDate() - 1);

      const rentAmount = rent.rental_price ?? rent.amount_paid ?? 0;
      const serviceCharge = rent.service_charge || 0;
      const totalAmount = rentAmount + serviceCharge;

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

  private async logReminderSent(
    rent: Rent,
    formattedAmount: string,
    expiryDateStr: string,
    daysUntilExpiry: number,
  ) {
    const tenantName = rent.tenant.user.first_name;
    const propertyName = rent.property.name;

    try {
      // Live feed notification (for landlord)
      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.RENT_REMINDER,
        description: `Rent reminder sent to ${tenantName} for ${propertyName}. ${formattedAmount} due on ${expiryDateStr}.`,
        status: 'Completed',
        property_id: rent.property_id,
        user_id: rent.property.owner_id,
      });

      // Property & tenant history entry
      await this.propertyHistoryRepository.save(
        this.propertyHistoryRepository.create({
          property_id: rent.property_id,
          tenant_id: rent.tenant_id,
          event_type: 'rent_reminder_sent',
          event_description: daysUntilExpiry >= 0
            ? `Rent reminder sent to ${tenantName}. ${formattedAmount} due in ${daysUntilExpiry} days (${expiryDateStr}).`
            : `Rent reminder sent to ${tenantName}. ${formattedAmount} overdue by ${Math.abs(daysUntilExpiry)} days (was due ${expiryDateStr}).`,
          related_entity_id: rent.id,
          related_entity_type: 'rent',
        }),
      );
    } catch (error) {
      // Don't let logging failures break the reminder flow
      this.logger.error(
        `Failed to log rent reminder for rent ${rent.id}`,
        error,
      );
    }
  }
}

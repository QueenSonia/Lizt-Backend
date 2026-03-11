import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rent } from '../rents/entities/rent.entity';
import { RentStatusEnum } from '../rents/dto/create-rent.dto';
import { WhatsAppNotificationLogService } from '../whatsapp-bot/whatsapp-notification-log.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/enums/notification-type';
import { PropertyHistory } from '../property-history/entities/property-history.entity';

const RENT_REMINDER_SCHEDULE = {
  monthly: [14, 7, 3],
  quarterly: [30, 14, 7, 3],
  'bi-annually': [45, 30, 14, 7, 3],
  biannually: [45, 30, 14, 7, 3],
  annually: [60, 30, 14, 7, 3],
};

@Injectable()
export class RentReminderService {
  private readonly logger = new Logger(RentReminderService.name);

  constructor(
    @InjectRepository(Rent)
    private readonly rentRepository: Repository<Rent>,
    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepository: Repository<PropertyHistory>,
    private readonly whatsAppNotificationLogService: WhatsAppNotificationLogService,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron('* * * * *') // TODO: revert to CronExpression.EVERY_DAY_AT_8AM after testing
  async runDailyReminderCheck() {
    this.logger.log('Starting daily rent reminder check...');
    try {
      await this.processUpcomingReminders();
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
    // Also include days 0-2 for daily reminders in the last 3 days
    for (let d = 0; d <= 2; d++) allReminderDays.add(d);

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

        // Send on scheduled days + every day for the last 3 days
        if (!schedule.includes(daysUntilExpiry) && daysUntilExpiry > 3)
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

  private async sendReminderIfNotSent(rent: Rent, daysUntilExpiry: number) {
    if (!rent.tenant?.user?.phone_number || !rent.property?.name) {
      this.logger.warn(
        `Skipping rent reminder for rent ${rent.id}: missing tenant phone number or property name`,
      );
      return;
    }

    const alreadySent =
      await this.whatsAppNotificationLogService.existsForDaysBeforeExpiry(
        rent.id,
        'sendRentReminderTemplate',
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

    // Use rental_price if defined, fallback to amount_paid
    const amountToPay = rent.rental_price ?? rent.amount_paid ?? 0;
    const formattedAmount = amountToPay.toLocaleString('en-NG', {
      style: 'currency',
      currency: 'NGN',
    });

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

    // Log to live feed and property/tenant history
    await this.logReminderSent(
      rent,
      formattedAmount,
      expiryDateStr,
      daysUntilExpiry,
    );
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
          event_description: `Rent reminder sent to ${tenantName}. ${formattedAmount} due in ${daysUntilExpiry} days (${expiryDateStr}).`,
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

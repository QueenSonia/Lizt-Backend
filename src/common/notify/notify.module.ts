import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from 'src/users/entities/account.entity';
import { UtilsModule } from 'src/utils/utils.module';
import { NotificationRecipientsService } from './notification-recipients.service';

/**
 * Provides {@link NotificationRecipientsService} for redirecting
 * landlord-directed notifications to the managing admin (and, later,
 * category-subscribed landlords). Registers its own Account repository, so
 * consumers only need to import this module.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Account]), UtilsModule],
  providers: [NotificationRecipientsService],
  exports: [NotificationRecipientsService],
})
export class NotifyModule {}

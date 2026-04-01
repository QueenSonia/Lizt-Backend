import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenanciesController } from './tenancies.controller';
import { TenanciesService } from './tenancies.service';
import { RenewalPaymentService } from './renewal-payment.service';
import { RenewalPDFService } from './renewal-pdf.service';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Rent } from 'src/rents/entities/rent.entity';
import { Property } from 'src/properties/entities/property.entity';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { Users } from 'src/users/entities/user.entity';
import { RentIncrease } from 'src/rents/entities/rent-increase.entity';
import { RenewalInvoice } from './entities/renewal-invoice.entity';
import { UsersModule } from 'src/users/users.module';
import { AuthModule } from 'src/auth/auth.module';
import { WhatsappBotModule } from 'src/whatsapp-bot/whatsapp-bot.module';
import { UtilsModule } from 'src/utils/utils.module';
import { AppCacheModule } from 'src/lib/cache';
import { PaymentsModule } from 'src/payments/payments.module';
import { NotificationModule } from 'src/notifications/notification.module';
import { EventsModule } from 'src/events/events.module';
import { TenantBalancesModule } from 'src/tenant-balances/tenant-balances.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PropertyTenant,
      Rent,
      Property,
      PropertyHistory,
      Users,
      RentIncrease,
      RenewalInvoice,
    ]),
    UsersModule,
    AuthModule,
    WhatsappBotModule,
    UtilsModule,
    AppCacheModule,
    forwardRef(() => PaymentsModule),
    NotificationModule,
    EventsModule,
    TenantBalancesModule,
  ],
  controllers: [TenanciesController],
  providers: [
    TenanciesService,
    RenewalPaymentService,
    RenewalPDFService,
  ],
  exports: [
    TenanciesService,
    RenewalPaymentService,
    RenewalPDFService,
  ],
})
export class TenanciesModule { }

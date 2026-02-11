import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PaystackService } from './paystack.service';
import { PaystackLogger } from './paystack-logger.service';
import { PaymentService } from './payment.service';
import { WebhooksController } from './webhooks.controller';
import { PaymentsController } from './payments.controller';
import { Payment } from './entities/payment.entity';
import { PaymentLog } from './entities/payment-log.entity';
import { OfferLetter } from '../offer-letters/entities/offer-letter.entity';
import { Property } from '../properties/entities/property.entity';
import { Users } from '../users/entities/user.entity';
import { KYCApplication } from '../kyc-links/entities/kyc-application.entity';
import { KYCLinksModule } from '../kyc-links/kyc-links.module';
import { PropertyHistoryModule } from '../property-history/property-history.module';
import { WhatsappBotModule } from '../whatsapp-bot/whatsapp-bot.module';
import { AuthModule } from '../auth/auth.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { InvoicesModule } from '../invoices/invoices.module';
import { NotificationModule } from '../notifications/notification.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000, // 10 seconds timeout
      maxRedirects: 5,
    }),
    TypeOrmModule.forFeature([
      Payment,
      PaymentLog,
      OfferLetter,
      Property,
      Users,
      KYCApplication,
    ]),
    ConfigModule,
    AuthModule,
    KYCLinksModule,
    PropertyHistoryModule,
    forwardRef(() => WhatsappBotModule),
    forwardRef(() => InvoicesModule),
    NotificationModule,
    EventsModule,
    EventEmitterModule,
  ],
  controllers: [WebhooksController, PaymentsController],
  providers: [PaystackService, PaystackLogger, PaymentService],
  exports: [PaystackService, PaystackLogger, PaymentService],
})
export class PaymentsModule {}

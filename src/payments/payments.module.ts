import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PaystackService } from './paystack.service';
import { PaystackLogger } from './paystack-logger.service';
import { PaymentService } from './payment.service';
import { PaystackGateway } from './gateway/paystack.gateway';
import { MonnifyGateway } from './gateway/monnify.gateway';
import { GatewayRegistryService } from './gateway/gateway-registry.service';
import { ACTIVE_PAYMENT_GATEWAY } from './gateway/payment-gateway.interface';
import { WebhooksController } from './webhooks.controller';
import { PaymentsController } from './payments.controller';
import { Payment } from './entities/payment.entity';
import { PaymentLog } from './entities/payment-log.entity';
import { OfferLetter } from '../offer-letters/entities/offer-letter.entity';
import { Property } from '../properties/entities/property.entity';
import { Users } from '../users/entities/user.entity';
import { Account } from '../users/entities/account.entity';
import { KYCApplication } from '../kyc-links/entities/kyc-application.entity';
import { KYCLinksModule } from '../kyc-links/kyc-links.module';
import { PropertyHistoryModule } from '../property-history/property-history.module';
import { WhatsappBotModule } from '../whatsapp-bot/whatsapp-bot.module';
import { AuthModule } from '../auth/auth.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { InvoicesModule } from '../invoices/invoices.module';
import { NotificationModule } from '../notifications/notification.module';
import { EventsModule } from '../events/events.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { TenanciesModule } from '../tenancies/tenancies.module';
import { PaymentPlansModule } from '../payment-plans/payment-plans.module';
import { AdHocInvoicesModule } from '../ad-hoc-invoices/ad-hoc-invoices.module';
import { ScopeModule } from 'src/common/scope/scope.module';
import { NotifyModule } from 'src/common/notify/notify.module';
import { UtilsModule } from '../utils/utils.module';

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
      Account,
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
    forwardRef(() => ReceiptsModule),
    forwardRef(() => TenanciesModule),
    forwardRef(() => PaymentPlansModule),
    forwardRef(() => AdHocInvoicesModule),
    ScopeModule,
    NotifyModule,
    UtilsModule,
  ],
  controllers: [WebhooksController, PaymentsController],
  providers: [
    PaystackService,
    PaystackLogger,
    PaymentService,
    // Gateway abstraction — business services depend on these, never on a
    // concrete provider service.
    PaystackGateway,
    MonnifyGateway,
    GatewayRegistryService,
    {
      provide: ACTIVE_PAYMENT_GATEWAY,
      useFactory: (registry: GatewayRegistryService) => registry.active(),
      inject: [GatewayRegistryService],
    },
  ],
  exports: [
    PaystackService,
    PaystackLogger,
    PaymentService,
    PaystackGateway,
    MonnifyGateway,
    GatewayRegistryService,
    ACTIVE_PAYMENT_GATEWAY,
  ],
})
export class PaymentsModule {}

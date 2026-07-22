import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { KYCLinksService } from './kyc-links.service';
import { KYCApplicationService } from './kyc-application.service';
import { TenantAttachmentService } from './tenant-attachment.service';
import { KycPdfService } from './kyc-pdf.service';
import { KYCApplicationController } from './kyc-application.controller';
import { KYCLinksController } from './kyc-links.controller';
import { ReferralAgentController } from './referral-agent.controller';
import { ReferralAgentService } from './referral-agent.service';
import { KYCLink } from './entities/kyc-link.entity';
import { KYCApplication } from './entities/kyc-application.entity';
import { ReferralAgent } from './entities/referral-agent.entity';
import { KYCOtp } from './entities/kyc-otp.entity';
import { Property } from '../properties/entities/property.entity';
import { PropertyTenant } from '../properties/entities/property-tenants.entity';
import { PropertyHistory } from '../property-history/entities/property-history.entity';
import { OfferLetter } from '../offer-letters/entities/offer-letter.entity';
import { Payment } from '../payments/entities/payment.entity';
import { Rent } from '../rents/entities/rent.entity';
import { Account } from '../users/entities/account.entity';
import { Users } from '../users/entities/user.entity';
import { TenantKyc } from '../tenant-kyc/entities/tenant-kyc.entity';
import { WhatsAppNotificationLog } from '../whatsapp-bot/entities/whatsapp-notification-log.entity';
import { ChatLog } from '../whatsapp-bot/entities/chat-log.entity';
import { WhatsappBotModule } from '../whatsapp-bot/whatsapp-bot.module';
import { EventsModule } from '../events/events.module';
import { UtilsModule } from 'src/utils/utils.module';
import { NotificationModule } from '../notifications/notification.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { TenantBalancesModule } from '../tenant-balances/tenant-balances.module';
import { PropertyHistoryModule } from '../property-history/property-history.module';
import { ScopeModule } from 'src/common/scope/scope.module';
import { NotifyModule } from 'src/common/notify/notify.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KYCLink,
      KYCApplication,
      ReferralAgent,
      KYCOtp,
      Property,
      PropertyTenant,
      PropertyHistory,
      OfferLetter,
      Payment,
      Rent,
      Account,
      Users,
      TenantKyc,
      WhatsAppNotificationLog,
      ChatLog,
    ]),
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
    forwardRef(() => WhatsappBotModule),
    forwardRef(() => EventsModule),
    forwardRef(() => NotificationModule),
    UtilsModule,
    forwardRef(() => ReceiptsModule),
    TenantBalancesModule,
    PropertyHistoryModule,
    ScopeModule,
    NotifyModule,
  ],
  controllers: [
    KYCApplicationController,
    KYCLinksController,
    ReferralAgentController,
  ],
  providers: [
    KYCLinksService,
    KYCApplicationService,
    TenantAttachmentService,
    KycPdfService,
    ReferralAgentService,
  ],
  exports: [
    KYCLinksService,
    KYCApplicationService,
    TenantAttachmentService,
    ReferralAgentService,
  ],
})
export class KYCLinksModule {}

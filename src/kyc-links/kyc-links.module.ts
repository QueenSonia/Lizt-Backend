import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { KYCLinksService } from './kyc-links.service';
import { KYCApplicationService } from './kyc-application.service';
import { TenantAttachmentService } from './tenant-attachment.service';
import { KYCApplicationController } from './kyc-application.controller';
import { KYCLinksController } from './kyc-links.controller';
import { KYCLink } from './entities/kyc-link.entity';
import { KYCApplication } from './entities/kyc-application.entity';
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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KYCLink,
      KYCApplication,
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
  ],
  controllers: [KYCApplicationController, KYCLinksController],
  providers: [KYCLinksService, KYCApplicationService, TenantAttachmentService],
  exports: [KYCLinksService, KYCApplicationService, TenantAttachmentService],
})
export class KYCLinksModule {}

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
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
import { Rent } from '../rents/entities/rent.entity';
import { Account } from '../users/entities/account.entity';
import { Users } from '../users/entities/user.entity';
import { TenantKyc } from '../tenant-kyc/entities/tenant-kyc.entity';
import { WhatsappBotModule } from '../whatsapp-bot/whatsapp-bot.module';
import { EventsModule } from '../events/events.module';
import { UtilsModule } from 'src/utils/utils.module';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KYCLink,
      KYCApplication,
      KYCOtp,
      Property,
      PropertyTenant,
      PropertyHistory,
      Rent,
      Account,
      Users,
      TenantKyc,
    ]),
    ConfigModule,
    forwardRef(() => WhatsappBotModule),
    forwardRef(() => EventsModule),
    forwardRef(() => NotificationModule),
    UtilsModule,
  ],
  controllers: [KYCApplicationController, KYCLinksController],
  providers: [KYCLinksService, KYCApplicationService, TenantAttachmentService],
  exports: [KYCLinksService, KYCApplicationService, TenantAttachmentService],
})
export class KYCLinksModule {}

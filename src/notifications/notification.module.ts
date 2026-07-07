import { forwardRef, Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { PushSubscription } from './entities/push-subscription.entity';
import { PushNotificationService } from './push-notification.service';
import { NoticeAgreementListener } from './listeners/notice-agreement.listener';
import { UserAddedListener } from './listeners/user-added.listener';
import { PropertyListener } from './listeners/property-created.listener';
import { MaintenanceRequestListener } from './listeners/maintenance-request.listener';
import { UserSignUpListener } from './listeners/user-signup.listener';
import { TenantAttachmentListener } from './listeners/tenant-attachment.listener';
import { LandlordAddedListener } from './listeners/landlord-added.listener';
import { Property } from 'src/properties/entities/property.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import { WhatsappBotModule } from 'src/whatsapp-bot/whatsapp-bot.module';
import { UtilService } from 'src/utils/utility-service';
import { Account } from 'src/users/entities/account.entity';
import { ScopeModule } from 'src/common/scope/scope.module';
import { NotifyModule } from 'src/common/notify/notify.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      PushSubscription,
      Property,
      TeamMember,
      MaintenanceRequest,
      Account,
    ]),
    forwardRef(() => WhatsappBotModule),
    ScopeModule,
    NotifyModule,
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    PushNotificationService,
    NoticeAgreementListener,
    UserAddedListener,
    UserSignUpListener,
    PropertyListener,
    MaintenanceRequestListener,
    TenantAttachmentListener,
    LandlordAddedListener,
    UtilService,
  ],
  exports: [NotificationService, PushNotificationService],
})
export class NotificationModule {}

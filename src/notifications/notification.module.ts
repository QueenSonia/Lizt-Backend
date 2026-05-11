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
import { ServiceRequestListener } from './listeners/service-request.listener';
import { UserSignUpListener } from './listeners/user-signup.listener';
import { TenantAttachmentListener } from './listeners/tenant-attachment.listener';
import { Property } from 'src/properties/entities/property.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { WhatsappBotModule } from 'src/whatsapp-bot/whatsapp-bot.module';
import { UtilService } from 'src/utils/utility-service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      PushSubscription,
      Property,
      TeamMember,
    ]),
    forwardRef(() => WhatsappBotModule),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    PushNotificationService,
    NoticeAgreementListener,
    UserAddedListener,
    UserSignUpListener,
    PropertyListener,
    ServiceRequestListener,
    TenantAttachmentListener,
    UtilService,
  ],
  exports: [NotificationService, PushNotificationService],
})
export class NotificationModule { }

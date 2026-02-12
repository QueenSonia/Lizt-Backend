import { Module } from '@nestjs/common';
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

@Module({
  imports: [TypeOrmModule.forFeature([Notification, PushSubscription])],
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
  ],
  exports: [NotificationService, PushNotificationService],
})
export class NotificationModule { }

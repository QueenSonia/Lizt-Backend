import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { NoticeAgreementListener } from './listeners/notice-agreement.listener';
import { UserAddedListener } from './listeners/user-added.listener';
import { PropertyListener } from './listeners/property-created.listener';

@Module({
   imports: [
        TypeOrmModule.forFeature([Notification]),
   ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NoticeAgreementListener,
    UserAddedListener,
    PropertyListener
  ],
  exports: [NotificationService],
})
export class NotificationModule {}

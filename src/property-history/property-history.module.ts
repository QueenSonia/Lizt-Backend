import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PropertyHistoryService } from './property-history.service';
import { PropertyHistoryController } from './property-history.controller';
import { PropertyHistory } from './entities/property-history.entity';
import { NotificationModule } from '../notifications/notification.module';
import { EventsModule } from '../events/events.module';
import { Property } from '../properties/entities/property.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([PropertyHistory, Property]),
    NotificationModule,
    EventsModule,
  ],
  controllers: [PropertyHistoryController],
  providers: [PropertyHistoryService],
  exports: [PropertyHistoryService],
})
export class PropertyHistoryModule {}

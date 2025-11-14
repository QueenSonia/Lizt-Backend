import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventsGateway } from './events.gateway';
import { HistoryEventListener } from './history-event.listener';
import { PropertyHistory } from '../property-history/entities/property-history.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PropertyHistory])],
  providers: [EventsGateway, HistoryEventListener],
  exports: [EventsGateway],
})
export class EventsModule {}

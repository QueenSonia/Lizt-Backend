import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PropertyHistoryService } from './property-history.service';
import { PropertyHistoryController } from './property-history.controller';
import { PropertyHistory } from './entities/property-history.entity';
import { NotificationModule } from '../notifications/notification.module';
import { EventsModule } from '../events/events.module';
import { Property } from '../properties/entities/property.entity';
import { Rent } from '../rents/entities/rent.entity';
import { TenantBalancesModule } from 'src/tenant-balances/tenant-balances.module';
import { TenantBalanceLedger } from 'src/tenant-balances/entities/tenant-balance-ledger.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([PropertyHistory, Property, Rent, TenantBalanceLedger]),
    NotificationModule,
    EventsModule,
    TenantBalancesModule,
  ],
  controllers: [PropertyHistoryController],
  providers: [PropertyHistoryService],
  exports: [PropertyHistoryService],
})
export class PropertyHistoryModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PropertyHistoryService } from './property-history.service';
import { PaymentHistoryPdfService } from './payment-history-pdf.service';
import { PropertyHistoryController } from './property-history.controller';
import { PropertyHistory } from './entities/property-history.entity';
import { NotificationModule } from '../notifications/notification.module';
import { EventsModule } from '../events/events.module';
import { Property } from '../properties/entities/property.entity';
import { Rent } from '../rents/entities/rent.entity';
import { TenantBalancesModule } from 'src/tenant-balances/tenant-balances.module';
import { TenantBalanceLedger } from 'src/tenant-balances/entities/tenant-balance-ledger.entity';
import { KYCApplication } from '../kyc-links/entities/kyc-application.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PropertyHistory,
      Property,
      Rent,
      TenantBalanceLedger,
      KYCApplication,
    ]),
    NotificationModule,
    EventsModule,
    TenantBalancesModule,
  ],
  controllers: [PropertyHistoryController],
  providers: [PropertyHistoryService, PaymentHistoryPdfService],
  exports: [PropertyHistoryService, PaymentHistoryPdfService],
})
export class PropertyHistoryModule {}

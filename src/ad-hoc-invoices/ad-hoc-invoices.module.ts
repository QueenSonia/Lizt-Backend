import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdHocInvoice } from './entities/ad-hoc-invoice.entity';
import { AdHocInvoiceLineItem } from './entities/ad-hoc-invoice-line-item.entity';
import { AdHocInvoicesService } from './ad-hoc-invoices.service';
import { AdHocInvoicesController } from './ad-hoc-invoices.controller';
import { AdHocInvoicePdfService } from './ad-hoc-invoice-pdf.service';

import { PropertyTenant } from '../properties/entities/property-tenants.entity';
import { Property } from '../properties/entities/property.entity';
import { PropertyHistory } from '../property-history/entities/property-history.entity';

import { NotificationModule } from '../notifications/notification.module';
import { EventsModule } from '../events/events.module';
import { PaymentsModule } from '../payments/payments.module';
import { TenantBalancesModule } from '../tenant-balances/tenant-balances.module';
import { WhatsappBotModule } from '../whatsapp-bot/whatsapp-bot.module';
import { UtilService } from '../utils/utility-service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AdHocInvoice,
      AdHocInvoiceLineItem,
      PropertyTenant,
      Property,
      PropertyHistory,
    ]),
    NotificationModule,
    EventsModule,
    forwardRef(() => PaymentsModule),
    TenantBalancesModule,
    WhatsappBotModule,
  ],
  controllers: [AdHocInvoicesController],
  providers: [AdHocInvoicesService, AdHocInvoicePdfService, UtilService],
  exports: [AdHocInvoicesService, AdHocInvoicePdfService],
})
export class AdHocInvoicesModule {}

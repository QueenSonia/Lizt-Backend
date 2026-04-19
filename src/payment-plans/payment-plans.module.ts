import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PaymentPlan } from './entities/payment-plan.entity';
import { PaymentPlanInstallment } from './entities/payment-plan-installment.entity';
import { PaymentPlansService } from './payment-plans.service';
import { PaymentPlansController } from './payment-plans.controller';
import { InstallmentPDFService } from './installment-pdf.service';

import { RenewalInvoice } from '../tenancies/entities/renewal-invoice.entity';
import { PropertyTenant } from '../properties/entities/property-tenants.entity';
import { Property } from '../properties/entities/property.entity';
import { PropertyHistory } from '../property-history/entities/property-history.entity';

import { NotificationModule } from '../notifications/notification.module';
import { EventsModule } from '../events/events.module';
import { PaymentsModule } from '../payments/payments.module';
import { TenanciesModule } from '../tenancies/tenancies.module';
import { TenantBalancesModule } from '../tenant-balances/tenant-balances.module';
import { WhatsappBotModule } from '../whatsapp-bot/whatsapp-bot.module';
import { UtilService } from '../utils/utility-service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentPlan,
      PaymentPlanInstallment,
      RenewalInvoice,
      PropertyTenant,
      Property,
      PropertyHistory,
    ]),
    NotificationModule,
    EventsModule,
    forwardRef(() => PaymentsModule),
    forwardRef(() => TenanciesModule),
    TenantBalancesModule,
    WhatsappBotModule,
  ],
  controllers: [PaymentPlansController],
  providers: [PaymentPlansService, InstallmentPDFService, UtilService],
  exports: [PaymentPlansService, InstallmentPDFService],
})
export class PaymentPlansModule {}

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PaymentPlan } from './entities/payment-plan.entity';
import { PaymentPlanInstallment } from './entities/payment-plan-installment.entity';
import { PaymentPlanRequest } from './entities/payment-plan-request.entity';
import { PaymentPlanSource } from './entities/payment-plan-source.entity';
import { PaymentPlanAllocation } from './entities/payment-plan-allocation.entity';
import { AdHocInvoice } from '../ad-hoc-invoices/entities/ad-hoc-invoice.entity';
import { PaymentPlansService } from './payment-plans.service';
import { PaymentPlansController } from './payment-plans.controller';
import { PaymentPlanRequestsService } from './payment-plan-requests.service';
import { PaymentPlanRequestsController } from './payment-plan-requests.controller';
import { InstallmentPDFService } from './installment-pdf.service';

import { RenewalInvoice } from '../tenancies/entities/renewal-invoice.entity';
import { PropertyTenant } from '../properties/entities/property-tenants.entity';
import { Property } from '../properties/entities/property.entity';
import { PropertyHistory } from '../property-history/entities/property-history.entity';

import { AdHocInvoicesModule } from '../ad-hoc-invoices/ad-hoc-invoices.module';
import { NotificationModule } from '../notifications/notification.module';
import { EventsModule } from '../events/events.module';
import { PaymentsModule } from '../payments/payments.module';
import { TenanciesModule } from '../tenancies/tenancies.module';
import { TenantBalancesModule } from '../tenant-balances/tenant-balances.module';
import { RenewalChargeModule } from '../renewal-letters/renewal-charge.module';
import { WhatsappBotModule } from '../whatsapp-bot/whatsapp-bot.module';
import { UtilService } from '../utils/utility-service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentPlan,
      PaymentPlanInstallment,
      PaymentPlanRequest,
      PaymentPlanSource,
      PaymentPlanAllocation,
      AdHocInvoice,
      RenewalInvoice,
      PropertyTenant,
      Property,
      PropertyHistory,
    ]),
    NotificationModule,
    EventsModule,
    // forwardRef: AdHocInvoices → Payments → (webhooks) → PaymentPlans cycle.
    forwardRef(() => AdHocInvoicesModule),
    forwardRef(() => PaymentsModule),
    forwardRef(() => TenanciesModule),
    TenantBalancesModule,
    RenewalChargeModule,
    WhatsappBotModule,
  ],
  controllers: [PaymentPlansController, PaymentPlanRequestsController],
  providers: [
    PaymentPlansService,
    PaymentPlanRequestsService,
    InstallmentPDFService,
    UtilService,
  ],
  exports: [
    PaymentPlansService,
    PaymentPlanRequestsService,
    InstallmentPDFService,
  ],
})
export class PaymentPlansModule {}

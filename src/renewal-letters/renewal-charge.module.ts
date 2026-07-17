import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RenewalChargeService } from './renewal-charge.service';
import { TenantBalanceLedger } from '../tenant-balances/entities/tenant-balance-ledger.entity';
import { TenantBalancesModule } from '../tenant-balances/tenant-balances.module';
import { Rent } from '../rents/entities/rent.entity';
import { RenewalInvoice } from '../tenancies/entities/renewal-invoice.entity';
import { PropertyHistory } from '../property-history/entities/property-history.entity';
import { PropertyTenant } from '../properties/entities/property-tenants.entity';
import { ScheduledMoveOut } from '../properties/entities/scheduled-move-out.entity';
import { PaymentPlanInstallment } from '../payment-plans/entities/payment-plan-installment.entity';
import { UtilsModule } from '../utils/utils.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TenantBalanceLedger,
      Rent,
      RenewalInvoice,
      PropertyHistory,
      PropertyTenant,
      ScheduledMoveOut,
      PaymentPlanInstallment,
    ]),
    TenantBalancesModule,
    UtilsModule,
  ],
  providers: [RenewalChargeService],
  exports: [RenewalChargeService],
})
export class RenewalChargeModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RenewalChargeService } from './renewal-charge.service';
import { TenantBalanceLedger } from '../tenant-balances/entities/tenant-balance-ledger.entity';
import { TenantBalancesModule } from '../tenant-balances/tenant-balances.module';
import { Rent } from '../rents/entities/rent.entity';
import { RenewalInvoice } from '../tenancies/entities/renewal-invoice.entity';
import { PropertyHistory } from '../property-history/entities/property-history.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TenantBalanceLedger,
      Rent,
      RenewalInvoice,
      PropertyHistory,
    ]),
    TenantBalancesModule,
  ],
  providers: [RenewalChargeService],
  exports: [RenewalChargeService],
})
export class RenewalChargeModule {}

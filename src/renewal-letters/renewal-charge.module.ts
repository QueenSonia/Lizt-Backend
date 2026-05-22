import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RenewalChargeService } from './renewal-charge.service';
import { TenantBalanceLedger } from '../tenant-balances/entities/tenant-balance-ledger.entity';
import { TenantBalancesModule } from '../tenant-balances/tenant-balances.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantBalanceLedger]),
    TenantBalancesModule,
  ],
  providers: [RenewalChargeService],
  exports: [RenewalChargeService],
})
export class RenewalChargeModule {}

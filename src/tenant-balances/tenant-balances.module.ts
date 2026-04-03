import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantBalance } from './entities/tenant-balance.entity';
import { TenantBalanceLedger } from './entities/tenant-balance-ledger.entity';
import { TenantBalancesService } from './tenant-balances.service';

@Module({
  imports: [TypeOrmModule.forFeature([TenantBalance, TenantBalanceLedger])],
  providers: [TenantBalancesService],
  exports: [TenantBalancesService],
})
export class TenantBalancesModule {}

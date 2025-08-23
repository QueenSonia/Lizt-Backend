import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TenantKycService } from './tenant-kyc.service';
import { TenantKycController } from './tenant-kyc.controller';
import { TenantKyc } from './entities/tenant-kyc.entity';
import { Account } from 'src/users/entities/account.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TenantKyc, Account])],
  controllers: [TenantKycController],
  providers: [TenantKycService],
})
export class TenantKycModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TenantKycService } from './tenant-kyc.service';
import { TenantKycController } from './tenant-kyc.controller';
import { TenantKyc } from './entities/tenant-kyc.entity';
import { Account } from 'src/users/entities/account.entity';
import { Users } from 'src/users/entities/user.entity';
import { TenanciesModule } from 'src/tenancies/tenancies.module';
import { KYCApplication } from 'src/kyc-links/entities/kyc-application.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantKyc, Account, Users, KYCApplication]),
    TenanciesModule,
  ],
  controllers: [TenantKycController],
  providers: [TenantKycService],
})
export class TenantKycModule {}

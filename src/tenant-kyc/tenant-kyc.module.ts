import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TenantKycService } from './tenant-kyc.service';
import { TenantKycController } from './tenant-kyc.controller';
import { TenantKyc } from './entities/tenant-kyc.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TenantKyc])],
  controllers: [TenantKycController],
  providers: [TenantKycService],
})
export class TenantKycModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonArea } from './entities/common-area.entity';
import { CommonAreasService } from './common-areas.service';
import { CommonAreasController } from './common-areas.controller';
import { MaintenanceRequest } from '../maintenance-requests/entities/maintenance-request.entity';
import { TeamMember } from '../users/entities/team-member.entity';
import { Account } from '../users/entities/account.entity';
import { ScopeModule } from 'src/common/scope/scope.module';

@Module({
  imports: [
    // Account is needed by JwtAuthGuard to hydrate req.user from the JWT
    // payload into the full Account entity.
    TypeOrmModule.forFeature([
      CommonArea,
      MaintenanceRequest,
      TeamMember,
      Account,
    ]),
    ScopeModule,
  ],
  controllers: [CommonAreasController],
  providers: [CommonAreasService],
  exports: [CommonAreasService],
})
export class CommonAreasModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonArea } from './entities/common-area.entity';
import { CommonAreasService } from './common-areas.service';
import { CommonAreasController } from './common-areas.controller';
import { MaintenanceRequest } from '../maintenance-requests/entities/maintenance-request.entity';
import { TeamMember } from '../users/entities/team-member.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([CommonArea, MaintenanceRequest, TeamMember]),
  ],
  controllers: [CommonAreasController],
  providers: [CommonAreasService],
  exports: [CommonAreasService],
})
export class CommonAreasModule {}

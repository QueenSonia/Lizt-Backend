import { Module } from '@nestjs/common';
import { MaintenanceRequestsService } from './maintenance-requests.service';
import { MaintenanceRequestsController } from './maintenance-requests.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MaintenanceRequest } from './entities/maintenance-request.entity';
import { MaintenanceRequestStatusHistory } from './entities/maintenance-request-status-history.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Property } from 'src/properties/entities/property.entity';
import { FileUploadService } from 'src/utils/cloudinary';
import { AutoMaintenanceRequest } from './entities/auto-maintenance-request.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { UtilsModule } from 'src/utils/utils.module';
import { CommonArea } from 'src/common-areas/entities/common-area.entity';
import { Account } from 'src/users/entities/account.entity';
import { ArtisansModule } from 'src/artisans/artisans.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MaintenanceRequest,
      MaintenanceRequestStatusHistory,
      AutoMaintenanceRequest,
      PropertyTenant,
      Property,
      TeamMember,
      CommonArea,
      Account,
    ]),
    UtilsModule,
    ArtisansModule,
  ],
  controllers: [MaintenanceRequestsController],
  providers: [MaintenanceRequestsService, FileUploadService],
  exports: [MaintenanceRequestsService],
})
export class MaintenanceRequestsModule {}

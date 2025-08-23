import { Module } from '@nestjs/common';
import { ServiceRequestsService } from './service-requests.service';
import { ServiceRequestsController } from './service-requests.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceRequest } from './entities/service-request.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { FileUploadService } from 'src/utils/cloudinary';
import { AutoServiceRequest } from './entities/auto-service-request.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';


@Module({
  imports: [TypeOrmModule.forFeature([ServiceRequest, AutoServiceRequest, PropertyTenant, TeamMember])],
  controllers: [ServiceRequestsController],
  providers: [ServiceRequestsService, FileUploadService],
  exports: [ServiceRequestsService]
})
export class ServiceRequestsModule {}

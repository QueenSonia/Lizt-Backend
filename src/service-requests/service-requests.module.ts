import { Module } from '@nestjs/common';
import { ServiceRequestsService } from './service-requests.service';
import { ServiceRequestsController } from './service-requests.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceRequest } from './entities/service-request.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { FileUploadService } from 'src/utils/cloudinary';
import { AutoServiceRequest } from './entities/auto-service-request.entity';


@Module({
  imports: [TypeOrmModule.forFeature([ServiceRequest, AutoServiceRequest, PropertyTenant])],
  controllers: [ServiceRequestsController],
  providers: [ServiceRequestsService, FileUploadService],
})
export class ServiceRequestsModule {}

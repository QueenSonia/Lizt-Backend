import { Module } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { PropertiesController } from './properties.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Property } from './entities/property.entity';
import { FileUploadService } from 'src/utils/cloudinary';
import { PropertyTenant } from './entities/property-tenants.entity';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Property, PropertyTenant]), AuthModule],
  controllers: [PropertiesController],
  providers: [PropertiesService, FileUploadService],
})
export class PropertiesModule {}

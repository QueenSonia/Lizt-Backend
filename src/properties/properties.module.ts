import { Module } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { PropertiesController } from './properties.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Property } from './entities/property.entity';
import { FileUploadService } from 'src/utils/cloudinary';
import { PropertyTenant } from './entities/property-tenants.entity';
import { PropertyGroup } from './entities/property-group.entity';
import { RentsService } from 'src/rents/rents.service';
import { RentsModule } from 'src/rents/rents.module';
import { UsersService } from 'src/users/users.service';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Property, PropertyTenant, PropertyGroup]),
    RentsModule, 
    UsersModule
  ],
  controllers: [PropertiesController],
  providers: [PropertiesService, FileUploadService, RentsService]
})
export class PropertiesModule {}

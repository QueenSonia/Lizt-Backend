import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RentsService } from './rents.service';
import { RentsController } from './rents.controller';
import { Rent } from './entities/rent.entity';
import { FileUploadService } from 'src/utils/cloudinary';
import { RentIncrease } from './entities/rent-increase.entity';
import { Property } from 'src/properties/entities/property.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { UtilsModule } from 'src/utils/utils.module';
import { ScopeModule } from 'src/common/scope/scope.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Rent, RentIncrease, Property, PropertyTenant]),
    UtilsModule,
    ScopeModule,
  ],
  controllers: [RentsController],
  providers: [RentsService, FileUploadService],
  exports: [RentsService, TypeOrmModule],
})
export class RentsModule {}

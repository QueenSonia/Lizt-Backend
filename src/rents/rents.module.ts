import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RentsService } from './rents.service';
import { RentsController } from './rents.controller';
import { Rent } from './entities/rent.entity';
import { FileUploadService } from 'src/utils/cloudinary';
import { RentIncrease } from './entities/rent-increase.entity';
import { Property } from 'src/properties/entities/property.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Rent, RentIncrease, Property])],
  controllers: [RentsController],
  providers: [RentsService, FileUploadService],
  exports: [RentsService, TypeOrmModule]
})
export class RentsModule {}

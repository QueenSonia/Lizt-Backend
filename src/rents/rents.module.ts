import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RentsService } from './rents.service';
import { RentsController } from './rents.controller';
import { Rent } from './entities/rent.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Rent])],
  controllers: [RentsController],
  providers: [RentsService],
})
export class RentsModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PropertyHistoryService } from './property-history.service';
import { PropertyHistoryController } from './property-history.controller';
import { PropertyHistory } from './entities/property-history.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PropertyHistory])],
  controllers: [PropertyHistoryController],
  providers: [PropertyHistoryService],
})
export class PropertyHistoryModule {}

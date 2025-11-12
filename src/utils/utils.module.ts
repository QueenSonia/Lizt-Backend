import { Module } from '@nestjs/common';
import { UtilService } from './utility-service';

@Module({
  providers: [UtilService],
  exports: [UtilService],
})
export class UtilsModule {}

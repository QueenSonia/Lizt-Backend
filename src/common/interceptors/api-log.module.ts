import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiLog } from './api-log.entity';
import { LoggingInterceptor } from './logging.interceptor';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ApiLog])],
  providers: [LoggingInterceptor],
  exports: [LoggingInterceptor, TypeOrmModule],
})
export class ApiLogModule {}

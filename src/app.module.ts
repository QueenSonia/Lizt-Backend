import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import typeorm from '../ormconfig';
import dotenv from 'dotenv';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PropertiesModule } from './properties/properties.module';
import { RentsModule } from './rents/rents.module';
import { ServiceRequestsModule } from './service-requests/service-requests.module';
import { PropertyHistoryModule } from './property-history/property-history.module';

dotenv.config();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [typeorm],
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const typeOrmConfig = configService.get('typeorm');
        if (!typeOrmConfig) {
          throw new Error('TypeORM configuration not found');
        }
        return typeOrmConfig;
      },
    }),
    AuthModule,
    UsersModule,
    PropertiesModule,
    RentsModule,
    ServiceRequestsModule,
    PropertyHistoryModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

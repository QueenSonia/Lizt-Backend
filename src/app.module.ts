import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { config } from 'dotenv-flow';
import { EventEmitterModule } from '@nestjs/event-emitter';

import typeorm from '../ormconfig';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PropertiesModule } from './properties/properties.module';
import { RentsModule } from './rents/rents.module';
import { ServiceRequestsModule } from './service-requests/service-requests.module';
import { PropertyHistoryModule } from './property-history/property-history.module';
import { NoticeAgreementModule } from './notice-agreements/notice-agreement.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { NotificationModule } from './notifications/notification.module';
import { ChatModule } from './chat/chat.module';
import { DatabaseService } from './database.service';
import { TenantKycModule } from './tenant-kyc/tenant-kyc.module';
import { WhatsappBotModule } from './whatsapp-bot/whatsapp-bot.module';
import { AppCacheModule } from './lib/cache';

config({ default_node_env: 'production' });

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [typeorm],
      cache: true,
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const typeOrmConfig = configService.get('typeorm');

        if (!typeOrmConfig) throw new Error('TypeORM configuration not found');

        return typeOrmConfig;
      },
    }),
    AppCacheModule,

    AuthModule,
    UsersModule,
    PropertiesModule,
    RentsModule,
    ServiceRequestsModule,
    PropertyHistoryModule,
    NoticeAgreementModule,
    WhatsappModule,
    NotificationModule,
    ChatModule,
    EventEmitterModule.forRoot(),
    TenantKycModule,
    WhatsappBotModule,
  ],
  controllers: [AppController],
  providers: [AppService, DatabaseService],
})
export class AppModule {}

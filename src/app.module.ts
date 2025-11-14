import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { config } from 'dotenv-flow';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';

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
import { NotificationModule } from './notifications/notification.module';
import { ChatModule } from './chat/chat.module';
import { DatabaseService } from './database.service';
import { TenantKycModule } from './tenant-kyc/tenant-kyc.module';
import { WhatsappBotModule } from './whatsapp-bot/whatsapp-bot.module';
import { KYCLinksModule } from './kyc-links/kyc-links.module';
import { AppCacheModule } from './lib/cache';
import { TenanciesModule } from './tenancies/tenancies.module';
import { EventsModule } from './events/events.module';
import { UtilService } from 'src/utils/utility-service';
import { KycFeedbackModule } from './kyc-feedback/kyc-feedback.module';

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
    NotificationModule,
    ChatModule,
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    TenantKycModule,
    WhatsappBotModule,
    KYCLinksModule,
    TenanciesModule,
    EventsModule,
    KycFeedbackModule,
  ],
  controllers: [AppController],
  providers: [AppService, DatabaseService, UtilService],
})
export class AppModule {}

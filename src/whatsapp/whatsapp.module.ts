import { Module } from '@nestjs/common';
import { TwilioModule as NestTwilioModule } from 'nestjs-twilio';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TwilioService } from './services/twilio.service';
import { AfricaTalkingService } from './services/africastalking.service';

@Module({
  imports: [
    NestTwilioModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        accountSid: configService.get('TWILIO_ACCOUNT_SID'),
        authToken: configService.get('TWILIO_AUTH_TOKEN'),
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [TwilioService, AfricaTalkingService],
  exports: [TwilioService,  AfricaTalkingService],
})
export class WhatsappModule {}

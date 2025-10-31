import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { KYCLinksService } from './kyc-links.service';
import { KYCApplicationService } from './kyc-application.service';
import { KYCApplicationController } from './kyc-application.controller';
import { KYCLink } from './entities/kyc-link.entity';
import { KYCApplication } from './entities/kyc-application.entity';
import { Property } from '../properties/entities/property.entity';
import { WhatsappBotModule } from '../whatsapp-bot/whatsapp-bot.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([KYCLink, KYCApplication, Property]),
    ConfigModule,
    WhatsappBotModule,
  ],
  controllers: [KYCApplicationController],
  providers: [KYCLinksService, KYCApplicationService],
  exports: [KYCLinksService, KYCApplicationService],
})
export class KYCLinksModule {}

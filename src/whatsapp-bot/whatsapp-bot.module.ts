import { Module } from '@nestjs/common';

import { WhatsappBotService } from './whatsapp-bot.service';
import { WhatsappBotController } from './whatsapp-bot.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';

@Module({
   imports: [TypeOrmModule.forFeature([ ServiceRequest])],
  controllers: [WhatsappBotController],
  providers: [WhatsappBotService],
})
export class WhatsappBotModule {}

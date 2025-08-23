import { forwardRef, Module } from '@nestjs/common';

import { WhatsappBotService } from './whatsapp-bot.service';
import { WhatsappBotController } from './whatsapp-bot.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { Users } from 'src/users/entities/user.entity';
import { UsersModule } from 'src/users/users.module';
import { UsersService } from 'src/users/users.service';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceRequest, Users, PropertyTenant]),      
  ],
  controllers: [WhatsappBotController],
  providers: [WhatsappBotService],
  exports: [WhatsappBotService],
})
export class WhatsappBotModule {}

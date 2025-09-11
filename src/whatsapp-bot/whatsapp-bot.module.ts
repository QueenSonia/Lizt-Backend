import { forwardRef, Module } from '@nestjs/common';

import { WhatsappBotService } from './whatsapp-bot.service';
import { WhatsappBotController } from './whatsapp-bot.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { Users } from 'src/users/entities/user.entity';
import { UsersModule } from 'src/users/users.module';
import { UsersService } from 'src/users/users.service';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { ServiceRequestsService } from 'src/service-requests/service-requests.service';
import { ServiceRequestsModule } from 'src/service-requests/service-requests.module';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { Waitlist } from 'src/users/entities/waitlist.entity';


@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceRequest, Users, PropertyTenant, TeamMember, Waitlist]), 
    ServiceRequestsModule,
    forwardRef(() => UsersModule), 
  ],
  controllers: [WhatsappBotController],
  providers: [WhatsappBotService],
  exports: [WhatsappBotService],
})
export class WhatsappBotModule {}

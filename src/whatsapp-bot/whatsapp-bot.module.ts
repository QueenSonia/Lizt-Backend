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
import { Property } from 'src/properties/entities/property.entity';
import { Account } from 'src/users/entities/account.entity';
import { LandlordFlow } from './templates/landlord/landlordflow';


@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceRequest, Users, PropertyTenant, TeamMember, Waitlist, Property, Account]), 
    ServiceRequestsModule,
    forwardRef(() => UsersModule), 
  ],
  controllers: [WhatsappBotController],
  providers: [WhatsappBotService,   LandlordFlow,],
  exports: [WhatsappBotService],
})
export class WhatsappBotModule {}

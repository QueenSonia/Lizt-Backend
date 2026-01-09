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
import { Team } from 'src/users/entities/team.entity';
import { Waitlist } from 'src/users/entities/waitlist.entity';
import { Property } from 'src/properties/entities/property.entity';
import { Account } from 'src/users/entities/account.entity';
import { LandlordFlow } from './templates/landlord/landlordflow';
import { Rent } from 'src/rents/entities/rent.entity';
import { UtilsModule } from 'src/utils/utils.module';
import { KYCLinksModule } from 'src/kyc-links/kyc-links.module';
import { ChatLog } from './entities/chat-log.entity';
import { ChatLogService } from './chat-log.service';
import { MessageStatusTracker } from './message-status-tracker.service';
import { WebhookHandler } from './webhook-handler.service';
import { ChatHistoryModule } from './chat-history.module';
import { SimulatorGateway } from './simulator/simulator.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceRequest,
      Users,
      PropertyTenant,
      TeamMember,
      Team,
      Waitlist,
      Property,
      Account,
      Rent,
      ChatLog,
    ]),
    ServiceRequestsModule,
    forwardRef(() => UsersModule),
    UtilsModule,
    forwardRef(() => KYCLinksModule),
    ChatHistoryModule,
  ],
  controllers: [WhatsappBotController],
  providers: [
    WhatsappBotService,
    LandlordFlow,
    ChatLogService,
    MessageStatusTracker,
    WebhookHandler,
    SimulatorGateway,
  ],
  exports: [
    WhatsappBotService,
    ChatLogService,
    MessageStatusTracker,
    WebhookHandler,
    SimulatorGateway,
  ],
})
export class WhatsappBotModule {}

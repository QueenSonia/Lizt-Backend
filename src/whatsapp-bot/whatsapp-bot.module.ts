import { forwardRef, Module } from '@nestjs/common';
import { EventsModule } from 'src/events/events.module';

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
import { KYCApplication } from 'src/kyc-links/entities/kyc-application.entity';
import { TemplateSenderService } from './template-sender';
import { TenantFlowService, NextPeriodStateResolver } from './tenant-flow';
import { PaymentPlan } from 'src/payment-plans/entities/payment-plan.entity';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { LandlordFlowService } from './landlord-flow';
import { WhatsAppNotificationLog } from './entities/whatsapp-notification-log.entity';
import { WhatsAppNotificationLogService } from './whatsapp-notification-log.service';
import { WhatsAppNotificationListener } from './whatsapp-notification.listener';
import { RenewalInvoice } from 'src/tenancies/entities/renewal-invoice.entity';
import { TenantBalancesModule } from 'src/tenant-balances/tenant-balances.module';
import { PdfModule } from 'src/pdf/pdf.module';

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
      KYCApplication,
      WhatsAppNotificationLog,
      RenewalInvoice,
      PaymentPlan,
      PropertyHistory,
    ]),
    ServiceRequestsModule,
    forwardRef(() => UsersModule),
    UtilsModule,
    forwardRef(() => KYCLinksModule),
    ChatHistoryModule,
    EventsModule,
    TenantBalancesModule,
    PdfModule,
  ],
  controllers: [WhatsappBotController],
  providers: [
    TemplateSenderService,
    TenantFlowService,
    NextPeriodStateResolver,
    LandlordFlowService,
    WhatsappBotService,
    LandlordFlow,
    ChatLogService,
    MessageStatusTracker,
    WebhookHandler,
    SimulatorGateway,
    WhatsAppNotificationLogService,
    WhatsAppNotificationListener,
  ],
  exports: [
    TemplateSenderService,
    TenantFlowService,
    LandlordFlowService,
    WhatsappBotService,
    ChatLogService,
    MessageStatusTracker,
    WebhookHandler,
    SimulatorGateway,
    WhatsAppNotificationLogService,
  ],
})
export class WhatsappBotModule {}

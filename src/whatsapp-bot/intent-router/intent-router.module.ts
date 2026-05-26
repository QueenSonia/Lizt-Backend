import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LlmClientService } from './llm-client.service';
import { TenantReadContextService } from './tenant-read-context.service';
import { IntentRouterService } from './intent-router.service';
import { TenantNotice } from './entities/tenant-notice.entity';
import { AiIntentLog } from './entities/ai-intent-log.entity';

import { Users } from 'src/users/entities/user.entity';
import { Account } from 'src/users/entities/account.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Rent } from 'src/rents/entities/rent.entity';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';

import { TenantBalancesModule } from 'src/tenant-balances/tenant-balances.module';
import { NotificationModule } from 'src/notifications/notification.module';
import { UtilsModule } from 'src/utils/utils.module';
import { WhatsappBotModule } from '../whatsapp-bot.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TenantNotice,
      AiIntentLog,
      Users,
      Account,
      PropertyTenant,
      Rent,
      MaintenanceRequest,
      TeamMember,
    ]),
    TenantBalancesModule,
    forwardRef(() => NotificationModule),
    UtilsModule,
    forwardRef(() => WhatsappBotModule),
  ],
  providers: [LlmClientService, TenantReadContextService, IntentRouterService],
  exports: [IntentRouterService],
})
export class IntentRouterModule {}

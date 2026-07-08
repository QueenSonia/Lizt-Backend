import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { ChatPresenceService } from './chat-presence.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatMessage } from './chat-message.entity';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import { ChatController } from './chat.controller.';
import { MaintenanceChatController } from './maintenance-chat.controller';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { UtilsModule } from 'src/utils/utils.module';
import { FileUploadService } from 'src/utils/cloudinary';
import { Account } from 'src/users/entities/account.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { AuthModule } from 'src/auth/auth.module';
import { ScopeModule } from 'src/common/scope/scope.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChatMessage,
      MaintenanceRequest,
      PropertyTenant,
      Account,
      TeamMember,
    ]),
    UtilsModule,
    // Gives the gateway AuthService (for verifyWsTicket on every handshake).
    AuthModule,
    ScopeModule,
  ],
  providers: [
    ChatGateway,
    ChatService,
    ChatPresenceService,
    FileUploadService,
  ],
  controllers: [ChatController, MaintenanceChatController],
  // ChatPresenceService is exported so MrChatNotificationService (in
  // whatsapp-bot module) can suppress WA pings for currently-online users.
  exports: [ChatService, ChatPresenceService],
})
export class ChatModule {}

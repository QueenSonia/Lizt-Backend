import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatMessage } from './chat-message.entity';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import { MaintenanceRequestsService } from 'src/maintenance-requests/maintenance-requests.service';
import { ChatController } from './chat.controller.';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { UtilsModule } from 'src/utils/utils.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatMessage, MaintenanceRequest, PropertyTenant]),
    UtilsModule,
  ],
  providers: [ChatGateway, ChatService],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}

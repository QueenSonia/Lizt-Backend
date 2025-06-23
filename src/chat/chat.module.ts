import { Module } from "@nestjs/common";
import { ChatService } from "./chat.service";
import { ChatGateway } from "./chat.gateway";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ChatMessage } from "./chat-message.entity";
import { ServiceRequest } from "src/service-requests/entities/service-request.entity";
import { ServiceRequestsService } from "src/service-requests/service-requests.service";
import { ChatController } from "./chat.controller.";
import { PropertyTenant } from "src/properties/entities/property-tenants.entity";

@Module({
  imports: [TypeOrmModule.forFeature([ ChatMessage, ServiceRequest, PropertyTenant])],
  providers: [
    ChatGateway,
    ChatService,
  ],
  controllers:[ChatController],
  exports: [ChatService]
})
export class ChatModule {}

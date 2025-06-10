import { Module } from "@nestjs/common";
import { ChatService } from "./chat.service";
import { ChatGateway } from "./chat.gateway";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ChatMessage } from "./chat-message.entity";
import { ServiceRequest } from "src/service-requests/entities/service-request.entity";

@Module({
  imports: [TypeOrmModule.forFeature([ ChatMessage, ServiceRequest])],
  providers: [
    ChatGateway,
    ChatService,
  ],
  exports: [ChatService],
})
export class ChatModule {}

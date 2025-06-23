// chat.controller.ts
import { Controller, Get, Param } from '@nestjs/common';
import { ChatService } from './chat.service';
import { SkipAuth } from 'src/auth/auth.decorator';

@Controller('chats')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}


  @Get()
  @SkipAuth()
  async getAllConversations() {
    return this.chatService.getAllMessages();
  }

    @SkipAuth()
  @Get('request/:requestId')
  async getMessages(@Param('requestId') requestId: string) {
    return this.chatService.getMessagesByRequestId(requestId);
  }
}

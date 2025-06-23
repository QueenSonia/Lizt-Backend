// chat.controller.ts
import { Controller, Get, Param, Body, Post, Req} from '@nestjs/common';
import { ChatService } from './chat.service';
import { SkipAuth } from 'src/auth/auth.decorator';
import { UtilService } from 'src/utils/utility-service';

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

  @Post('send-mail')
  async sendMail(
    @Req() req: any,
    @Body() body: { message: string }
  ) {
    const email = req.user?.email ;
    const {  message } = body;
    return UtilService.sendEmail(email, "Customer Contact", message);
  }
}

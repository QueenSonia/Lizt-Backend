// chat.controller.ts
import { Controller, Get, Param, Body, Post, Req } from '@nestjs/common';
import { ChatService } from './chat.service';
import { SkipAuth } from 'src/auth/auth.decorator';
import { UtilService } from 'src/utils/utility-service';

@Controller('chats')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly utilService: UtilService,
  ) {}

  @Get()
  async getAllConversations(@Req() req) {
    const currentUser = req.user.role; // Assuming role is 'admin' | 'tenant'
    return this.chatService.getAllMessagesForUser(currentUser);
  }

  @SkipAuth()
  @Get('request/:requestId')
  async getMessages(@Param('requestId') requestId: string) {
    return this.chatService.getMessagesByRequestId(requestId);
  }

  @Post('send-mail')
  async sendMail(@Req() req: any, @Body() body: { message: string }) {
    const email = req.user?.email;
    const { message } = body;
    return this.utilService.sendEmail(email, 'Customer Contact', message);
  }

  @SkipAuth()
  @Post('contact')
  async contactForm(
    @Body()
    body: {
      name: string;
      email: string;
      phone?: string;
      reason: string;
      message: string;
    },
  ) {
    const { name, email, phone, reason, message } = body;

    if (!name || !email || !reason || !message) {
      return { error: 'Missing required fields' };
    }

    const htmlContent = `
      <h2>New Contact Form Submission - Lizt website</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone || 'Not provided'}</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <hr />
      <p><strong>Message:</strong></p>
      <p>${message.replace(/\n/g, '<br />')}</p>
    `;

    await this.utilService.sendEmail(
      'hello@propertykraft.africa',
      `[Lizt Contact] ${reason} — ${name}`,
      htmlContent,
    );

    return { success: true };
  }

  @Post('mark-as-resolved/:requestId')
  async markAsResolved(@Req() req: any) {
    return this.chatService.markAsResolved(req.params.requestId);
  }
}

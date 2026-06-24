import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ChatService } from './chat.service';
import { SendMaintenanceMessageDto } from './dto/send-maintenance-message.dto';

// HTTP surface for the unified Updates & Thread on a maintenance request.
// Distinct from the legacy /chats/* routes which handle the older tenant-rep
// flow — those stay untouched for back-compat. Auth is the global APP_GUARD
// (JwtAuthGuard) registered in AuthModule.
@Controller('maintenance-requests')
export class MaintenanceChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get(':requestId/chat')
  async list(@Param('requestId') requestId: string, @Req() req: any) {
    return this.chatService.listMaintenanceChat(requestId, req.user);
  }

  @Post(':requestId/chat')
  async send(
    @Param('requestId') requestId: string,
    @Body() body: SendMaintenanceMessageDto,
    @Req() req: any,
  ) {
    return this.chatService.sendMaintenanceChatMessage({
      requestId,
      authorAccount: req.user,
      activeRole: req.user.role,
      content: body.content,
      media: body.media,
    });
  }
}

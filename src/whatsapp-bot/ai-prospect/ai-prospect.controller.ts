import {
    Controller,
    Get,
    Post,
    Patch,
    Param,
    Body,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { AiProspectService } from './ai-prospect.service';
import { ProspectConversationStatus, ProspectChannel } from '../entities/prospect-conversation.entity';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/role.decorator';

// ============================================================
// AUTHENTICATED ENDPOINTS (Prospect Agent Dashboard)
// ============================================================

@Controller('api/prospect-conversations')
@UseGuards(JwtAuthGuard)
export class AiProspectController {
    constructor(private readonly aiProspectService: AiProspectService) { }

    @Get()
    @Roles('prospect_agent', 'admin', 'landlord')
    async listConversations(
        @Query('status') status?: ProspectConversationStatus,
        @Query('channel') channel?: ProspectChannel,
        @Query('search') search?: string,
    ) {
        return this.aiProspectService.getActiveConversations({
            status,
            channel,
            search,
        });
    }

    @Get(':id')
    @Roles('prospect_agent', 'admin', 'landlord')
    async getConversation(@Param('id') id: string) {
        return this.aiProspectService.getConversationDetail(id);
    }

    @Get(':id/summary')
    @Roles('prospect_agent', 'admin', 'landlord')
    async getSummary(@Param('id') id: string) {
        const summary = await this.aiProspectService.getConversationSummary(id);
        return { summary };
    }

    @Post(':id/takeover')
    @Roles('prospect_agent', 'admin')
    async takeoverConversation(@Param('id') id: string, @Req() req: any) {
        return this.aiProspectService.takeoverConversation(id, req.user.id);
    }

    @Post(':id/handback')
    @Roles('prospect_agent', 'admin')
    async handbackToAi(@Param('id') id: string) {
        return this.aiProspectService.handbackToAi(id);
    }

    @Post(':id/message')
    @Roles('prospect_agent', 'admin')
    async sendAgentMessage(
        @Param('id') id: string,
        @Body('message') message: string,
        @Req() req: any,
    ) {
        return this.aiProspectService.sendAgentMessage(id, req.user.id, message);
    }

    @Patch(':id/close')
    @Roles('prospect_agent', 'admin')
    async closeConversation(@Param('id') id: string) {
        return this.aiProspectService.closeConversation(id);
    }
}

// ============================================================
// PUBLIC ENDPOINTS (Web Chat Widget)
// ============================================================

@Controller('api/web-chat')
export class WebChatController {
    constructor(private readonly aiProspectService: AiProspectService) { }

    @Post('message')
    async sendMessage(
        @Body('sessionId') sessionId: string,
        @Body('message') message: string,
    ) {
        return this.aiProspectService.handleWebChatMessage(sessionId, message);
    }

    @Get('history/:sessionId')
    async getHistory(@Param('sessionId') sessionId: string) {
        // Find conversation by session ID and return messages
        return this.aiProspectService.getActiveConversations({
            search: sessionId,
        });
    }
}

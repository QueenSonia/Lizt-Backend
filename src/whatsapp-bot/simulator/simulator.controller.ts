import { Body, Controller, Logger, Post, Get } from '@nestjs/common';
import { WhatsappBotService } from '../whatsapp-bot.service';
import { UsersService } from 'src/users/users.service';
import { UtilService } from 'src/utils/utility-service';
import { IncomingMessage } from '../utils/types';
import { SkipAuth } from 'src/auth/auth.decorator';
import { randomUUID } from 'crypto';

@SkipAuth()
@Controller('simulator')
export class SimulatorController {
    private readonly logger = new Logger(SimulatorController.name);

    constructor(
        private readonly whatsappBotService: WhatsappBotService,
        private readonly usersService: UsersService,
        private readonly utilService: UtilService,
    ) { }

    @Get('users')
    async getUsers() {
        // Fetch all users using the existing UsersService
        // We might want to filter only valid phone numbers, but let's dump all for now
        const users = await this.usersService.getAllUsers({ size: 100, page: 1 });
        return {
            status: 'success',
            users: users.users.map(u => ({
                id: u.id,
                name: `${u.first_name} ${u.last_name}`,
                phone: this.utilService.normalizePhoneNumber(u.phone_number)
            }))
        };
    }

    @Post('message')
    async handleIncomingMessage(@Body() body: { from: string; text: string }) {
        this.logger.log(`Received simulator message from ${body.from}: ${body.text}`);

        const normalizedFrom = this.utilService.normalizePhoneNumber(body.from);

        const incomingMessage: any = {
            from: normalizedFrom,
            id: `sim_msg_${Date.now()}_${randomUUID()}`,
            timestamp: Math.floor(Date.now() / 1000).toString(),
            type: 'text',
            text: {
                body: body.text,
            },
            is_simulated: true,
        };

        await this.whatsappBotService.handleMessage([incomingMessage]);
        return { status: 'success' };
    }

    @Post('interactive')
    async handleInteractiveMessage(
        @Body()
        body: {
            from: string;
            type: 'button_reply' | 'list_reply';
            id: string;
            title: string;
        },
    ) {
        this.logger.log(`Received simulator interactive from ${body.from}: ${body.id}`);

        const normalizedFrom = this.utilService.normalizePhoneNumber(body.from);

        const incomingMessage: any = {
            from: normalizedFrom,
            id: `sim_msg_${Date.now()}_${randomUUID()}`,
            timestamp: Math.floor(Date.now() / 1000).toString(),
            type: 'interactive',
            interactive: {
                type: body.type,
                [body.type]: {
                    id: body.id,
                    title: body.title,
                },
            },
            is_simulated: true,
        };

        await this.whatsappBotService.handleMessage([incomingMessage]);
        return { status: 'success' };
    }
}

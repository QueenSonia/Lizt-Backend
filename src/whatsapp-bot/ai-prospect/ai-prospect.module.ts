import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { AiProspectService } from './ai-prospect.service';
import { AiProspectController, WebChatController } from './ai-prospect.controller';
import { AiProspectGateway } from './ai-prospect.gateway';
import { GeminiService } from './gemini.service';

import { ProspectConversation } from '../entities/prospect-conversation.entity';
import { ProspectMessage } from '../entities/prospect-message.entity';
import { Property } from 'src/properties/entities/property.entity';
import { Account } from 'src/users/entities/account.entity';
import { WhatsappBotModule } from '../whatsapp-bot.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            ProspectConversation,
            ProspectMessage,
            Property,
            Account,
        ]),
        ConfigModule,
        forwardRef(() => WhatsappBotModule),
    ],

    controllers: [AiProspectController, WebChatController],
    providers: [AiProspectService, GeminiService, AiProspectGateway],
    exports: [AiProspectService],
})
export class AiProspectModule { }

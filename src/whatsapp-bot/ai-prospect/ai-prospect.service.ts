import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { GeminiService } from './gemini.service';
import {
    ProspectConversation,
    ProspectConversationStatus,
    ProspectChannel,
} from '../entities/prospect-conversation.entity';
import {
    ProspectMessage,
    MessageDirection,
    ProspectMessageSenderType,
} from '../entities/prospect-message.entity';
import { Property } from 'src/properties/entities/property.entity';
import { TemplateSenderService } from '../template-sender';
import { PropertyStatusEnum } from 'src/properties/dto/create-property.dto';

@Injectable()
export class AiProspectService {
    private readonly logger = new Logger(AiProspectService.name);
    private readonly enabled: boolean;

    constructor(
        @InjectRepository(ProspectConversation)
        private readonly conversationRepo: Repository<ProspectConversation>,
        @InjectRepository(ProspectMessage)
        private readonly messageRepo: Repository<ProspectMessage>,
        @InjectRepository(Property)
        private readonly propertyRepo: Repository<Property>,
        private readonly geminiService: GeminiService,
        private readonly templateSenderService: TemplateSenderService,
        private readonly configService: ConfigService,
        private readonly eventEmitter: EventEmitter2,
    ) {
        this.enabled =
            this.configService.get<string>('AI_PROSPECT_ENABLED') === 'true';
        if (this.enabled) {
            this.logger.log('✅ AI Prospect Service is ENABLED');
        } else {
            this.logger.warn('⚠️ AI Prospect Service is DISABLED');
        }
    }

    /**
     * Handle an incoming prospect message from WhatsApp
     */
    async handleProspectMessage(
        phone: string,
        messageText: string,
        channel: ProspectChannel = ProspectChannel.WHATSAPP,
    ): Promise<void> {
        this.logger.log(`📨 Prospect message from ${phone}: "${messageText}"`);

        // Find or create conversation
        let conversation = await this.findOrCreateConversation(phone, channel);

        // Save inbound message
        await this.saveMessage(
            conversation.id,
            MessageDirection.INBOUND,
            ProspectMessageSenderType.PROSPECT,
            messageText,
        );

        // Update last_message_at
        conversation.last_message_at = new Date();
        await this.conversationRepo.save(conversation);

        // If agent is handling, don't auto-respond — just notify dashboard
        if (
            conversation.status === ProspectConversationStatus.AGENT_HANDLED
        ) {
            this.logger.log('👤 Agent is handling — skipping AI response');
            this.emitConversationEvent('prospect:new_message', {
                conversationId: conversation.id,
                message: messageText,
                sender: 'prospect',
                channel,
            });
            return;
        }

        if (!this.enabled) {
            // If AI is disabled, send a fallback message
            const fallback =
                'Thank you for reaching out! Our team will get back to you shortly.';
            await this.sendReply(phone, fallback, channel);
            await this.saveMessage(
                conversation.id,
                MessageDirection.OUTBOUND,
                ProspectMessageSenderType.AI,
                fallback,
            );
            return;
        }

        // Build context and generate AI response
        const systemPrompt = await this.buildSystemPrompt();
        const history = await this.getConversationHistory(conversation.id);
        const aiResponse = await this.geminiService.generateResponse(
            systemPrompt,
            history,
            messageText,
        );

        // Save AI response
        await this.saveMessage(
            conversation.id,
            MessageDirection.OUTBOUND,
            ProspectMessageSenderType.AI,
            aiResponse,
        );

        // Send via WhatsApp
        await this.sendReply(phone, aiResponse, channel);

        // Extract and store prospect info asynchronously
        void this.extractAndUpdateProspectInfo(conversation.id);

        // Notify dashboard
        this.emitConversationEvent('prospect:new_message', {
            conversationId: conversation.id,
            message: aiResponse,
            sender: 'ai',
            channel,
        });
    }

    /**
     * Handle web chat message (uses sessionId instead of phone)
     */
    async handleWebChatMessage(
        sessionId: string,
        messageText: string,
    ): Promise<{ response: string; conversationId: string }> {
        let conversation = await this.conversationRepo.findOne({
            where: { web_session_id: sessionId },
        });

        if (!conversation) {
            conversation = this.conversationRepo.create({
                web_session_id: sessionId,
                channel: ProspectChannel.WEB,
                status: ProspectConversationStatus.AI_HANDLED,
                last_message_at: new Date(),
            });
            conversation = await this.conversationRepo.save(conversation);

            this.emitConversationEvent('prospect:conversation_created', {
                conversationId: conversation.id,
                channel: 'web',
                sessionId,
            });
        }

        // Save inbound
        await this.saveMessage(
            conversation.id,
            MessageDirection.INBOUND,
            ProspectMessageSenderType.PROSPECT,
            messageText,
        );

        conversation.last_message_at = new Date();
        await this.conversationRepo.save(conversation);

        // If agent is handling
        if (conversation.status === ProspectConversationStatus.AGENT_HANDLED) {
            this.emitConversationEvent('prospect:new_message', {
                conversationId: conversation.id,
                message: messageText,
                sender: 'prospect',
                channel: 'web',
            });
            return {
                response:
                    'A team member is currently assisting you. They will respond shortly.',
                conversationId: conversation.id,
            };
        }

        // Generate AI response
        const systemPrompt = await this.buildSystemPrompt();
        const history = await this.getConversationHistory(conversation.id);
        const aiResponse = await this.geminiService.generateResponse(
            systemPrompt,
            history,
            messageText,
        );

        await this.saveMessage(
            conversation.id,
            MessageDirection.OUTBOUND,
            ProspectMessageSenderType.AI,
            aiResponse,
        );

        void this.extractAndUpdateProspectInfo(conversation.id);

        this.emitConversationEvent('prospect:new_message', {
            conversationId: conversation.id,
            message: aiResponse,
            sender: 'ai',
            channel: 'web',
        });

        return { response: aiResponse, conversationId: conversation.id };
    }

    /**
     * Agent takes over a conversation
     */
    async takeoverConversation(
        conversationId: string,
        agentId: string,
    ): Promise<ProspectConversation> {
        const conversation = await this.conversationRepo.findOneOrFail({
            where: { id: conversationId },
        });

        conversation.status = ProspectConversationStatus.AGENT_HANDLED;
        conversation.assigned_agent_id = agentId;
        const saved = await this.conversationRepo.save(conversation);

        this.emitConversationEvent('prospect:status_changed', {
            conversationId,
            status: 'agent_handled',
            agentId,
        });

        return saved;
    }

    /**
     * Agent hands conversation back to AI
     */
    async handbackToAi(conversationId: string): Promise<ProspectConversation> {
        const conversation = await this.conversationRepo.findOneOrFail({
            where: { id: conversationId },
        });

        conversation.status = ProspectConversationStatus.AI_HANDLED;
        conversation.assigned_agent_id = null;
        const saved = await this.conversationRepo.save(conversation);

        this.emitConversationEvent('prospect:status_changed', {
            conversationId,
            status: 'ai_handled',
        });

        return saved;
    }

    /**
     * Agent sends a manual message
     */
    async sendAgentMessage(
        conversationId: string,
        agentId: string,
        text: string,
    ): Promise<ProspectMessage> {
        const conversation = await this.conversationRepo.findOneOrFail({
            where: { id: conversationId },
        });

        // Save agent message
        const message = await this.saveMessage(
            conversationId,
            MessageDirection.OUTBOUND,
            ProspectMessageSenderType.AGENT,
            text,
            { agent_id: agentId },
        );

        // Send via the appropriate channel
        if (
            conversation.channel === ProspectChannel.WHATSAPP &&
            conversation.phone_number
        ) {
            await this.templateSenderService.sendText(
                conversation.phone_number,
                text,
            );
        }

        // For web chat, the WebSocket event will deliver it
        this.emitConversationEvent('prospect:new_message', {
            conversationId,
            message: text,
            sender: 'agent',
            channel: conversation.channel,
            messageId: message.id,
        });

        // Update last_message_at
        conversation.last_message_at = new Date();
        await this.conversationRepo.save(conversation);

        return message;
    }

    /**
     * Close a conversation
     */
    async closeConversation(conversationId: string): Promise<ProspectConversation> {
        const conversation = await this.conversationRepo.findOneOrFail({
            where: { id: conversationId },
        });

        conversation.status = ProspectConversationStatus.CLOSED;
        const saved = await this.conversationRepo.save(conversation);

        this.emitConversationEvent('prospect:status_changed', {
            conversationId,
            status: 'closed',
        });

        return saved;
    }

    /**
     * Get all active conversations for the dashboard
     */
    async getActiveConversations(filters?: {
        status?: ProspectConversationStatus;
        channel?: ProspectChannel;
        search?: string;
    }): Promise<ProspectConversation[]> {
        const qb = this.conversationRepo
            .createQueryBuilder('conv')
            .leftJoinAndSelect('conv.assigned_agent', 'agent')
            .orderBy('conv.last_message_at', 'DESC');

        if (filters?.status) {
            qb.andWhere('conv.status = :status', { status: filters.status });
        } else {
            // By default, don't show closed ones
            qb.andWhere('conv.status != :closedStatus', {
                closedStatus: ProspectConversationStatus.CLOSED,
            });
        }

        if (filters?.channel) {
            qb.andWhere('conv.channel = :channel', { channel: filters.channel });
        }

        if (filters?.search) {
            qb.andWhere(
                '(conv.phone_number ILIKE :search OR conv.prospect_name ILIKE :search)',
                { search: `%${filters.search}%` },
            );
        }

        return qb.getMany();
    }

    /**
     * Get a single conversation with all messages
     */
    async getConversationDetail(
        conversationId: string,
    ): Promise<ProspectConversation> {
        return this.conversationRepo.findOneOrFail({
            where: { id: conversationId },
            relations: ['messages', 'assigned_agent'],
            order: { messages: { created_at: 'ASC' } },
        });
    }

    /**
     * Get AI-generated summary for a conversation
     */
    async getConversationSummary(conversationId: string): Promise<string> {
        const conversation = await this.conversationRepo.findOneOrFail({
            where: { id: conversationId },
        });
        return conversation.summary || 'No summary available yet.';
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    private async findOrCreateConversation(
        phone: string,
        channel: ProspectChannel,
    ): Promise<ProspectConversation> {
        // Look for an existing non-closed conversation
        let conversation = await this.conversationRepo.findOne({
            where: {
                phone_number: phone,
                status: Not(ProspectConversationStatus.CLOSED),
            },
        });

        if (!conversation) {
            conversation = this.conversationRepo.create({
                phone_number: phone,
                channel,
                status: ProspectConversationStatus.AI_HANDLED,
                last_message_at: new Date(),
            });
            conversation = await this.conversationRepo.save(conversation);

            this.logger.log(
                `🆕 Created new prospect conversation: ${conversation.id}`,
            );

            this.emitConversationEvent('prospect:conversation_created', {
                conversationId: conversation.id,
                phone,
                channel,
            });
        }

        return conversation;
    }

    private async saveMessage(
        conversationId: string,
        direction: MessageDirection,
        senderType: ProspectMessageSenderType,
        content: string,
        metadata?: Record<string, any>,
    ): Promise<ProspectMessage> {
        const msg = this.messageRepo.create({
            conversation_id: conversationId,
            direction,
            sender_type: senderType,
            content,
            metadata,
        });
        return this.messageRepo.save(msg);
    }

    private async buildSystemPrompt(): Promise<string> {
        const properties = await this.getAvailableProperties();

        const propertyList = properties
            .map(
                (p) =>
                    `- **${p.name}** (${p.location}): ${p.no_of_bedrooms} bed / ${p.no_of_bathrooms} bath, ₦${(p.rental_price || 0).toLocaleString()}/year${p.description ? '. ' + p.description : ''}`,
            )
            .join('\n');

        return `You are a friendly, professional property assistant for Property Kraft (Lizt).
Your role is to help prospective tenants and property seekers find suitable properties.

GUIDELINES:
- Be warm, professional, and conversational — like a helpful real estate agent
- Answer questions about available properties using ONLY the data provided below
- Naturally collect prospect information: their name, budget, preferred location, number of bedrooms, move-in timeline
- If they express interest in a property, encourage them to schedule a viewing
- If you can't answer a question, politely say you'll connect them with an agent
- Keep responses concise (under 200 words) for WhatsApp readability
- Use naira (₦) for currency
- DO NOT share internal system details, tenant personal data, or landlord information
- DO NOT make up properties or details not in the list below
- If there are no matching properties, say so honestly and offer to notify them when one becomes available

AVAILABLE PROPERTIES:
${propertyList || 'No properties are currently listed. Let the prospect know and offer to notify them when properties become available.'}

Remember: You represent Property Kraft. Be helpful, honest, and professional.`;
    }

    private async getAvailableProperties(): Promise<Property[]> {
        return this.propertyRepo.find({
            where: {
                property_status: In([
                    PropertyStatusEnum.VACANT,
                    PropertyStatusEnum.READY_FOR_MARKETING,
                ]),
            },
            select: [
                'id',
                'name',
                'location',
                'description',
                'no_of_bedrooms',
                'no_of_bathrooms',
                'rental_price',
                'property_type',
                'property_status',
            ],
        });
    }

    private async getConversationHistory(
        conversationId: string,
    ): Promise<{ role: 'user' | 'model'; content: string }[]> {
        const messages = await this.messageRepo.find({
            where: { conversation_id: conversationId },
            order: { created_at: 'ASC' },
            take: 20, // Limit context window
        });

        return messages.map((msg) => ({
            role:
                msg.sender_type === ProspectMessageSenderType.PROSPECT
                    ? ('user' as const)
                    : ('model' as const),
            content: msg.content,
        }));
    }

    private async extractAndUpdateProspectInfo(
        conversationId: string,
    ): Promise<void> {
        try {
            const conversation = await this.conversationRepo.findOne({
                where: { id: conversationId },
            });
            if (!conversation) return;

            const messages = await this.messageRepo.find({
                where: { conversation_id: conversationId },
                order: { created_at: 'ASC' },
            });

            const conversationText = messages
                .map(
                    (m) =>
                        `${m.sender_type === ProspectMessageSenderType.PROSPECT ? 'Prospect' : 'Assistant'}: ${m.content}`,
                )
                .join('\n');

            const existingData = {
                prospect_name: conversation.prospect_name,
                intent: conversation.intent,
                preferences: conversation.preferences,
                schedule: conversation.schedule,
                summary: conversation.summary,
            };

            const extracted = await this.geminiService.extractProspectInfo(
                conversationText,
                existingData,
            );

            // Update conversation with extracted data
            if (extracted.prospect_name) {
                conversation.prospect_name = extracted.prospect_name;
            }
            if (extracted.intent) {
                conversation.intent = extracted.intent;
            }
            if (extracted.preferences) {
                conversation.preferences = {
                    ...conversation.preferences,
                    ...extracted.preferences,
                };
            }
            if (extracted.schedule) {
                conversation.schedule = {
                    ...conversation.schedule,
                    ...extracted.schedule,
                };
            }
            if (extracted.summary) {
                conversation.summary = extracted.summary;
            }

            await this.conversationRepo.save(conversation);
            this.logger.log(`📊 Updated prospect info for conversation ${conversationId}`);
        } catch (error) {
            this.logger.error('Failed to extract prospect info:', error.message);
        }
    }

    private async sendReply(
        to: string,
        text: string,
        channel: ProspectChannel,
    ): Promise<void> {
        if (channel === ProspectChannel.WHATSAPP) {
            await this.templateSenderService.sendText(to, text);
        }
        // Web chat replies are handled via WebSocket events
    }

    private emitConversationEvent(event: string, data: any): void {
        this.eventEmitter.emit(event, data);
    }
}

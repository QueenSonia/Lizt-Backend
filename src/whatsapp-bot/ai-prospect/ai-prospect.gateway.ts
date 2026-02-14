import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AiProspectService } from './ai-prospect.service';
import * as jwt from 'jsonwebtoken';

@WebSocketGateway({
    namespace: '/prospect',
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
})
export class AiProspectGateway
    implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server: Server;
    private readonly logger = new Logger(AiProspectGateway.name);

    constructor(private readonly aiProspectService: AiProspectService) { }

    afterInit(server: Server) {
        this.logger.log('🔌 Prospect Gateway initialized');

        // Auth middleware for agents connecting to dashboard
        server.use(async (socket: any, next) => {
            const token =
                socket.handshake.auth.token || socket.handshake.headers.authorization;
            const isWebChat = socket.handshake.query.webchat === 'true';

            if (isWebChat) {
                // Web chat doesn't need auth
                socket.isWebChat = true;
                socket.sessionId = socket.handshake.query.sessionId;
                next();
                return;
            }

            if (!token) {
                next(new Error('Unauthorized'));
                return;
            }

            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET!);
                socket.user = decoded;
                next();
            } catch (err) {
                this.logger.error('JWT verification failed:', err);
                next(new Error('Unauthorized'));
            }
        });
    }

    handleConnection(client: Socket & { user?: any; isWebChat?: boolean }) {
        if (client.isWebChat) {
            this.logger.log(`🌐 Web chat client connected`);
        } else {
            this.logger.log(
                `👤 Agent connected: ${client.user?.email || 'unknown'}`,
            );
            // Auto-join them to the agent room for broadcasts
            client.join('prospect-agents');
        }
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected: ${client.id}`);
    }

    // Agent subscribes to a specific conversation
    @SubscribeMessage('prospect:join_room')
    handleJoinRoom(
        @MessageBody() conversationId: string,
        @ConnectedSocket() client: Socket,
    ) {
        client.join(`conversation:${conversationId}`);
        this.logger.log(`Client joined room: conversation:${conversationId}`);
    }

    // Web chat client sends a message
    @SubscribeMessage('web_chat:message')
    async handleWebChatMessage(
        @MessageBody() data: { sessionId: string; message: string },
        @ConnectedSocket() client: Socket,
    ) {
        const { response, conversationId } =
            await this.aiProspectService.handleWebChatMessage(
                data.sessionId,
                data.message,
            );

        // Send AI response back to the web chat client
        client.emit('web_chat:response', {
            conversationId,
            message: response,
            sender: 'ai',
        });
    }

    // ========================================
    // Event handlers for real-time updates
    // ========================================

    @OnEvent('prospect:new_message')
    handleNewMessage(data: any) {
        // Notify agents watching this conversation
        this.server
            ?.to(`conversation:${data.conversationId}`)
            .emit('prospect:new_message', data);

        // Notify all agents (for conversation list updates)
        this.server?.to('prospect-agents').emit('prospect:list_update', data);

        // If it's a web chat agent message, send to web chat clients
        if (data.channel === 'web' && data.sender === 'agent') {
            this.server
                ?.to(`conversation:${data.conversationId}`)
                .emit('web_chat:response', {
                    conversationId: data.conversationId,
                    message: data.message,
                    sender: 'agent',
                });
        }
    }

    @OnEvent('prospect:conversation_created')
    handleConversationCreated(data: any) {
        this.server?.to('prospect-agents').emit('prospect:conversation_created', data);
    }

    @OnEvent('prospect:status_changed')
    handleStatusChanged(data: any) {
        this.server
            ?.to(`conversation:${data.conversationId}`)
            .emit('prospect:status_changed', data);
        this.server?.to('prospect-agents').emit('prospect:list_update', data);
    }
}

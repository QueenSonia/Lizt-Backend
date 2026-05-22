import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { ChatPresenceService } from './chat-presence.service';
import { SendMessageDto } from './dto/send-message.dto';
import { ChatMessage, MessageSender } from './chat-message.entity';
import { OnEvent } from '@nestjs/event-emitter';
import { AuthService } from 'src/auth/auth.service';

interface AuthedSocket extends Socket {
  user?: { id: string; role?: string };
}

@WebSocketGateway({
  cors: {
    // Mirror the rest of the codebase — never '*' in production. JWT auth is
    // already enforced in afterInit, but a permissive CORS would still leak
    // headers and break credentialed clients. Falls back to localhost for dev.
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly presence: ChatPresenceService,
    private readonly authService: AuthService,
  ) {}

  afterInit(server: Server) {
    server.use(async (socket: AuthedSocket, next) => {
      // Accept the ticket from either the standard socket.io auth.token slot
      // or a Bearer Authorization header. The frontend gets one from
      // /api/auth/ws-ticket → backend GET /auth/ws-ticket, which exchanges
      // the HTTP-only access_token cookie for a 60s `purpose: 'ws'` JWT.
      //
      // Raw access tokens are deliberately *not* accepted here — only WS
      // tickets — so that a value leaked via the websocket layer can't be
      // replayed against the REST API.
      const rawAuth =
        (socket.handshake.auth.token as string | undefined) ||
        (socket.handshake.headers.authorization as string | undefined);
      const ticket = rawAuth?.startsWith('Bearer ')
        ? rawAuth.slice(7)
        : rawAuth;

      // Reject *quietly* if no ticket at all — avoids log spam every time
      // something probes the gateway. The connect still fails so callers
      // know to retry after fetching a ticket.
      if (!ticket) {
        return next(new Error('Unauthorized'));
      }

      try {
        const decoded = await this.authService.verifyWsTicket(ticket);
        socket.user = decoded;
        next();
      } catch (err) {
        console.warn(
          `[ChatGateway] WS ticket verification failed: ${(err as Error).message}`,
        );
        next(new Error('Unauthorized'));
      }
    });
  }

  handleConnection(client: AuthedSocket) {
    const accountId = client.user?.id;
    if (!accountId) return;
    this.presence.add(accountId, client.id);
    // Auto-join the per-account room so MrChatNotificationService can push a
    // toast to *anywhere* on the dashboard — not just the modal. This is
    // what makes "online users see a toast instead of getting WhatsApp" work
    // without each screen having to subscribe individually.
    client.join(`account:${accountId}`);
  }

  handleDisconnect(client: AuthedSocket) {
    const accountId = client.user?.id;
    if (accountId) this.presence.remove(accountId, client.id);
  }

  @SubscribeMessage('join')
  handleJoinRoom(
    @MessageBody() room: string,
    @ConnectedSocket() client: Socket,
  ) {
    client.join(room);
  }

  // Frontend ThreadView emits this when the modal opens; we join the per-MR
  // room so the broadcast in handleMrChatMessageCreated reaches the right
  // tabs. Blur on close.
  @SubscribeMessage('mr:focus')
  handleMrFocus(
    @MessageBody() data: { request_id: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (data?.request_id) client.join(`mr:${data.request_id}`);
  }

  @SubscribeMessage('mr:blur')
  handleMrBlur(
    @MessageBody() data: { request_id: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (data?.request_id) client.leave(`mr:${data.request_id}`);
  }

  @SubscribeMessage('send_message')
  async handleMessage(
    @MessageBody() data: SendMessageDto,
    @ConnectedSocket() client: AuthedSocket,
  ) {
    const userId = client.user?.id as string;
    try {
      const message = await this.chatService.sendMessage(userId, data);
      this.server.to(data.requestId).emit('new_message', message);
      return message;
    } catch (error) {
      console.error('Error sending message:', error);
      return { error: 'Message failed to send' };
    }
  }

  @SubscribeMessage('mark_read')
  async markRead(
    @MessageBody() data: { requestId: string; sender: MessageSender },
  ) {
    await this.chatService.markMessagesAsRead(data.requestId, data.sender);
  }

  // Listens for the event emitted by ChatService.sendMaintenanceChatMessage
  // and pushes the new message to all clients in the MR room (the modal's
  // ThreadView subscribes via mr:focus). Decouples HTTP write from socket
  // broadcast so the controller doesn't need to know about the gateway.
  //
  // The emitted payload carries BOTH ids — the ChatMessage row only stores
  // the varchar request_id (that's the FK), but the landlord/FM modals
  // cache their thread by the MR UUID. Sending both lets the frontend
  // update whichever cache key it used without an extra resolver round trip.
  @OnEvent('mr-chat.message.created')
  handleMrChatMessageCreated(payload: {
    message: ChatMessage;
    maintenance_request_id: string;
    maintenance_request_uuid: string;
  }) {
    if (!payload?.maintenance_request_id) return;
    const enriched = {
      ...payload.message,
      maintenance_request_uuid: payload.maintenance_request_uuid,
    };
    this.server
      .to(`mr:${payload.maintenance_request_id}`)
      .emit('new_message', enriched);
  }

  // Sent by MrChatNotificationService for each online recipient — used to
  // render a dashboard toast ("Maryam replied on MR-XXXX") on any screen the
  // user happens to be on. The toast component dedupes against `mr:focus`
  // (no toast if you're already looking at this MR).
  @OnEvent('mr-chat.toast')
  handleMrChatToast(payload: {
    account_id: string;
    toast: Record<string, unknown>;
  }) {
    if (!payload?.account_id) return;
    this.server.to(`account:${payload.account_id}`).emit('mr_chat_toast', payload.toast);
  }
}

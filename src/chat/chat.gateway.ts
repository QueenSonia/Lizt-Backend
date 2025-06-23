import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageSender } from './chat-message.entity';
import * as jwt from 'jsonwebtoken';

@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
})
export class ChatGateway {
  @WebSocketServer() server: Server;

  afterInit(server: Server) {
    server.use(async (socket: any, next) => {
      const token =
        socket.handshake.auth.token || socket.handshake.headers.authorization;

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!);
        socket.user = decoded;
        next();
      } catch (err) {
        console.error('JWT verification failed:', err);
        next(new Error('Unauthorized'));
      }
    });
  }

  constructor(private readonly chatService: ChatService) {}
  @SubscribeMessage('join')
  handleJoinRoom(
    @MessageBody() room: string,
    @ConnectedSocket() client: Socket,
  ) {
    client.join(room);
    // {
    //   id: '1',
    //   content: 'Welcome to your service request chat! How can we assist you today?',
    //   sender: 'admin',
    //   requestId,
    // }

    console.log(`Client joined room: ${room}`);
  }

  @SubscribeMessage('send_message')
  async handleMessage(
    @MessageBody() data: SendMessageDto,
    @ConnectedSocket() client: Socket & { user?: { id: string } },
  ) {
    console.log({data})
    const userId = client?.user?.id as string;
    // console.log('Sending message from user:', userId, 'with data:', data);

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
}

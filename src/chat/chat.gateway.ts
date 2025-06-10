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

@WebSocketGateway({cors:true})
export class ChatGateway {
  @WebSocketServer() server: Server;

  constructor(private readonly chatService: ChatService) {}

 @SubscribeMessage('send_message')
  async handleMessage(@MessageBody() data: SendMessageDto) {
    const message = await this.chatService.sendMessage(data);
    this.server.to(data.serviceRequestId).emit('new_message', message);
    return message;
  }

  @SubscribeMessage('mark_read')
  async markRead(@MessageBody() data: { requestId: string; sender: MessageSender }) {
    await this.chatService.markMessagesAsRead(data.requestId, data.sender);
  }
}

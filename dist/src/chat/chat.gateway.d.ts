import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageSender } from './chat-message.entity';
export declare class ChatGateway {
    private readonly chatService;
    server: Server;
    afterInit(server: Server): void;
    constructor(chatService: ChatService);
    handleJoinRoom(room: string, client: Socket): void;
    handleMessage(data: SendMessageDto, client: Socket & {
        user?: {
            id: string;
        };
    }): Promise<import("./chat-message.entity").ChatMessage | {
        error: string;
    }>;
    markRead(data: {
        requestId: string;
        sender: MessageSender;
    }): Promise<void>;
}

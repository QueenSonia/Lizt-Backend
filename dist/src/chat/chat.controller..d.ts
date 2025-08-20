import { ChatService } from './chat.service';
export declare class ChatController {
    private readonly chatService;
    constructor(chatService: ChatService);
    getAllConversations(req: any): Promise<any[]>;
    getMessages(requestId: string): Promise<import("./chat-message.entity").ChatMessage[]>;
    sendMail(req: any, body: {
        message: string;
    }): Promise<[import("@sendgrid/mail").ClientResponse, {}]>;
    markAsResolved(req: any): Promise<void>;
}

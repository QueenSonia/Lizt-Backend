import { MessageSender, MessageType } from 'src/chat/chat-message.entity';
export declare class SendMessageDto {
    serviceRequestId: string;
    sender: MessageSender;
    type?: MessageType;
    content: string;
    fileName?: string;
    fileUrl?: string;
    senderName?: string;
}

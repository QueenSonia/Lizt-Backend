import { MessageSender, MessageType } from '../chat-message.entity';

export class SendMessageDto {
  serviceRequestId: string;
  sender: MessageSender;
  content: string;
  type?: MessageType;
  fileName?: string;
  fileUrl?: string;
  senderName?: string;
}

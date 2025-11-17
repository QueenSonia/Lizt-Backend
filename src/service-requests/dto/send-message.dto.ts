import { IsString, IsEnum, IsOptional, IsNumber } from 'class-validator';
import { MessageSender, MessageType } from 'src/chat/chat-message.entity';

export class SendMessageDto {
  @IsNumber()
  serviceRequestId: string;

  @IsEnum(MessageSender)
  sender: MessageSender;

  @IsEnum(MessageType)
  @IsOptional()
  type?: MessageType;

  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  fileUrl?: string;

  @IsOptional()
  @IsString()
  senderName?: string;
}

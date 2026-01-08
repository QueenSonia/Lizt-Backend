import { ChatLog } from '../entities/chat-log.entity';

export class ChatHistoryResponseDto {
  messages: ChatLog[];
  total: number;
  page?: number;
  limit?: number;
  hasMore: boolean;
}
